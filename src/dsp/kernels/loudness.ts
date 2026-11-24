import type { LoudnessParams } from '../../shared/effects';
import { LoudnessMeter, SILENCE_LUFS, TruePeakMeter } from '../loudness';
import { gainToDb } from '../util';
import type { Kernel } from './kernel';

/** Layout of the readings produced by {@link LoudnessKernel}. */
export const LOUDNESS_FIELDS = {
    momentary: 0,
    shortTerm: 1,
    integrated: 2,
    range: 3,
    truePeak: 4,
    maxTruePeak: 5,
    maxMomentary: 6,
    maxShortTerm: 7,
    seconds: 8,
};

function round(value: number) {
    return Math.round(Math.max(SILENCE_LUFS, value) * 100) / 100;
}

/**
 * Pass-through loudness analyzer per EBU R128 / ITU-R BS.1770: momentary, short-term and gated
 * integrated loudness, loudness range and true peak, measured since the last reset. Changing the
 * `resets` parameter restarts the measurement.
 */
export class LoudnessKernel implements Kernel<LoudnessParams> {
    private readonly meter: LoudnessMeter;
    private readonly truePeak = new TruePeakMeter();
    private resets: number | undefined;
    private samples = 0;

    constructor(private readonly sampleRate: number) {
        this.meter = new LoudnessMeter(sampleRate, true);
    }

    setParams(p: LoudnessParams) {
        if (this.resets !== undefined && p.resets !== this.resets) {
            this.reset();
        }
        this.resets = p.resets;
    }

    process(left: Float32Array, right: Float32Array, frames: number) {
        this.meter.process(left, right, frames);
        this.truePeak.process(left, right, frames);
        this.samples += frames;
    }

    reset() {
        this.meter.reset();
        this.truePeak.reset();
        this.samples = 0;
    }

    takeMeters(): number[] {
        const m = this.meter;
        return [
            round(m.momentary),
            round(m.shortTerm),
            round(m.integratedLoudness),
            round(m.loudnessRange),
            round(gainToDb(this.truePeak.takePeak())),
            round(gainToDb(this.truePeak.maxPeak)),
            round(m.maxMomentary),
            round(m.maxShortTerm),
            Math.round((this.samples / this.sampleRate) * 10) / 10,
        ];
    }
}
