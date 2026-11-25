import {
    SATURATION_STYLES,
    type SaturationStyle,
    type SaturatorBand,
    type SaturatorParams,
} from '../../shared/effects';
import { BiquadCascade, biquadCoefficients } from '../biquad';
import { MultibandSplitter } from '../crossover';
import { StereoDelay } from '../delay';
import { MAX_OVERSAMPLING_LATENCY, Oversampler } from '../oversampling';
import { Smoother, dbToGain, ensureCapacity, gainToDb, timeCoefficient } from '../util';
import type { Kernel } from './kernel';

/** Level the dynamics control is centered on: louder material drives harder (or softer). */
const DYNAMICS_REFERENCE = dbToGain(-18);
/** Largest drive change from the dynamics control, as a gain factor (±24 dB). */
const DYNAMICS_LIMIT = 16;
const ENVELOPE_ATTACK_MS = 3;
const ENVELOPE_RELEASE_MS = 80;
const DC_BLOCK_HZ = 8;
/** Fade-in after the oversampling factor changes, which restarts the filters. */
const RESTART_FADE_MS = 15;

/** Styles whose curve is asymmetric and so needs a DC blocker. */
const ASYMMETRIC = new Set<SaturationStyle>(['tube', 'rectify']);

/**
 * Transfer curves with unity slope at zero (except rectify), so quiet material keeps its level
 * at 0 dB drive.
 */
export function saturate(style: SaturationStyle, x: number): number {
    switch (style) {
        case 'tube':
            // Softer on the positive half: asymmetric clipping adds even harmonics.
            return x >= 0 ? Math.tanh(x) : Math.tanh(1.6 * x) / 1.6;
        case 'tape':
            return (2 / Math.PI) * Math.atan((Math.PI / 2) * x);
        case 'soft':
            return Math.tanh(x);
        case 'hard':
            return x > 1 ? 1 : x < -1 ? -1 : x;
        case 'fold': {
            // Triangle fold: linear in [-1, 1], reflected back at the edges.
            const phase = (x - 1) / 4;
            return 4 * Math.abs(phase - Math.floor(phase) - 0.5) - 1;
        }
        case 'rectify':
            // Full-wave rectification doubles the frequency; the DC blocker removes the offset.
            return Math.tanh(Math.abs(x));
    }
}

/** Frequency the tone control tilts around: the geometric center of the band. */
export function bandCenter(crossovers: number[], band: number): number {
    const low = band === 0 ? 20 : crossovers[band - 1];
    const high = band === crossovers.length ? 20000 : crossovers[band];
    return Math.sqrt(low * high);
}

interface BandState {
    styleIndex: number;
    dcBlock: boolean;
    dynamics: number;
    toneActive: boolean;
    readonly tone: BiquadCascade;
    readonly drive: Smoother;
    readonly mix: Smoother;
    readonly level: Smoother;
    /** Crossfades between the processed band (1) and the plain band (0). */
    readonly active: Smoother;
    /** Solo and mute. */
    readonly audible: Smoother;
    envelope: number;
    /** DC blocker state per channel: previous input and output. */
    readonly dcIn: Float64Array;
    readonly dcOut: Float64Array;
    /** Peak level into the curve since the last meter reading. */
    peak: number;
}

/**
 * Multiband saturator: Linkwitz-Riley bands, each through its own curve with drive, dynamics,
 * tone, mix and level, all at 1×, 2× or 4× the sample rate against aliasing. The latency is the
 * same at every oversampling factor, so switching it never moves the signal in time.
 */
export class SaturatorKernel implements Kernel<SaturatorParams> {
    readonly latency = MAX_OVERSAMPLING_LATENCY;
    private readonly oversampler = new Oversampler();
    private readonly splitter = new MultibandSplitter();
    private readonly alignment = new StereoDelay();
    private bandsLeft: Float32Array[] = [];
    private bandsRight: Float32Array[] = [];
    private sumLeft = new Float32Array(256);
    private sumRight = new Float32Array(256);
    private wetLeft = new Float32Array(256);
    private wetRight = new Float32Array(256);
    /** Global dry/wet per oversampled sample, shared by all bands. */
    private mixRamp = new Float32Array(256);
    private states: BandState[] = [];
    private rate: number;
    private params?: SaturatorParams;
    private attack = 0;
    private release = 0;
    private dcCoefficient = 0;
    private mix: Smoother;
    private readonly output: Smoother;
    private readonly fade: Smoother;

    constructor(private readonly sampleRate: number) {
        this.rate = sampleRate;
        this.mix = new Smoother(1, 20, sampleRate);
        this.output = new Smoother(1, 20, sampleRate);
        this.fade = new Smoother(1, RESTART_FADE_MS, sampleRate);
        this.alignment.setDelay(this.latency);
    }

    setParams(p: SaturatorParams) {
        const restart = !this.params || p.oversampling !== this.oversampler.factor;
        const count = p.crossovers.length + 1;
        if (restart) {
            // Everything below runs at the oversampled rate.
            this.oversampler.setFactor(p.oversampling);
            this.rate = this.sampleRate * p.oversampling;
            this.attack = timeCoefficient(ENVELOPE_ATTACK_MS, this.rate);
            this.release = timeCoefficient(ENVELOPE_RELEASE_MS, this.rate);
            this.dcCoefficient = Math.exp((-2 * Math.PI * DC_BLOCK_HZ) / this.rate);
            this.splitter.reset();
            this.states = [];
            this.alignment.setDelay(this.latency - this.oversampler.latency);
            this.alignment.reset();
            this.mix = new Smoother(p.mix / 100, 20, this.rate);
            if (this.params) {
                this.fade.jump(0);
                this.fade.set(1);
            }
        }
        this.splitter.setCrossovers(p.crossovers, this.rate);
        while (this.states.length < count) {
            this.states.push(this.createBand());
        }
        this.states.length = count;
        while (this.bandsLeft.length < count) {
            this.bandsLeft.push(new Float32Array(256));
            this.bandsRight.push(new Float32Array(256));
        }
        this.bandsLeft.length = count;
        this.bandsRight.length = count;
        const soloed = p.bands.some((band) => band.solo);
        this.states.forEach((state, index) =>
            this.configureBand(state, p.bands[index], bandCenter(p.crossovers, index), soloed),
        );
        this.mix.set(p.mix / 100);
        this.output.set(dbToGain(p.outputDb));
        this.params = p;
    }

    private createBand(): BandState {
        return {
            styleIndex: 0,
            dcBlock: false,
            dynamics: 0,
            toneActive: false,
            tone: new BiquadCascade(),
            drive: new Smoother(1, 20, this.rate),
            mix: new Smoother(1, 20, this.rate),
            level: new Smoother(1, 20, this.rate),
            active: new Smoother(1, 12, this.rate),
            audible: new Smoother(1, 12, this.rate),
            envelope: 0,
            dcIn: new Float64Array(2),
            dcOut: new Float64Array(2),
            peak: 0,
        };
    }

    private configureBand(state: BandState, band: SaturatorBand, center: number, soloed: boolean) {
        const styleIndex = SATURATION_STYLES.indexOf(band.style);
        if (styleIndex !== state.styleIndex) {
            state.dcIn.fill(0);
            state.dcOut.fill(0);
        }
        state.styleIndex = styleIndex;
        state.dcBlock = ASYMMETRIC.has(band.style);
        state.dynamics = band.dynamics / 100;
        const toneActive = band.tone !== 0;
        if (toneActive && !state.toneActive) {
            state.tone.reset();
        }
        state.toneActive = toneActive;
        if (toneActive) {
            const frequency = Math.min(center, this.rate * 0.45);
            state.tone.setCoefficients([
                biquadCoefficients('lowshelf', frequency, 0.5, -band.tone / 2, this.rate),
                biquadCoefficients('highshelf', frequency, 0.5, band.tone / 2, this.rate),
            ]);
        }
        state.drive.set(dbToGain(band.driveDb));
        state.mix.set(band.mix / 100);
        state.level.set(dbToGain(band.levelDb));
        state.active.set(band.bypass ? 0 : 1);
        state.audible.set(band.mute || (soloed && !band.solo) ? 0 : 1);
    }

    process(left: Float32Array, right: Float32Array, frames: number) {
        if (!this.params) {
            return;
        }
        const count = this.states.length;
        const length = frames * this.oversampler.factor;
        for (let band = 0; band < count; band++) {
            this.bandsLeft[band] = ensureCapacity(this.bandsLeft[band], length);
            this.bandsRight[band] = ensureCapacity(this.bandsRight[band], length);
        }
        this.bandsLeft[0].set(this.oversampler.up(left, frames, 0).subarray(0, length));
        this.bandsRight[0].set(this.oversampler.up(right, frames, 1).subarray(0, length));
        this.splitter.split(this.bandsLeft, length, 0);
        this.splitter.split(this.bandsRight, length, 1);
        this.sumLeft = ensureCapacity(this.sumLeft, length);
        this.sumRight = ensureCapacity(this.sumRight, length);
        this.mixRamp = ensureCapacity(this.mixRamp, length);
        const sumLeft = this.sumLeft;
        const sumRight = this.sumRight;
        sumLeft.fill(0, 0, length);
        sumRight.fill(0, 0, length);
        for (let i = 0; i < length; i++) {
            this.mixRamp[i] = this.mix.next();
        }
        for (let band = 0; band < count; band++) {
            this.processBand(this.states[band], band, length, sumLeft, sumRight);
        }
        this.oversampler.down(sumLeft, left, frames, 0);
        this.oversampler.down(sumRight, right, frames, 1);
        this.alignment.process(left, right, frames);
        for (let i = 0; i < frames; i++) {
            const gain = this.output.next() * this.fade.next();
            left[i] *= gain;
            right[i] *= gain;
        }
    }

    private processBand(
        state: BandState,
        band: number,
        length: number,
        sumLeft: Float32Array,
        sumRight: Float32Array,
    ) {
        const bandLeft = this.bandsLeft[band];
        const bandRight = this.bandsRight[band];
        if (state.audible.settled && state.audible.value === 0) {
            return;
        }
        const bypassed = state.active.settled && state.active.value === 0;
        if (!bypassed) {
            this.shape(state, bandLeft, bandRight, length);
        }
        const wetLeft = this.wetLeft;
        const wetRight = this.wetRight;
        const globalMix = this.mixRamp;
        for (let i = 0; i < length; i++) {
            const dryLeft = bandLeft[i];
            const dryRight = bandRight[i];
            const audible = state.audible.next();
            if (bypassed) {
                sumLeft[i] += dryLeft * audible;
                sumRight[i] += dryRight * audible;
                continue;
            }
            const mix = state.mix.next();
            const level = state.level.next();
            const processedLeft = (dryLeft + mix * (wetLeft[i] - dryLeft)) * level;
            const processedRight = (dryRight + mix * (wetRight[i] - dryRight)) * level;
            // Bypass, then the global dry/wet, both against the band before processing.
            const amount = state.active.next() * globalMix[i];
            sumLeft[i] += (dryLeft + amount * (processedLeft - dryLeft)) * audible;
            sumRight[i] += (dryRight + amount * (processedRight - dryRight)) * audible;
        }
    }

    /** Drives a band through its curve into the wet buffers. */
    private shape(
        state: BandState,
        bandLeft: Float32Array,
        bandRight: Float32Array,
        length: number,
    ) {
        this.wetLeft = ensureCapacity(this.wetLeft, length);
        this.wetRight = ensureCapacity(this.wetRight, length);
        const wetLeft = this.wetLeft;
        const wetRight = this.wetRight;
        const style = SATURATION_STYLES[state.styleIndex];
        const dynamics = state.dynamics;
        const attack = this.attack;
        const release = this.release;
        let envelope = state.envelope;
        let peak = state.peak;
        for (let i = 0; i < length; i++) {
            const dryLeft = bandLeft[i];
            const dryRight = bandRight[i];
            const drive = state.drive.next();
            let modulated = drive;
            if (dynamics !== 0) {
                const level = Math.max(Math.abs(dryLeft), Math.abs(dryRight));
                envelope = level + (envelope - level) * (level > envelope ? attack : release);
                const factor = Math.pow((envelope + 1e-9) / DYNAMICS_REFERENCE, dynamics * 0.5);
                modulated *= Math.min(DYNAMICS_LIMIT, Math.max(1 / DYNAMICS_LIMIT, factor));
            }
            // Partial makeup keeps the level roughly steady as the drive goes up.
            const makeup = 1 / Math.sqrt(drive);
            const inLeft = dryLeft * modulated;
            const inRight = dryRight * modulated;
            peak = Math.max(peak, Math.abs(inLeft), Math.abs(inRight));
            wetLeft[i] = saturate(style, inLeft) * makeup;
            wetRight[i] = saturate(style, inRight) * makeup;
        }
        state.envelope = envelope > 1e-20 ? envelope : 0;
        state.peak = peak;
        if (state.dcBlock) {
            this.blockDc(state, wetLeft, length, 0);
            this.blockDc(state, wetRight, length, 1);
        }
        if (state.toneActive) {
            state.tone.process(wetLeft, length, 0);
            state.tone.process(wetRight, length, 1);
        }
    }

    private blockDc(state: BandState, buffer: Float32Array, length: number, ch: number) {
        const dc = this.dcCoefficient;
        let previousIn = state.dcIn[ch];
        let previousOut = state.dcOut[ch];
        for (let i = 0; i < length; i++) {
            const x = buffer[i];
            previousOut = x - previousIn + dc * previousOut;
            previousIn = x;
            buffer[i] = previousOut;
        }
        state.dcIn[ch] = previousIn;
        state.dcOut[ch] = Math.abs(previousOut) > 1e-20 ? previousOut : 0;
    }

    reset() {
        this.oversampler.reset();
        this.splitter.reset();
        this.alignment.reset();
        this.states.forEach((state) => {
            state.tone.reset();
            state.envelope = 0;
            state.dcIn.fill(0);
            state.dcOut.fill(0);
        });
    }

    /** Peak level into each band's curve in dB, after drive. */
    takeMeters() {
        return this.states.map((state) => {
            const reading = gainToDb(state.peak);
            state.peak = 0;
            return reading;
        });
    }
}
