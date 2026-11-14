import type { DeesserParams } from '../../shared/effects';
import { Biquad, biquadCoefficients } from '../biquad';
import { LinkwitzRiley } from '../crossover';
import { dbToGain, ensureCapacity, gainToDb, timeCoefficient } from '../util';
import type { Kernel } from './kernel';

const RATIO = 6;

/**
 * Detects sibilance with a band-pass sidechain and reduces either the band above the
 * crossover (split mode) or the full signal (wide mode).
 */
export class DeesserKernel implements Kernel<DeesserParams> {
    private readonly detector = new Biquad();
    private readonly crossover = new LinkwitzRiley();
    private params?: DeesserParams;
    private readonly attack: number;
    private release = 0;
    private envelope = 0;
    private reduction = 0;
    private peakReduction = 0;
    private lowLeft = new Float32Array(128);
    private lowRight = new Float32Array(128);

    constructor(private readonly sampleRate: number) {
        this.attack = timeCoefficient(0.5, sampleRate);
    }

    setParams(p: DeesserParams) {
        this.params = p;
        this.detector.setCoefficients(
            biquadCoefficients('bandpass', p.frequency, 1.2, 0, this.sampleRate),
        );
        this.crossover.setFrequency(p.frequency * 0.7, this.sampleRate);
        this.release = timeCoefficient(p.releaseMs, this.sampleRate);
    }

    process(left: Float32Array, right: Float32Array, frames: number) {
        const p = this.params;
        if (!p) {
            return;
        }
        const split = p.mode === 'split' && !p.listen;
        if (split) {
            this.lowLeft = ensureCapacity(this.lowLeft, frames);
            this.lowRight = ensureCapacity(this.lowRight, frames);
            this.crossover.split(left, this.lowLeft, left, frames, 0);
            this.crossover.split(right, this.lowRight, right, frames, 1);
        }
        for (let i = 0; i < frames; i++) {
            const inLeft = split ? left[i] + this.lowLeft[i] : left[i];
            const inRight = split ? right[i] + this.lowRight[i] : right[i];
            const sl = this.detector.tick(inLeft, 0);
            const sr = this.detector.tick(inRight, 1);
            const level = Math.max(Math.abs(sl), Math.abs(sr));
            const envelopeCoefficient = level > this.envelope ? this.attack : this.release;
            this.envelope = level + (this.envelope - level) * envelopeCoefficient;
            const over = gainToDb(this.envelope) - p.thresholdDb;
            const target = over > 0 ? Math.min(p.rangeDb, over * (1 - 1 / RATIO)) : 0;
            const coefficient = target > this.reduction ? this.attack : this.release;
            this.reduction = target + (this.reduction - target) * coefficient;
            if (this.reduction > this.peakReduction) {
                this.peakReduction = this.reduction;
            }
            if (p.listen) {
                left[i] = sl;
                right[i] = sr;
                continue;
            }
            const gain = dbToGain(-this.reduction);
            if (split) {
                left[i] = this.lowLeft[i] + left[i] * gain;
                right[i] = this.lowRight[i] + right[i] * gain;
            } else {
                left[i] *= gain;
                right[i] *= gain;
            }
        }
    }

    reset() {
        this.detector.reset();
        this.crossover.reset();
        this.envelope = 0;
        this.reduction = 0;
    }

    takeMeters() {
        const value = this.peakReduction;
        this.peakReduction = this.reduction;
        return [value];
    }
}
