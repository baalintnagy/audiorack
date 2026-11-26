import type { LevelerParams } from '../../shared/effects';
import { Biquad } from '../biquad';
import { LoudnessMeter, energyToLufs, kWeightingCoefficients } from '../loudness';
import { dbToGain } from '../util';
import type { Kernel } from './kernel';

/** Layout of the readings produced by {@link LevelerKernel}, in dB and LUFS. */
export const LEVELER_FIELDS = { gain: 0, input: 1, output: 2 };

/** How often the slow leveler aims the gain anew, in seconds: the loudness meter's blocks. */
const SLOW_UPDATE_SECONDS = 0.1;
/** How often the fast leveler aims the gain anew, in samples: well under a millisecond. */
const FAST_UPDATE_SAMPLES = 32;
/** Bounds of the fast leveler's level detector, in ms; it follows half the response time. */
const DETECTOR_MIN_MS = 10;
const DETECTOR_MAX_MS = 50;
/**
 * The fast leveler also follows the level this many times faster, to tell a decay from a quieter
 * passage: while it lies {@link FALLING_DB} below the main detector, the sound is dying away, as
 * at the end of a word, and the leveler does not lift it. It closes the gate sooner too.
 */
const DECAY_DETECTOR_SPEEDUP = 5;
const DECAY_DETECTOR_MIN_MS = 2;
const FALLING_DB = 6;
/**
 * Turning down goes this much faster than turning up, so a sudden loud passage comes down
 * promptly while quiet passages are lifted gently.
 */
const CUT_SPEEDUP = 2;

/**
 * Rides the gain towards a loudness target, within the largest boost and cut allowed. Below the
 * gate, such as in pauses or between tracks, it holds the gain rather than lift the noise.
 *
 * Slow, it rides like an engineer on a fader: it measures the K-weighted momentary loudness of
 * its input (BS.1770) every 100 ms and closes the gap over a response time of seconds. Fast, it
 * works like a compressor that also lifts, an automatic gain control: a K-weighted level
 * detector of 10 to 50 ms aims the gain every 32 samples, over a response time of milliseconds.
 * Either way the gain ramps from one aim to the next, so it never steps.
 */
export class LevelerKernel implements Kernel<LevelerParams> {
    private readonly input: LoudnessMeter;
    private readonly output: LoudnessMeter;
    private readonly shelf = new Biquad();
    private readonly highPass = new Biquad();
    private readonly sampleRate: number;
    /** The fast detectors' running K-weighted energies, and their smoothing per sample. */
    private detector = 0;
    private detectorFactor = 0;
    private decay = 0;
    private decayFactor = 0;
    private params: LevelerParams | undefined;
    private gainDb = 0;
    /** The gain applied to the current sample, and its ramp to the latest aim. */
    private applied = 1;
    private step = 0;
    private rampLeft = 0;
    private untilUpdate: number;

    constructor(sampleRate: number) {
        this.sampleRate = sampleRate;
        this.input = new LoudnessMeter(sampleRate);
        this.output = new LoudnessMeter(sampleRate);
        const [shelf, highPass] = kWeightingCoefficients(sampleRate);
        this.shelf.setCoefficients(shelf);
        this.highPass.setCoefficients(highPass);
        this.untilUpdate = this.updateLength(false);
    }

    private updateLength(fast: boolean): number {
        return fast ? FAST_UPDATE_SAMPLES : Math.round(this.sampleRate * SLOW_UPDATE_SECONDS);
    }

    setParams(p: LevelerParams) {
        const switched = this.params !== undefined && this.params.fast !== p.fast;
        this.params = p;
        const detectorMs = Math.min(
            DETECTOR_MAX_MS,
            Math.max(DETECTOR_MIN_MS, p.fastResponseMs / 2),
        );
        const decayMs = Math.max(DECAY_DETECTOR_MIN_MS, detectorMs / DECAY_DETECTOR_SPEEDUP);
        this.detectorFactor = 1 - Math.exp(-1000 / (detectorMs * this.sampleRate));
        this.decayFactor = 1 - Math.exp(-1000 / (decayMs * this.sampleRate));
        if (switched) {
            this.untilUpdate = Math.min(this.untilUpdate, this.updateLength(p.fast));
        }
        // Narrower limits apply at once, not over the response time.
        this.gainDb = Math.min(p.maxBoostDb, Math.max(-p.maxCutDb, this.gainDb));
        this.rampTo(this.gainDb, FAST_UPDATE_SAMPLES);
    }

    process(left: Float32Array, right: Float32Array, frames: number) {
        this.input.process(left, right, frames);
        const fast = this.params?.fast ?? false;
        for (let start = 0; start < frames;) {
            const length = Math.min(frames - start, this.untilUpdate);
            if (fast) {
                this.detect(left, right, start, length);
            }
            this.applyGain(left, right, start, length);
            start += length;
            this.untilUpdate -= length;
            if (this.untilUpdate === 0) {
                this.untilUpdate = this.updateLength(fast);
                this.update(this.untilUpdate);
            }
        }
        this.output.process(left, right, frames);
    }

    /** Follows the K-weighted level of the input for the fast leveler. */
    private detect(left: Float32Array, right: Float32Array, start: number, length: number) {
        for (let i = start; i < start + length; i++) {
            const l = this.highPass.tick(this.shelf.tick(left[i], 0), 0);
            const r = this.highPass.tick(this.shelf.tick(right[i], 1), 1);
            const energy = l * l + r * r;
            this.detector += (energy - this.detector) * this.detectorFactor;
            this.decay += (energy - this.decay) * this.decayFactor;
        }
    }

    private applyGain(left: Float32Array, right: Float32Array, start: number, length: number) {
        for (let i = start; i < start + length; i++) {
            if (this.rampLeft > 0) {
                this.applied += this.step;
                this.rampLeft--;
            }
            left[i] *= this.applied;
            right[i] *= this.applied;
        }
    }

    /** Aims the gain at the target, for the next `samples` until the following update. */
    private update(samples: number) {
        const p = this.params;
        if (!p) {
            return;
        }
        // A faster reading closes the gate as soon as a pause starts, before the slower one
        // could lift the gain into it: slow, the newest 100 ms block; fast, the decay detector.
        const loudness = p.fast ? energyToLufs(this.detector) : this.input.momentary;
        const latest = p.fast ? energyToLufs(this.decay) : this.input.latestBlock;
        const gated = loudness < p.gateLufs || latest < p.gateLufs;
        const wanted = Math.min(p.maxBoostDb, Math.max(-p.maxCutDb, p.targetLufs - loudness));
        const dying = p.fast && wanted > this.gainDb && latest < loudness - FALLING_DB;
        if (!gated && !dying) {
            const responseS = p.fast ? p.fastResponseMs / 1000 : p.responseS;
            const seconds = wanted < this.gainDb ? responseS / CUT_SPEEDUP : responseS;
            const elapsed = samples / this.sampleRate;
            this.gainDb += (wanted - this.gainDb) * (1 - Math.exp(-elapsed / seconds));
        }
        this.rampTo(this.gainDb, samples);
    }

    /** Ramps the applied gain to `gainDb` over `samples`, so it never steps. */
    private rampTo(gainDb: number, samples: number) {
        this.step = (dbToGain(gainDb) - this.applied) / samples;
        this.rampLeft = samples;
    }

    reset() {
        this.input.reset();
        this.output.reset();
        this.shelf.reset();
        this.highPass.reset();
        this.detector = 0;
        this.decay = 0;
        this.gainDb = 0;
        this.applied = 1;
        this.step = 0;
        this.rampLeft = 0;
        this.untilUpdate = this.updateLength(this.params?.fast ?? false);
    }

    takeMeters() {
        return [this.gainDb, this.input.momentary, this.output.momentary].map(
            (value) => Math.round(value * 10) / 10,
        );
    }
}
