import { describe, expect, it } from 'vitest';
import { createKernel } from '../src/dsp/kernels';
import { LEVELER_FIELDS } from '../src/dsp/kernels/leveler';
import { defaultParams, type LevelerParams } from '../src/shared/effects';
import { SAMPLE_RATE, processStereo, sine } from './helpers';

/** A 1 kHz tone in both channels measures close to its level in LUFS. */
const tone = (lufs: number, seconds: number) => sine(1000, seconds, Math.pow(10, lufs / 20));

function leveler(params: Partial<LevelerParams> = {}) {
    const kernel = createKernel('leveler', SAMPLE_RATE);
    kernel.setParams({ ...defaultParams('leveler'), ...params });
    const run = (signal: Float32Array) => {
        processStereo(signal, signal, (l, r, frames) => kernel.process(l, r, frames));
        return kernel.takeMeters?.() ?? [];
    };
    return { kernel, run };
}

describe('leveler', () => {
    it('brings a quiet signal up to the target', () => {
        const { run } = leveler({ targetLufs: -20, responseS: 1 });
        const readings = run(tone(-30, 10));
        expect(readings[LEVELER_FIELDS.gain]).toBeCloseTo(10, 0);
        expect(readings[LEVELER_FIELDS.input]).toBeCloseTo(-30, 0);
        expect(readings[LEVELER_FIELDS.output]).toBeCloseTo(-20, 0);
    });

    it('turns a loud signal down, faster than it turns a quiet one up', () => {
        // After one response time, the cut has closed more of its gap than the boost.
        const up = leveler({ targetLufs: -20, responseS: 4 }).run(tone(-30, 4));
        const down = leveler({ targetLufs: -20, responseS: 4 }).run(tone(-10, 4));
        expect(down[LEVELER_FIELDS.gain]).toBeLessThan(0);
        expect(-down[LEVELER_FIELDS.gain]).toBeGreaterThan(up[LEVELER_FIELDS.gain] + 1);
    });

    it('stays within the largest boost and cut', () => {
        const quiet = leveler({ targetLufs: -18, responseS: 0.5, maxBoostDb: 6 }).run(tone(-40, 8));
        expect(quiet[LEVELER_FIELDS.gain]).toBeCloseTo(6, 1);
        const loud = leveler({ targetLufs: -30, responseS: 0.5, maxCutDb: 3 }).run(tone(-6, 8));
        expect(loud[LEVELER_FIELDS.gain]).toBeCloseTo(-3, 1);
    });

    it('applies narrower limits at once', () => {
        const { kernel, run } = leveler({ targetLufs: -20, responseS: 0.5 });
        run(tone(-32, 6));
        kernel.setParams({ ...defaultParams('leveler'), targetLufs: -20, maxBoostDb: 4 });
        expect(kernel.takeMeters?.()[LEVELER_FIELDS.gain]).toBeCloseTo(4, 1);
    });

    it('holds the gain through quiet passages below the gate', () => {
        const { run } = leveler({ targetLufs: -20, responseS: 1, gateLufs: -50 });
        const settled = run(tone(-30, 8))[LEVELER_FIELDS.gain];
        // A pause: the noise floor must not be lifted towards the target.
        const paused = run(tone(-65, 8))[LEVELER_FIELDS.gain];
        expect(paused).toBe(settled);
    });

    it('starts over at unity gain after a reset', () => {
        const { kernel, run } = leveler({ targetLufs: -20, responseS: 1 });
        run(tone(-30, 6));
        kernel.reset();
        expect(kernel.takeMeters?.()[LEVELER_FIELDS.gain]).toBe(0);
    });

    it('changes the gain smoothly, without steps between samples', () => {
        const { kernel } = leveler({ targetLufs: -20, responseS: 0.5 });
        const input = tone(-40, 3);
        const [left] = processStereo(input, input, (l, r, frames) => kernel.process(l, r, frames));
        // The gain on each sample is output over input; check it near the tone's peaks.
        const gains = Array.from(left, (sample, index) =>
            Math.abs(input[index]) > 0.009 ? sample / input[index] : Number.NaN,
        ).filter((gain) => !Number.isNaN(gain));
        const largestStep = gains
            .slice(1)
            .reduce((largest, gain, index) => Math.max(largest, Math.abs(gain - gains[index])), 0);
        expect(largestStep).toBeLessThan(0.01);
    });

    describe('fast', () => {
        /** Runs a settled tone, then a step to another level for `seconds`; returns the gain. */
        function step(params: Partial<LevelerParams>, from: number, to: number, seconds: number) {
            const { run } = leveler({ targetLufs: -20, ...params });
            run(tone(from, 3));
            return run(tone(to, seconds))[LEVELER_FIELDS.gain];
        }

        it('reaches the target within a fraction of a second', () => {
            const { run } = leveler({ targetLufs: -20, fast: true, fastResponseMs: 50 });
            const readings = run(tone(-30, 2));
            expect(readings[LEVELER_FIELDS.gain]).toBeCloseTo(10, 0);
            expect(readings[LEVELER_FIELDS.output]).toBeCloseTo(-20, 0);
        });

        it('turns a sudden loud passage down within milliseconds, unlike the slow mode', () => {
            // 14 dB louder, held for 50 ms.
            const fast = step({ fast: true, fastResponseMs: 20 }, -20, -6, 0.05);
            const slow = step({ responseS: 0.5 }, -20, -6, 0.05);
            expect(fast).toBeLessThan(-7);
            expect(slow).toBeGreaterThan(-1);
        });

        it('turns down twice as fast as it turns up', () => {
            const down = step({ fast: true, fastResponseMs: 200 }, -20, -10, 0.1);
            const up = step({ fast: true, fastResponseMs: 200 }, -20, -30, 0.1);
            expect(-down).toBeGreaterThan(up * 1.4);
        });

        it('holds the gain below the gate', () => {
            const { run } = leveler({ targetLufs: -20, fast: true, fastResponseMs: 50 });
            const settled = run(tone(-30, 2))[LEVELER_FIELDS.gain];
            const paused = run(tone(-65, 2))[LEVELER_FIELDS.gain];
            expect(Math.abs(paused - settled)).toBeLessThan(0.2);
        });

        it('keeps the gain when switching between slow and fast', () => {
            const { kernel, run } = leveler({ targetLufs: -20, responseS: 1 });
            const slow = run(tone(-30, 6))[LEVELER_FIELDS.gain];
            kernel.setParams({ ...defaultParams('leveler'), targetLufs: -20, fast: true });
            expect(kernel.takeMeters?.()[LEVELER_FIELDS.gain]).toBe(slow);
        });

        it('changes the gain smoothly, without steps between samples', () => {
            const { kernel } = leveler({ targetLufs: -20, fast: true, fastResponseMs: 20 });
            const input = tone(-40, 1);
            const [left] = processStereo(input, input, (l, r, frames) =>
                kernel.process(l, r, frames),
            );
            const gains = Array.from(left, (sample, index) =>
                Math.abs(input[index]) > 0.009 ? sample / input[index] : Number.NaN,
            ).filter((gain) => !Number.isNaN(gain));
            const largestStep = gains
                .slice(1)
                .reduce(
                    (largest, gain, index) => Math.max(largest, Math.abs(gain - gains[index])),
                    0,
                );
            expect(largestStep).toBeLessThan(0.05);
        });
    });
});
