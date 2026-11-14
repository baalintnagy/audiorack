import type { LimiterParams } from '../../shared/effects';
import { Smoother, dbToGain, gainToDb, timeCoefficient } from '../util';
import type { Kernel } from './kernel';

/** Running minimum over the most recent `length` values using a monotonic deque. */
export class SlidingMinimum {
    private readonly values: Float64Array;
    private readonly indices: Float64Array;
    private head = 0;
    private count = 0;
    private index = 0;

    constructor(private readonly length: number) {
        this.values = new Float64Array(length + 1);
        this.indices = new Float64Array(length + 1);
    }

    push(value: number): number {
        const capacity = this.values.length;
        while (this.count > 0) {
            const back = (this.head + this.count - 1) % capacity;
            if (this.values[back] < value) {
                break;
            }
            this.count--;
        }
        const slot = (this.head + this.count) % capacity;
        this.values[slot] = value;
        this.indices[slot] = this.index;
        this.count++;
        while (this.indices[this.head] <= this.index - this.length) {
            this.head = (this.head + 1) % capacity;
            this.count--;
        }
        this.index++;
        return this.values[this.head];
    }
}

/**
 * Lookahead brickwall limiter. The required gain is held over the lookahead window and
 * smoothed with a moving average of the same length, so the gain reaches its target
 * before a peak leaves the delay line.
 */
export class LimiterKernel implements Kernel<LimiterParams> {
    private length = 0;
    private delayLeft = new Float32Array(1);
    private delayRight = new Float32Array(1);
    private average = new Float64Array(1);
    private position = 0;
    private sum = 0;
    private minimum = new SlidingMinimum(1);
    private released = 1;
    private release = 0;
    private ceiling = 1;
    private readonly input: Smoother;
    private peakReduction = 0;

    constructor(private readonly sampleRate: number) {
        this.input = new Smoother(1, 20, sampleRate);
    }

    setParams(p: LimiterParams) {
        const length = Math.max(1, Math.round((p.lookaheadMs / 1000) * this.sampleRate));
        if (length !== this.length) {
            this.length = length;
            this.reset();
        }
        this.ceiling = dbToGain(p.ceilingDb);
        this.release = timeCoefficient(p.releaseMs, this.sampleRate);
        this.input.set(dbToGain(p.inputDb));
    }

    reset() {
        this.delayLeft = new Float32Array(this.length);
        this.delayRight = new Float32Array(this.length);
        this.average = new Float64Array(this.length).fill(1);
        this.sum = this.length;
        this.position = 0;
        this.minimum = new SlidingMinimum(this.length);
        this.released = 1;
    }

    /** Delay in samples between input and output. */
    get latency() {
        return this.length - 1;
    }

    process(left: Float32Array, right: Float32Array, frames: number) {
        const length = this.length;
        const ceiling = this.ceiling;
        for (let i = 0; i < frames; i++) {
            const drive = this.input.next();
            const l = left[i] * drive;
            const r = right[i] * drive;
            const peak = Math.max(Math.abs(l), Math.abs(r));
            const required = peak > ceiling ? ceiling / peak : 1;
            const held = this.minimum.push(required);
            this.released =
                held < this.released ? held : held + (this.released - held) * this.release;
            this.sum += this.released - this.average[this.position];
            this.average[this.position] = this.released;
            const gain = Math.min(1, this.sum / length);
            this.delayLeft[this.position] = l;
            this.delayRight[this.position] = r;
            const read = (this.position + 1) % length;
            // A final clamp guards against rounding in the running sum.
            left[i] = Math.max(-ceiling, Math.min(ceiling, this.delayLeft[read] * gain));
            right[i] = Math.max(-ceiling, Math.min(ceiling, this.delayRight[read] * gain));
            this.position = read;
            if (read === 0) {
                // Recompute the running sum once per cycle to avoid accumulated drift.
                this.sum = this.average.reduce((total, value) => total + value, 0);
            }
            const reduction = -gainToDb(gain);
            if (reduction > this.peakReduction) {
                this.peakReduction = reduction;
            }
        }
    }

    takeMeters() {
        const value = this.peakReduction;
        this.peakReduction = 0;
        return [value];
    }
}
