import type { Effect, ParallelBranch, ParallelGroup } from '../shared/effects';
import { StereoDelay } from './delay';
import { LevelMeter } from './meter';
import { SerialChain, type MeterSink, type Stage } from './stage';
import { Smoother, dbToGain, ensureCapacity, panGains } from './util';

const GAIN_SMOOTHING_MS = 20;

/** Values reported per branch in the group's meter readings. */
export const BRANCH_METER_VALUES = 4;

class Branch {
    readonly chain = new SerialChain();
    readonly delay = new StereoDelay();
    readonly meter = new LevelMeter();
    readonly gainLeft: Smoother;
    readonly gainRight: Smoother;

    constructor(
        readonly id: string,
        sampleRate: number,
    ) {
        this.gainLeft = new Smoother(1, GAIN_SMOOTHING_MS, sampleRate);
        this.gainRight = new Smoother(1, GAIN_SMOOTHING_MS, sampleRate);
    }

    /** Applies the channel-strip settings: level, pan, polarity, mute and solo. */
    setMix(config: ParallelBranch, soloActive: boolean) {
        const audible = !config.mute && (!soloActive || config.solo);
        const gain = audible ? dbToGain(config.gainDb) * (config.invert ? -1 : 1) : 0;
        const pan = panGains(config.pan);
        this.gainLeft.set(gain * pan.left);
        this.gainRight.set(gain * pan.right);
    }
}

/**
 * Feeds the same input to every branch and sums their outputs. Branches are delayed to the
 * latency of the slowest one, so effects with lookahead do not comb-filter against the others.
 *
 * Meter readings for the group id hold `[peakL, peakR, rmsL, rmsR]` per branch (post-fader),
 * followed by the same four values for the sum.
 */
export class ParallelStage implements Stage {
    private branches: Branch[] = [];
    private inputLeft = new Float32Array(128);
    private inputRight = new Float32Array(128);
    private branchLeft = new Float32Array(128);
    private branchRight = new Float32Array(128);
    private readonly sumMeter = new LevelMeter();
    private sumLeft = new Float32Array(128);
    private sumRight = new Float32Array(128);

    constructor(
        readonly id: string,
        private readonly sampleRate: number,
    ) {}

    configure(group: ParallelGroup, resolve: (effect: Effect) => Stage) {
        const existing = new Map(this.branches.map((branch) => [branch.id, branch]));
        const soloActive = group.branches.some((branch) => branch.solo);
        this.branches = group.branches.map((config) => {
            const branch = existing.get(config.id) ?? new Branch(config.id, this.sampleRate);
            branch.chain.setStages(config.effects.map(resolve));
            branch.setMix(config, soloActive);
            return branch;
        });
        const latency = this.latency;
        this.branches.forEach((branch) => branch.delay.setDelay(latency - branch.chain.latency));
    }

    get latency() {
        return Math.max(0, ...this.branches.map((branch) => branch.chain.latency));
    }

    private ensureScratch(frames: number) {
        this.inputLeft = ensureCapacity(this.inputLeft, frames);
        this.inputRight = ensureCapacity(this.inputRight, frames);
        this.branchLeft = ensureCapacity(this.branchLeft, frames);
        this.branchRight = ensureCapacity(this.branchRight, frames);
        this.sumLeft = ensureCapacity(this.sumLeft, frames);
        this.sumRight = ensureCapacity(this.sumRight, frames);
    }

    private runBranch(branch: Branch, frames: number) {
        const left = this.branchLeft;
        const right = this.branchRight;
        const sumLeft = this.sumLeft;
        const sumRight = this.sumRight;
        left.set(this.inputLeft.subarray(0, frames));
        right.set(this.inputRight.subarray(0, frames));
        branch.chain.process(left, right, frames);
        branch.delay.process(left, right, frames);
        for (let i = 0; i < frames; i++) {
            left[i] *= branch.gainLeft.next();
            right[i] *= branch.gainRight.next();
            sumLeft[i] += left[i];
            sumRight[i] += right[i];
        }
        branch.meter.add(left, right, frames);
    }

    process(left: Float32Array, right: Float32Array, frames: number) {
        this.ensureScratch(frames);
        this.inputLeft.set(left.subarray(0, frames));
        this.inputRight.set(right.subarray(0, frames));
        this.sumLeft.fill(0, 0, frames);
        this.sumRight.fill(0, 0, frames);
        this.branches.forEach((branch) => this.runBranch(branch, frames));
        this.sumMeter.add(this.sumLeft, this.sumRight, frames);
        left.set(this.sumLeft.subarray(0, frames));
        right.set(this.sumRight.subarray(0, frames));
    }

    reset() {
        this.branches.forEach((branch) => {
            branch.chain.reset();
            branch.delay.reset();
        });
    }

    collectMeters(into: MeterSink) {
        this.branches.forEach((branch) => branch.chain.collectMeters(into));
        into.effects[this.id] = [
            ...this.branches.map((branch) => branch.meter),
            this.sumMeter,
        ].flatMap((meter) => {
            const { peak, rms } = meter.take();
            return [...peak, ...rms];
        });
    }
}
