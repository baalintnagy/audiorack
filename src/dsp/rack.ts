import type { EffectType, RackState } from '../shared/effects';
import type { MeterFrame } from '../shared/messages';
import { createKernel, type Kernel } from './kernels';
import { Smoother, dbToGain, ensureCapacity } from './util';

const CROSSFADE_MS = 12;

interface Slot {
    id: string;
    type: EffectType;
    kernel: Kernel<unknown>;
    wet: Smoother;
    active: boolean;
}

class LevelMeter {
    private peak = [0, 0];
    private squares = [0, 0];
    private count = 0;

    add(left: Float32Array, right: Float32Array, frames: number) {
        [left, right].forEach((buffer, channel) => {
            let peak = this.peak[channel];
            let squares = this.squares[channel];
            for (let i = 0; i < frames; i++) {
                const value = buffer[i];
                const magnitude = Math.abs(value);
                if (magnitude > peak) {
                    peak = magnitude;
                }
                squares += value * value;
            }
            this.peak[channel] = peak;
            this.squares[channel] = squares;
        });
        this.count += frames;
    }

    take(): { peak: [number, number]; rms: [number, number] } {
        const count = Math.max(this.count, 1);
        const result = {
            peak: [this.peak[0], this.peak[1]] as [number, number],
            rms: [Math.sqrt(this.squares[0] / count), Math.sqrt(this.squares[1] / count)] as [
                number,
                number,
            ],
        };
        this.peak = [0, 0];
        this.squares = [0, 0];
        this.count = 0;
        return result;
    }
}

/** Runs the effect chain on stereo blocks; host-independent so it can be unit tested. */
export class RackProcessor {
    private slots: Slot[] = [];
    private readonly input: Smoother;
    private readonly output: Smoother;
    private readonly engaged: Smoother;
    private dryLeft = new Float32Array(128);
    private dryRight = new Float32Array(128);
    private rackDryLeft = new Float32Array(128);
    private rackDryRight = new Float32Array(128);
    private readonly inputMeter = new LevelMeter();
    private readonly outputMeter = new LevelMeter();

    constructor(private readonly sampleRate: number) {
        this.input = new Smoother(1, 20, sampleRate);
        this.output = new Smoother(1, 20, sampleRate);
        this.engaged = new Smoother(1, CROSSFADE_MS, sampleRate);
    }

    setRack(rack: RackState) {
        const existing = new Map(this.slots.map((slot) => [slot.id, slot]));
        this.slots = rack.chain.map((effect) => {
            const previous = existing.get(effect.id);
            const slot: Slot =
                previous && previous.type === effect.type
                    ? previous
                    : {
                          id: effect.id,
                          type: effect.type,
                          kernel: createKernel(effect.type, this.sampleRate),
                          wet: new Smoother(effect.bypass ? 0 : 1, CROSSFADE_MS, this.sampleRate),
                          active: !effect.bypass,
                      };
            slot.kernel.setParams(effect.params);
            if (!slot.active && !effect.bypass && slot.wet.value === 0) {
                // Clear stale filter and envelope state before fading back in.
                slot.kernel.reset();
            }
            slot.active = !effect.bypass;
            slot.wet.set(slot.active ? 1 : 0);
            return slot;
        });
        this.input.set(dbToGain(rack.inputDb));
        this.output.set(dbToGain(rack.outputDb));
        this.engaged.set(rack.bypass ? 0 : 1);
    }

    private ensureScratch(frames: number) {
        this.dryLeft = ensureCapacity(this.dryLeft, frames);
        this.dryRight = ensureCapacity(this.dryRight, frames);
        this.rackDryLeft = ensureCapacity(this.rackDryLeft, frames);
        this.rackDryRight = ensureCapacity(this.rackDryRight, frames);
    }

    private runSlot(slot: Slot, left: Float32Array, right: Float32Array, frames: number) {
        if (slot.wet.settled && slot.wet.value === 0) {
            return;
        }
        if (slot.wet.settled && slot.wet.value === 1) {
            slot.kernel.process(left, right, frames);
            return;
        }
        this.dryLeft.set(left.subarray(0, frames));
        this.dryRight.set(right.subarray(0, frames));
        slot.kernel.process(left, right, frames);
        for (let i = 0; i < frames; i++) {
            const wet = slot.wet.next();
            left[i] = left[i] * wet + this.dryLeft[i] * (1 - wet);
            right[i] = right[i] * wet + this.dryRight[i] * (1 - wet);
        }
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
        this.slots.forEach((slot) => this.runSlot(slot, left, right, frames));
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
        return {
            inputPeak: input.peak,
            inputRms: input.rms,
            outputPeak: output.peak,
            outputRms: output.rms,
            effects: Object.fromEntries(
                this.slots.map((slot) => [slot.id, slot.kernel.takeMeters?.() ?? []]),
            ),
        };
    }
}
