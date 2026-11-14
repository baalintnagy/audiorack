import type { BassBoostParams } from '../../shared/effects';
import {
    BiquadCascade,
    biquadCoefficients,
    cutFilterCoefficients,
    type BiquadCoefficients,
} from '../biquad';
import { LinkwitzRiley } from '../crossover';
import { Smoother, dbToGain, ensureCapacity } from '../util';
import type { Kernel } from './kernel';

const HARMONIC_DRIVE = 5;

export function bassShelfCoefficients(
    p: BassBoostParams,
    sampleRate: number,
): BiquadCoefficients[] {
    const shelf = biquadCoefficients('lowshelf', p.frequency, 0.9, p.boostDb, sampleRate);
    return p.tighten
        ? [shelf, ...cutFilterCoefficients('highpass', 25, 24, 1, sampleRate)]
        : [shelf];
}

/**
 * Low shelf boost with a psychoacoustic enhancer: the band below the boost frequency is
 * saturated and only the generated harmonics are mixed back, so small speakers suggest
 * bass they cannot reproduce.
 */
export class BassBoostKernel implements Kernel<BassBoostParams> {
    private readonly shelf = new BiquadCascade();
    private readonly harmonicInput = new BiquadCascade();
    private readonly harmonicOutput = new BiquadCascade();
    private readonly crossover = new LinkwitzRiley();
    private monoBass = false;
    private readonly harmonics: Smoother;
    private readonly output: Smoother;
    private lowLeft = new Float32Array(128);
    private lowRight = new Float32Array(128);

    constructor(private readonly sampleRate: number) {
        this.harmonics = new Smoother(0, 20, sampleRate);
        this.output = new Smoother(1, 20, sampleRate);
    }

    setParams(p: BassBoostParams) {
        const sr = this.sampleRate;
        this.shelf.setCoefficients(bassShelfCoefficients(p, sr));
        this.harmonicInput.setCoefficients(
            cutFilterCoefficients('lowpass', p.frequency * 1.5, 24, 1, sr),
        );
        this.harmonicOutput.setCoefficients([
            ...cutFilterCoefficients('highpass', p.frequency * 1.6, 24, 1, sr),
            ...cutFilterCoefficients('lowpass', Math.min(p.frequency * 8, 2400), 12, 1, sr),
        ]);
        this.crossover.setFrequency(Math.min(p.frequency * 1.5, 250), sr);
        this.monoBass = p.monoBass;
        this.harmonics.set((p.harmonics / 100) * 0.6);
        this.output.set(dbToGain(p.outputDb));
    }

    process(left: Float32Array, right: Float32Array, frames: number) {
        if (this.monoBass) {
            this.lowLeft = ensureCapacity(this.lowLeft, frames);
            this.lowRight = ensureCapacity(this.lowRight, frames);
            this.crossover.split(left, this.lowLeft, left, frames, 0);
            this.crossover.split(right, this.lowRight, right, frames, 1);
            for (let i = 0; i < frames; i++) {
                const mono = (this.lowLeft[i] + this.lowRight[i]) * 0.5;
                left[i] += mono;
                right[i] += mono;
            }
        }
        for (let i = 0; i < frames; i++) {
            const l = left[i];
            const r = right[i];
            const low = this.harmonicInput.tick((l + r) * 0.5, 0);
            // Asymmetric saturation adds both odd and even harmonics.
            const shaped = Math.tanh(HARMONIC_DRIVE * (low + 0.3 * low * Math.abs(low)));
            const harmonic = this.harmonicOutput.tick(shaped / HARMONIC_DRIVE, 0) * 3;
            const amount = this.harmonics.next();
            const output = this.output.next();
            left[i] = (this.shelf.tick(l, 0) + harmonic * amount) * output;
            right[i] = (this.shelf.tick(r, 1) + harmonic * amount) * output;
        }
    }

    reset() {
        this.shelf.reset();
        this.harmonicInput.reset();
        this.harmonicOutput.reset();
        this.crossover.reset();
    }
}
