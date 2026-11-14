import type { EqParams } from '../../shared/effects';
import { BiquadCascade } from '../biquad';
import { eqBandCoefficients } from '../eq';
import { Smoother, dbToGain } from '../util';
import type { Kernel } from './kernel';

export class EqKernel implements Kernel<EqParams> {
    private filters = new Map<string, BiquadCascade>();
    private readonly output: Smoother;

    constructor(private readonly sampleRate: number) {
        this.output = new Smoother(1, 20, sampleRate);
    }

    setParams(params: EqParams) {
        const next = new Map<string, BiquadCascade>();
        params.bands.forEach((band) => {
            const filter = this.filters.get(band.id) ?? new BiquadCascade();
            filter.setCoefficients(eqBandCoefficients(band, this.sampleRate));
            next.set(band.id, filter);
        });
        this.filters = next;
        this.output.set(dbToGain(params.outputDb));
    }

    process(left: Float32Array, right: Float32Array, frames: number) {
        this.filters.forEach((filter) => {
            filter.process(left, frames, 0);
            filter.process(right, frames, 1);
        });
        for (let i = 0; i < frames; i++) {
            const gain = this.output.next();
            left[i] *= gain;
            right[i] *= gain;
        }
    }

    reset() {
        this.filters.forEach((filter) => filter.reset());
    }
}
