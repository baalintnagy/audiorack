import type { RackState } from '../shared/effects';
import type { MeterFrame } from '../shared/messages';
import { LevelMeter } from './meter';
import { StagePool } from './pool';
import { SerialChain, type MeterSink } from './stage';
import { Smoother, dbToGain, ensureCapacity } from './util';

const CROSSFADE_MS = 12;

/** Runs the effect chain on stereo blocks; host-independent so it can be unit tested. */
export class RackProcessor {
    private readonly pool: StagePool;
    private readonly chain = new SerialChain();
    private readonly input: Smoother;
    private readonly output: Smoother;
    private readonly engaged: Smoother;
    private rackDryLeft = new Float32Array(128);
    private rackDryRight = new Float32Array(128);
    private readonly inputMeter = new LevelMeter();
    private readonly outputMeter = new LevelMeter();

    constructor(sampleRate: number) {
        this.pool = new StagePool(sampleRate);
        this.input = new Smoother(1, 20, sampleRate);
        this.output = new Smoother(1, 20, sampleRate);
        this.engaged = new Smoother(1, CROSSFADE_MS, sampleRate);
    }

    setRack(rack: RackState) {
        this.chain.setStages(this.pool.resolve(rack.chain));
        this.input.set(dbToGain(rack.inputDb));
        this.output.set(dbToGain(rack.outputDb));
        this.engaged.set(rack.bypass ? 0 : 1);
    }

    private ensureScratch(frames: number) {
        this.rackDryLeft = ensureCapacity(this.rackDryLeft, frames);
        this.rackDryRight = ensureCapacity(this.rackDryRight, frames);
    }

    /** Processes `left`/`right` in place. */
    process(left: Float32Array, right: Float32Array, frames: number) {
        this.ensureScratch(frames);
        this.inputMeter.add(left, right, frames);
        const engagedSettled = this.engaged.settled;
        if (engagedSettled && this.engaged.value === 0) {
            this.outputMeter.add(left, right, frames);
            return;
        }
        const crossfading = !engagedSettled;
        if (crossfading) {
            this.rackDryLeft.set(left.subarray(0, frames));
            this.rackDryRight.set(right.subarray(0, frames));
        }
        for (let i = 0; i < frames; i++) {
            const gain = this.input.next();
            left[i] *= gain;
            right[i] *= gain;
        }
        this.chain.process(left, right, frames);
        for (let i = 0; i < frames; i++) {
            const gain = this.output.next();
            const l = left[i] * gain;
            const r = right[i] * gain;
            // Replace NaN/Infinity so a misbehaving stage cannot blast the output.
            left[i] = Number.isFinite(l) ? l : 0;
            right[i] = Number.isFinite(r) ? r : 0;
        }
        if (crossfading) {
            for (let i = 0; i < frames; i++) {
                const engaged = this.engaged.next();
                left[i] = left[i] * engaged + this.rackDryLeft[i] * (1 - engaged);
                right[i] = right[i] * engaged + this.rackDryRight[i] * (1 - engaged);
            }
        }
        this.outputMeter.add(left, right, frames);
    }

    takeMeters(): MeterFrame {
        const input = this.inputMeter.take();
        const output = this.outputMeter.take();
        const sink: MeterSink = { effects: {}, signals: {} };
        // While the whole rack is bypassed the chain does not run, so it has no readings either.
        if (!this.engaged.settled || this.engaged.value !== 0) {
            this.chain.collectMeters(sink);
        }
        return {
            inputPeak: input.peak,
            inputRms: input.rms,
            outputPeak: output.peak,
            outputRms: output.rms,
            ...sink,
        };
    }
}
