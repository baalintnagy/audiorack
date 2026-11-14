import type { CompressorParams } from '../../shared/effects';
import { BUTTERWORTH_Q, Biquad, biquadCoefficients } from '../biquad';
import { DynamicsCore, autoMakeupDb } from '../dynamics';
import { Smoother, dbToGain } from '../util';
import type { Kernel } from './kernel';

export class CompressorKernel implements Kernel<CompressorParams> {
    private readonly core: DynamicsCore;
    private readonly sidechain = new Biquad();
    private sidechainEnabled = false;
    private readonly makeup: Smoother;
    private readonly mix: Smoother;

    constructor(private readonly sampleRate: number) {
        this.core = new DynamicsCore(sampleRate);
        this.makeup = new Smoother(1, 20, sampleRate);
        this.mix = new Smoother(1, 20, sampleRate);
    }

    setParams(p: CompressorParams) {
        this.core.configure(p);
        this.sidechainEnabled = p.sidechainHpHz > 20.5;
        this.sidechain.setCoefficients(
            biquadCoefficients('highpass', p.sidechainHpHz, BUTTERWORTH_Q, 0, this.sampleRate),
        );
        const makeupDb = p.makeupDb + (p.autoMakeup ? autoMakeupDb(p.thresholdDb, p.ratio) : 0);
        this.makeup.set(dbToGain(makeupDb));
        this.mix.set(p.mix / 100);
    }

    process(left: Float32Array, right: Float32Array, frames: number) {
        for (let i = 0; i < frames; i++) {
            const l = left[i];
            const r = right[i];
            const gain = this.sidechainEnabled
                ? this.core.gain(this.sidechain.tick(l, 0), this.sidechain.tick(r, 1))
                : this.core.gain(l, r);
            const mix = this.mix.next();
            const wet = gain * this.makeup.next() * mix + (1 - mix);
            left[i] = l * wet;
            right[i] = r * wet;
        }
    }

    reset() {
        this.core.reset();
        this.sidechain.reset();
    }

    takeMeters() {
        return [this.core.takePeakReduction()];
    }
}
