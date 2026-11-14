import type { FilterParams } from '../../shared/effects';
import {
    BUTTERWORTH_Q,
    BiquadCascade,
    biquadCoefficients,
    cutFilterCoefficients,
    type BiquadCoefficients,
} from '../biquad';
import { Smoother, dbToGain, ensureCapacity } from '../util';
import type { Kernel } from './kernel';

const UPDATE_INTERVAL = 32;

export function filterCoefficients(
    p: Pick<FilterParams, 'mode' | 'q' | 'slope'>,
    cutoff: number,
    sampleRate: number,
): BiquadCoefficients[] {
    switch (p.mode) {
        case 'lowpass':
        case 'highpass':
            return cutFilterCoefficients(p.mode, cutoff, p.slope, p.q / BUTTERWORTH_Q, sampleRate);
        case 'bandpass':
        case 'notch': {
            const c = biquadCoefficients(p.mode, cutoff, p.q, 0, sampleRate);
            return Array.from({ length: Math.max(1, Math.round(p.slope / 24)) }, () => c);
        }
    }
}

export function lfoValue(shape: FilterParams['lfoShape'], phase: number): number {
    return shape === 'sine'
        ? Math.sin(2 * Math.PI * phase)
        : 1 - 4 * Math.abs(phase - Math.floor(phase + 0.5));
}

export class FilterKernel implements Kernel<FilterParams> {
    private readonly filter = new BiquadCascade();
    private params?: FilterParams;
    private phase = 0;
    private readonly mix: Smoother;
    private readonly cutoff: Smoother;
    private dryLeft = new Float32Array(128);
    private dryRight = new Float32Array(128);
    private currentCutoff = 1000;

    constructor(private readonly sampleRate: number) {
        this.mix = new Smoother(1, 20, sampleRate);
        this.cutoff = new Smoother(Math.log2(2000), 30, sampleRate / UPDATE_INTERVAL);
    }

    setParams(p: FilterParams) {
        if (!this.params) {
            this.cutoff.jump(Math.log2(p.cutoff));
        }
        this.params = p;
        this.cutoff.set(Math.log2(p.cutoff));
        this.mix.set(p.mix / 100);
    }

    private update(p: FilterParams) {
        const modulation = p.lfoDepth > 0 ? lfoValue(p.lfoShape, this.phase) * p.lfoDepth : 0;
        this.currentCutoff = Math.min(
            Math.max(Math.pow(2, this.cutoff.next() + modulation), 20),
            20000,
        );
        this.filter.setCoefficients(filterCoefficients(p, this.currentCutoff, this.sampleRate));
    }

    process(left: Float32Array, right: Float32Array, frames: number) {
        const p = this.params;
        if (!p) {
            return;
        }
        this.dryLeft = ensureCapacity(this.dryLeft, frames);
        this.dryRight = ensureCapacity(this.dryRight, frames);
        this.dryLeft.set(left.subarray(0, frames));
        this.dryRight.set(right.subarray(0, frames));
        const drive = dbToGain(p.driveDb);
        const driveMakeup = 1 / Math.sqrt(drive);
        const increment = p.lfoRate / this.sampleRate;
        for (let start = 0; start < frames; start += UPDATE_INTERVAL) {
            const end = Math.min(frames, start + UPDATE_INTERVAL);
            this.update(p);
            this.phase = (this.phase + increment * (end - start)) % 1;
            for (let i = start; i < end; i++) {
                let l = left[i];
                let r = right[i];
                if (p.driveDb > 0) {
                    l = Math.tanh(l * drive) * driveMakeup;
                    r = Math.tanh(r * drive) * driveMakeup;
                }
                left[i] = this.filter.tick(l, 0);
                right[i] = this.filter.tick(r, 1);
            }
        }
        for (let i = 0; i < frames; i++) {
            const mix = this.mix.next();
            left[i] = left[i] * mix + this.dryLeft[i] * (1 - mix);
            right[i] = right[i] * mix + this.dryRight[i] * (1 - mix);
        }
    }

    reset() {
        this.filter.reset();
    }

    /** Current modulated cutoff, for the editor display. */
    takeMeters() {
        return [this.currentCutoff];
    }
}
