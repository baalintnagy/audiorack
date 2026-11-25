import { describe, expect, it } from 'vitest';
import { createKernel } from '../src/dsp/kernels';
import { saturate } from '../src/dsp/kernels/saturator';
import {
    MAX_OVERSAMPLING_LATENCY,
    OVERSAMPLING_LATENCY,
    Oversampler,
} from '../src/dsp/oversampling';
import { RackProcessor } from '../src/dsp/rack';
import {
    OVERSAMPLING_FACTORS,
    SATURATION_STYLES,
    createEffect,
    defaultParams,
    defaultRack,
    defaultSaturatorBand,
    type SaturatorBand,
    type SaturatorParams,
} from '../src/shared/effects';
import { normalizeRack } from '../src/shared/normalize';
import { SAMPLE_RATE, db, noise, peak, processStereo, rms, sine } from './helpers';

function saturator(params: Partial<SaturatorParams> = {}) {
    const kernel = createKernel('saturator', SAMPLE_RATE);
    kernel.setParams({ ...defaultParams('saturator'), ...params });
    return kernel;
}

function bands(count: number, patch: Partial<SaturatorBand> = {}): SaturatorBand[] {
    return Array.from({ length: count }, () => defaultSaturatorBand(patch));
}

function run(kernel: ReturnType<typeof saturator>, left: Float32Array, right = left) {
    return processStereo(left, right, (l, r, frames) => kernel.process(l, r, frames));
}

function impulse(length: number, at: number, amplitude = 1): Float32Array {
    const signal = new Float32Array(length);
    signal[at] = amplitude;
    return signal;
}

function argMax(signal: Float32Array): number {
    return signal.reduce(
        (best, value, index) => (Math.abs(value) > Math.abs(signal[best]) ? index : best),
        0,
    );
}

const FOUR_BANDS = [150, 1500, 6000];
const TEST_FREQUENCIES = [60, 400, 1500, 3000, 9000, 16000];

describe('oversampler', () => {
    OVERSAMPLING_FACTORS.forEach((factor) => {
        it(`delays by its reported latency at ${factor}×`, () => {
            const oversampler = new Oversampler();
            oversampler.setFactor(factor);
            const input = sine(1000, 0.128, 0.5);
            const output = new Float32Array(input.length);
            const block = new Float32Array(128);
            for (let start = 0; start < input.length; start += 128) {
                const high = oversampler.up(input.subarray(start, start + 128), 128, 0);
                oversampler.down(high, block, 128, 0);
                output.set(block, start);
            }
            const latency = OVERSAMPLING_LATENCY[factor];
            expect(oversampler.latency).toBe(latency);
            const deviation = Math.max(
                ...input
                    .subarray(1000, 4000)
                    .map((value, index) => Math.abs(value - output[1000 + index + latency])),
            );
            expect(deviation).toBeLessThan(1e-3);
        });
    });

    it('keeps the audio band flat', () => {
        [2, 4].forEach((factor) => {
            const oversampler = new Oversampler();
            oversampler.setFactor(factor as 2 | 4);
            [100, 5000, 18000].forEach((frequency) => {
                const input = sine(frequency, 0.1, 0.5);
                const output = new Float32Array(input.length);
                const high = oversampler.up(input, input.length, 0);
                oversampler.down(high, output, input.length, 0);
                expect(Math.abs(db(rms(output, 1000) / rms(input, 1000)))).toBeLessThan(0.05);
            });
        });
    });
});

describe('saturator curves', () => {
    it('keeps unity slope at zero for every curve but rectify', () => {
        SATURATION_STYLES.filter((style) => style !== 'rectify').forEach((style) => {
            expect(saturate(style, 1e-4) / 1e-4).toBeCloseTo(1, 3);
            expect(saturate(style, -1e-4) / -1e-4).toBeCloseTo(1, 3);
        });
    });

    it('bounds the clipping curves and folds back above the edge', () => {
        expect(saturate('hard', 5)).toBe(1);
        expect(saturate('soft', 50)).toBeCloseTo(1, 6);
        expect(saturate('tube', -50)).toBeCloseTo(-1 / 1.6, 6);
        expect(saturate('fold', 1.5)).toBeCloseTo(0.5, 6);
        expect(saturate('fold', -1.5)).toBeCloseTo(-0.5, 6);
        expect(saturate('rectify', -0.5)).toBeCloseTo(saturate('rectify', 0.5), 9);
    });
});

describe('saturator', () => {
    it('reports the oversampler latency at every factor', () => {
        OVERSAMPLING_FACTORS.forEach((oversampling) => {
            const kernel = saturator({ oversampling });
            expect(kernel.latency).toBe(MAX_OVERSAMPLING_LATENCY);
            // A quiet impulse stays in the linear part of the curve.
            const input = impulse(2048, 100, 1e-3);
            const [output] = run(kernel, input);
            expect(argMax(output)).toBe(100 + MAX_OVERSAMPLING_LATENCY);
        });
    });

    it('sums the bands flat when the drive is neutral', () => {
        OVERSAMPLING_FACTORS.forEach((oversampling) => {
            TEST_FREQUENCIES.forEach((frequency) => {
                const kernel = saturator({
                    oversampling,
                    crossovers: FOUR_BANDS,
                    bands: bands(4, { style: 'soft', driveDb: 0 }),
                });
                const input = sine(frequency, 0.25, 1e-3);
                const [output] = run(kernel, input);
                expect(Math.abs(db(rms(output, 6000) / rms(input, 6000)))).toBeLessThan(0.05);
            });
        });
    });

    it('sums the dry bands flat at zero mix, however hard they are driven', () => {
        TEST_FREQUENCIES.forEach((frequency) => {
            const kernel = saturator({
                crossovers: FOUR_BANDS,
                bands: bands(4, { style: 'hard', driveDb: 36, mix: 0 }),
            });
            const input = sine(frequency, 0.25, 0.8);
            const [output] = run(kernel, input);
            expect(Math.abs(db(rms(output, 6000) / rms(input, 6000)))).toBeLessThan(0.05);
        });
    });

    it('passes bypassed bands through and silences muted ones', () => {
        const kernel = saturator({
            crossovers: [2000],
            bands: [
                defaultSaturatorBand({ style: 'hard', driveDb: 36, bypass: true }),
                defaultSaturatorBand({ mute: true }),
            ],
        });
        const low = sine(200, 0.25, 0.8);
        const [output] = run(kernel, low);
        const settled = output.subarray(6000);
        // Still a clean sine: no clipping, so its crest factor stays √2.
        expect(peak(settled) / rms(settled)).toBeCloseTo(Math.SQRT2, 2);
        expect(Math.abs(db(rms(settled) / rms(low, 6000)))).toBeLessThan(0.05);
        // Three octaves above the crossover the low band's slope leaves almost nothing.
        const [high] = run(kernel, sine(16000, 0.25, 0.8));
        expect(db(rms(high, 6000) / 0.8)).toBeLessThan(-60);
    });

    it('plays only soloed bands', () => {
        const kernel = saturator({
            crossovers: [1000],
            bands: [defaultSaturatorBand({ solo: true }), defaultSaturatorBand()],
        });
        const [high] = run(kernel, sine(8000, 0.25, 0.5));
        expect(db(rms(high, 6000) / 0.5)).toBeLessThan(-50);
    });

    it('adds harmonics when driven, and fewer of them alias with oversampling', () => {
        // A 7 kHz tone clipped hard: its 3rd harmonic (21 kHz) stays, the 5th (35 kHz) aliases
        // to 13 kHz without oversampling.
        const aliasLevel = (oversampling: 1 | 4) => {
            const kernel = saturator({
                oversampling,
                bands: bands(1, { style: 'hard', driveDb: 24 }),
            });
            const [output] = run(kernel, sine(7000, 0.5, 0.5));
            const tail = output.subarray(SAMPLE_RATE / 4, SAMPLE_RATE / 4 + 8192);
            // Single-bin DFT at 13 kHz.
            const w = (2 * Math.PI * 13000) / SAMPLE_RATE;
            const [re, im] = tail.reduce(
                ([a, b], value, n) => [a + value * Math.cos(w * n), b - value * Math.sin(w * n)],
                [0, 0],
            );
            return db(Math.hypot(re, im) / tail.length);
        };
        expect(aliasLevel(4)).toBeLessThan(aliasLevel(1) - 20);
    });

    it('follows the level with the dynamics control', () => {
        const crest = (dynamics: number) => {
            const kernel = saturator({
                oversampling: 1,
                bands: bands(1, { style: 'soft', driveDb: 6, dynamics }),
            });
            const [output] = run(kernel, sine(500, 0.3, 0.5));
            return peak(output.subarray(6000)) / rms(output, 6000);
        };
        // More drive on loud material flattens the sine further than less drive does.
        expect(crest(100)).toBeLessThan(crest(-100) - 0.05);
    });

    it('applies the global mix and output gain', () => {
        const input = sine(1000, 0.25, 1e-3);
        const quiet = saturator({ outputDb: -12, bands: bands(1, { driveDb: 0 }) });
        const [output] = run(quiet, input);
        expect(db(rms(output, 6000) / rms(input, 6000))).toBeCloseTo(-12, 1);
        const dry = saturator({ mix: 0, bands: bands(1, { style: 'hard', driveDb: 36 }) });
        const [clean] = run(dry, sine(300, 0.25, 0.8));
        const settled = clean.subarray(6000);
        expect(peak(settled) / rms(settled)).toBeCloseTo(Math.SQRT2, 2);
    });

    it('stays finite and free of denormals', () => {
        SATURATION_STYLES.forEach((style) => {
            [-100, 100].forEach((dynamics) => {
                const kernel = saturator({
                    oversampling: 4,
                    crossovers: FOUR_BANDS,
                    bands: bands(4, { style, driveDb: 36, dynamics, tone: 12 }),
                });
                const loud = noise(0.2, 4);
                const silence = new Float32Array(SAMPLE_RATE);
                const signal = new Float32Array(loud.length + silence.length);
                signal.set(loud);
                const [left, right] = run(kernel, signal, signal);
                const tiny = (value: number) => value !== 0 && Math.abs(value) < 1e-30;
                expect(left.every(Number.isFinite)).toBe(true);
                expect(right.every(Number.isFinite)).toBe(true);
                expect(left.some(tiny) || right.some(tiny)).toBe(false);
                expect(peak(left.subarray(-SAMPLE_RATE / 4))).toBeLessThan(1e-6);
            });
        });
    });

    it('keeps the rack timing when the saturator is bypassed', () => {
        const rack = new RackProcessor(SAMPLE_RATE);
        const effect = createEffect('saturator');
        const state = { ...defaultRack(), chain: [effect] };
        rack.setRack(state);
        const input = impulse(4096, 200, 1e-3);
        rack.setRack({ ...state, chain: [{ ...effect, bypass: true }] });
        const [left] = processStereo(input, input, (l, r, frames) => rack.process(l, r, frames));
        expect(argMax(left)).toBe(200 + MAX_OVERSAMPLING_LATENCY);
    });
});

describe('saturator state', () => {
    it('normalizes untrusted parameters', () => {
        const rack = normalizeRack({
            chain: [
                {
                    type: 'saturator',
                    params: {
                        crossovers: [9000, 100, 500, 2000, 4000],
                        bands: [{ style: 'bogus', driveDb: 99, dynamics: -500 }],
                        oversampling: 3,
                        mix: 'all',
                    },
                },
            ],
        });
        const [effect] = rack.chain;
        expect(effect.type).toBe('saturator');
        if (effect.type !== 'saturator') {
            return;
        }
        expect(effect.params.crossovers).toEqual([100, 500, 9000]);
        expect(effect.params.bands).toHaveLength(4);
        expect(effect.params.bands[0]).toEqual(
            defaultSaturatorBand({ driveDb: 36, dynamics: -100 }),
        );
        expect(effect.params.oversampling).toBe(2);
        expect(effect.params.mix).toBe(100);
    });
});
