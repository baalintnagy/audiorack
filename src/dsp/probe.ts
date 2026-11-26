import type { EffectType } from '../shared/effects';
import type { SignalReading } from '../shared/messages';
import { SPECTRUM_BINS } from '../shared/spectrum';
import { SpectrumTap } from './kernels/analyzers';
import { LevelMeter } from './meter';

/**
 * The spectra an effect's display draws behind its curves: what comes out of it, and for the
 * equalizer what goes in as well. Others draw none, so their probes skip the FFTs.
 */
const SPECTRA: Partial<Record<EffectType, 'post' | 'both'>> = {
    eq: 'both',
    filter: 'post',
    deesser: 'post',
    bassboost: 'post',
    multiband: 'post',
    saturator: 'post',
};

const FFT_SIZE = 4096;
/** Share of the previous spectrum kept in each new one, as Web Audio analysers smooth theirs. */
const SMOOTHING = 0.8;

/**
 * A spectrum of the signal through one point, smoothed over time on linear magnitudes so it
 * reads calmly, like an AnalyserNode with the same smoothing.
 */
class SmoothedSpectrum {
    private readonly tap: SpectrumTap;
    private readonly smoothed = new Float32Array(SPECTRUM_BINS);

    constructor(sampleRate: number) {
        this.tap = new SpectrumTap(sampleRate, SPECTRUM_BINS);
        this.tap.setParams({ channel: 'mono', fftSize: FFT_SIZE });
    }

    write(left: Float32Array, right: Float32Array, frames: number) {
        this.tap.process(left, right, frames);
    }

    take(): number[] {
        const latest = this.tap.takeMeters();
        return latest.map((db, index) => {
            const magnitude =
                this.smoothed[index] * SMOOTHING + Math.pow(10, db / 20) * (1 - SMOOTHING);
            this.smoothed[index] = magnitude;
            return Math.round(20 * Math.log10(Math.max(magnitude, 1e-7)) * 10) / 10;
        });
    }

    reset() {
        this.tap.reset();
        this.smoothed.fill(0);
    }
}

/**
 * Watches one effect's own signal, on its way in and on its way out: levels always, and the
 * spectra its display draws. See {@link SignalReading}.
 */
export class SignalProbe {
    private readonly input = new LevelMeter();
    private readonly output = new LevelMeter();
    private readonly pre: SmoothedSpectrum | undefined;
    private readonly post: SmoothedSpectrum | undefined;

    constructor(type: EffectType, sampleRate: number) {
        const spectra = SPECTRA[type];
        this.pre = spectra === 'both' ? new SmoothedSpectrum(sampleRate) : undefined;
        this.post = spectra ? new SmoothedSpectrum(sampleRate) : undefined;
    }

    /** Call with the block before the effect processes it. */
    observeInput(left: Float32Array, right: Float32Array, frames: number) {
        this.input.add(left, right, frames);
        this.pre?.write(left, right, frames);
    }

    /** Call with the block the effect produced. */
    observeOutput(left: Float32Array, right: Float32Array, frames: number) {
        this.output.add(left, right, frames);
        this.post?.write(left, right, frames);
    }

    take(): SignalReading {
        return {
            input: this.input.take(),
            output: this.output.take(),
            ...(this.pre ? { pre: this.pre.take() } : {}),
            ...(this.post ? { post: this.post.take() } : {}),
        };
    }

    reset() {
        this.pre?.reset();
        this.post?.reset();
    }
}
