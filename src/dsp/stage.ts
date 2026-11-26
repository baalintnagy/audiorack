import type { EffectType } from '../shared/effects';
import type { SignalReading } from '../shared/messages';
import { StereoDelay } from './delay';
import { createKernel, type Kernel } from './kernels';
import { SignalProbe } from './probe';
import { Smoother, ensureCapacity } from './util';

const CROSSFADE_MS = 12;

/** Where stages leave what they measured for the next meter frame, keyed by effect or group id. */
export interface MeterSink {
    /** Each effect's own readings, such as gain reduction, and the branch levels of groups. */
    effects: Record<string, number[]>;
    /** Each effect's own signal; see {@link SignalReading}. */
    signals: Record<string, SignalReading>;
}

/** A node of the processing tree: an effect, a serial chain or a parallel group. */
export interface Stage {
    /** Delay in samples between input and output. */
    readonly latency: number;
    /** Processes a stereo block in place. */
    process(left: Float32Array, right: Float32Array, frames: number): void;
    reset(): void;
    /** Adds what it measured since the previous call. */
    collectMeters(into: MeterSink): void;
}

/** Runs one effect kernel, watching its own signal on the way in and out. */
export class EffectStage implements Stage {
    private readonly kernel: Kernel<unknown>;
    private readonly probe: SignalProbe;

    constructor(
        readonly id: string,
        readonly type: EffectType,
        sampleRate: number,
    ) {
        this.kernel = createKernel(type, sampleRate);
        this.probe = new SignalProbe(type, sampleRate);
    }

    configure(params: unknown) {
        this.kernel.setParams(params);
    }

    get latency() {
        return this.kernel.latency ?? 0;
    }

    process(left: Float32Array, right: Float32Array, frames: number) {
        this.probe.observeInput(left, right, frames);
        this.kernel.process(left, right, frames);
        this.probe.observeOutput(left, right, frames);
    }

    reset() {
        this.kernel.reset();
        this.probe.reset();
    }

    collectMeters(into: MeterSink) {
        into.effects[this.id] = this.kernel.takeMeters?.() ?? [];
        into.signals[this.id] = this.probe.take();
    }
}

/**
 * Crossfades between a stage and its dry input when it is bypassed. The dry path is delayed by
 * the stage's latency, so bypassing never shifts the signal in time.
 */
export class BypassStage<S extends Stage> implements Stage {
    private readonly wet: Smoother;
    private readonly dryDelay = new StereoDelay();
    private dryLeft = new Float32Array(128);
    private dryRight = new Float32Array(128);
    private active: boolean;

    constructor(
        readonly inner: S,
        bypass: boolean,
        sampleRate: number,
    ) {
        this.wet = new Smoother(bypass ? 0 : 1, CROSSFADE_MS, sampleRate);
        this.active = !bypass;
    }

    /** Applies the bypass state; call after configuring the inner stage. */
    setBypass(bypass: boolean) {
        if (!this.active && !bypass && this.wet.value === 0) {
            // Clear stale filter and envelope state before fading back in.
            this.inner.reset();
        }
        this.active = !bypass;
        this.wet.set(this.active ? 1 : 0);
        this.dryDelay.setDelay(this.inner.latency);
    }

    get latency() {
        return this.inner.latency;
    }

    process(left: Float32Array, right: Float32Array, frames: number) {
        const off = this.wet.settled && this.wet.value === 0;
        const on = this.wet.settled && this.wet.value === 1;
        const aligned = this.dryDelay.delay > 0;
        if (!aligned && off) {
            return;
        }
        if (!aligned && on) {
            this.inner.process(left, right, frames);
            return;
        }
        this.dryLeft = ensureCapacity(this.dryLeft, frames);
        this.dryRight = ensureCapacity(this.dryRight, frames);
        this.dryLeft.set(left.subarray(0, frames));
        this.dryRight.set(right.subarray(0, frames));
        // Keep the compensation delay fed even while fully wet, so fading out is seamless.
        this.dryDelay.process(this.dryLeft, this.dryRight, frames);
        if (off) {
            left.set(this.dryLeft.subarray(0, frames));
            right.set(this.dryRight.subarray(0, frames));
            return;
        }
        this.inner.process(left, right, frames);
        if (on) {
            return;
        }
        for (let i = 0; i < frames; i++) {
            const wet = this.wet.next();
            left[i] = left[i] * wet + this.dryLeft[i] * (1 - wet);
            right[i] = right[i] * wet + this.dryRight[i] * (1 - wet);
        }
    }

    reset() {
        this.inner.reset();
        this.dryDelay.reset();
    }

    /**
     * Once fully bypassed, the stage measures nothing, so it reports no readings: its displays
     * then show silence rather than holding the last readings it had.
     */
    collectMeters(into: MeterSink) {
        if (this.wet.settled && this.wet.value === 0) {
            return;
        }
        this.inner.collectMeters(into);
    }
}

/** Runs stages one after another. */
export class SerialChain implements Stage {
    private stages: Stage[] = [];

    setStages(stages: Stage[]) {
        this.stages = stages;
    }

    get latency() {
        return this.stages.reduce((total, stage) => total + stage.latency, 0);
    }

    process(left: Float32Array, right: Float32Array, frames: number) {
        this.stages.forEach((stage) => stage.process(left, right, frames));
    }

    reset() {
        this.stages.forEach((stage) => stage.reset());
    }

    collectMeters(into: MeterSink) {
        this.stages.forEach((stage) => stage.collectMeters(into));
    }
}
