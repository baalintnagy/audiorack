import { describe, expect, it } from 'vitest';
import { gainComputerDb, gainReductionDb } from '../src/dsp/dynamics';
import { createKernel } from '../src/dsp/kernels';
import { volumeGains } from '../src/dsp/kernels/volume';
import { RackProcessor } from '../src/dsp/rack';
import {
    EFFECT_TYPES,
    createEffect,
    defaultParams,
    defaultRack,
    type EffectParamsMap,
    type EffectType,
} from '../src/shared/effects';
import { SAMPLE_RATE, db, noise, peak, processStereo, rms, sine } from './helpers';

function run<T extends EffectType>(
    type: T,
    params: Partial<EffectParamsMap[T]>,
    left: Float32Array,
    right = left,
) {
    const kernel = createKernel(type, SAMPLE_RATE);
    kernel.setParams({ ...defaultParams(type), ...params });
    const output = processStereo(left, right, (l, r, frames) => kernel.process(l, r, frames));
    return { output, kernel };
}

describe('gain computer', () => {
    it('applies the ratio above the threshold and a smooth knee around it', () => {
        expect(gainComputerDb(-30, -20, 4, 0)).toBe(-30);
        expect(gainComputerDb(-8, -20, 4, 0)).toBeCloseTo(-17, 6);
        expect(gainReductionDb(-20, -20, 4, 6)).toBeGreaterThan(0);
        expect(gainReductionDb(-20, -20, 4, 6)).toBeLessThan(1);
        expect(gainComputerDb(-24, -20, 4, 6)).toBe(-24);
    });
});

describe('effect kernels', () => {
    it('compresses loud signals and leaves quiet ones untouched', () => {
        const loud = sine(1000, 0.5, 0.9);
        const settings = { thresholdDb: -20, ratio: 4, autoMakeup: false, kneeDb: 0 };
        const { output, kernel } = run('compressor', settings, loud);
        // A 0.9 sine has a -0.9 dBFS peak: expect roughly 14 dB of peak reduction.
        expect(db(peak(output[0].subarray(12000)) / 0.9)).toBeLessThan(-12);
        expect(kernel.takeMeters?.()[0]).toBeGreaterThan(12);
        const quiet = sine(1000, 0.2, 0.01);
        const passed = run('compressor', settings, quiet).output[0];
        expect(rms(passed)).toBeCloseTo(rms(quiet), 5);
    });

    it('never lets the limiter exceed its ceiling', () => {
        const input = noise(1, 4);
        const ceiling = -1;
        const { output } = run(
            'limiter',
            { ceilingDb: ceiling, inputDb: 6 },
            input,
            noise(1, 4, 7),
        );
        expect(peak(output[0])).toBeLessThanOrEqual(Math.pow(10, ceiling / 20) + 1e-6);
        expect(peak(output[1])).toBeLessThanOrEqual(Math.pow(10, ceiling / 20) + 1e-6);
    });

    it('passes quiet material through the limiter with only a delay', () => {
        const input = sine(440, 0.2, 0.3);
        const { output } = run('limiter', { lookaheadMs: 1 }, input);
        const delay = Math.round(0.001 * SAMPLE_RATE) - 1;
        expect(output[0][2000 + delay]).toBeCloseTo(input[2000], 5);
    });

    it('reduces only the compressed band of the multiband compressor', () => {
        const low = sine(80, 0.6, 0.8);
        const params = defaultParams('multiband');
        const bands = params.bands.map((band, index) => ({
            ...band,
            thresholdDb: index === 0 ? -30 : 0,
            ratio: index === 0 ? 10 : 1,
        }));
        const { output, kernel } = run('multiband', { bands }, low);
        expect(db(rms(output[0], 14400) / rms(low, 14400))).toBeLessThan(-10);
        const meters = kernel.takeMeters?.() ?? [];
        expect(meters).toHaveLength(4);
        expect(meters[0]).toBeGreaterThan(10);
        expect(meters[3]).toBe(0);
    });

    it('mutes non-soloed multiband bands', () => {
        const signal = sine(8000, 0.3, 0.5);
        const params = defaultParams('multiband');
        const bands = params.bands.map((band, index) => ({
            ...band,
            ratio: 1,
            solo: index === 0,
        }));
        const { output } = run('multiband', { bands }, signal);
        expect(rms(output[0], 7200)).toBeLessThan(0.01);
    });

    it('de-esses sibilant frequencies but not the low band', () => {
        const settings = { thresholdDb: -40, rangeDb: 12, mode: 'split' as const };
        const hiss = sine(7000, 0.4, 0.5);
        const deessed = run('deesser', settings, hiss).output[0];
        expect(db(rms(deessed, 9600) / rms(hiss, 9600))).toBeLessThan(-6);
        const voice = sine(200, 0.4, 0.5);
        const untouched = run('deesser', settings, voice).output[0];
        expect(db(rms(untouched, 9600) / rms(voice, 9600))).toBeCloseTo(0, 0);
    });

    it('filters above the cutoff in low-pass mode', () => {
        const signal = sine(8000, 0.3, 0.5);
        const { output } = run('filter', { mode: 'lowpass', cutoff: 1000, slope: 24 }, signal);
        expect(db(rms(output[0], 4800) / rms(signal, 4800))).toBeLessThan(-40);
    });

    it('boosts bass with the bass booster', () => {
        const signal = sine(50, 0.6, 0.1);
        const { output } = run('bassboost', { boostDb: 9, frequency: 100, harmonics: 0 }, signal);
        expect(db(rms(output[0], 14400) / rms(signal, 14400))).toBeGreaterThan(6);
    });

    it('uses a constant-power pan law that is transparent at the center', () => {
        const base = defaultParams('volume');
        expect(volumeGains(base).left).toBeCloseTo(1, 6);
        expect(volumeGains(base).right).toBeCloseTo(1, 6);
        const hardLeft = volumeGains({ ...base, pan: -100 });
        expect(hardLeft.right).toBeCloseTo(0, 6);
        expect(hardLeft.left).toBeCloseTo(Math.SQRT2, 6);
        expect(volumeGains({ ...base, invertLeft: true }).left).toBeCloseTo(-1, 6);
    });

    it('collapses to mono at zero width', () => {
        const { output } = run('volume', { width: 0 }, sine(500, 0.1, 0.5), sine(700, 0.1, 0.5));
        const difference = output[0].map((value, i) => value - output[1][i]);
        expect(peak(difference.subarray(2400))).toBeLessThan(1e-6);
    });

    it('keeps every effect finite with default settings', () => {
        EFFECT_TYPES.forEach((type) => {
            const { output } = run(type, {}, noise(0.1, 1), noise(0.1, 1, 3));
            expect(output[0].every(Number.isFinite)).toBe(true);
            expect(output[1].every(Number.isFinite)).toBe(true);
        });
    });
});

describe('rack processor', () => {
    it('passes audio unchanged through an empty rack', () => {
        const rack = new RackProcessor(SAMPLE_RATE);
        rack.setRack({ ...defaultRack(), chain: [] });
        const input = noise(0.05, 0.5);
        const [left] = processStereo(input, input, (l, r, frames) => rack.process(l, r, frames));
        expect(left).toEqual(input);
    });

    it('crossfades bypassed effects to a transparent signal', () => {
        const rack = new RackProcessor(SAMPLE_RATE);
        const volume = createEffect('volume');
        volume.params.gainDb = -20;
        const state = { ...defaultRack(), chain: [volume] };
        rack.setRack(state);
        const input = sine(300, 0.2, 0.5);
        processStereo(input, input, (l, r, frames) => rack.process(l, r, frames));
        rack.setRack({ ...state, chain: [{ ...volume, bypass: true }] });
        const [left] = processStereo(input, input, (l, r, frames) => rack.process(l, r, frames));
        expect(rms(left, 4800)).toBeCloseTo(rms(input, 4800), 4);
        // Meters are still collected: momentary and short-term loudness.
        expect(rack.takeMeters().effects[volume.id]).toHaveLength(2);
    });

    it('stays fully dry once the whole rack is bypassed', () => {
        const rack = new RackProcessor(SAMPLE_RATE);
        const volume = createEffect('volume');
        volume.params.gainDb = -20;
        const state = { ...defaultRack(), chain: [volume] };
        rack.setRack(state);
        const input = sine(300, 1, 0.5);
        processStereo(input, input, (l, r, frames) => rack.process(l, r, frames));
        rack.setRack({ ...state, bypass: true });
        const [left] = processStereo(input, input, (l, r, frames) => rack.process(l, r, frames));
        // Once the crossfade has run out, the output must stay the untouched input.
        const settled = SAMPLE_RATE / 2;
        const deviation = Math.max(
            ...left
                .subarray(settled)
                .map((sample, index) => Math.abs(sample - input[settled + index])),
        );
        expect(deviation).toBe(0);
    });

    it('reports input and output levels', () => {
        const rack = new RackProcessor(SAMPLE_RATE);
        rack.setRack({ ...defaultRack(), chain: [], outputDb: -6 });
        const input = sine(300, 0.2, 0.5);
        processStereo(input, input, (l, r, frames) => rack.process(l, r, frames));
        const meters = rack.takeMeters();
        expect(meters.inputPeak[0]).toBeCloseTo(0.5, 2);
        expect(db(meters.outputPeak[0] / meters.inputPeak[0])).toBeCloseTo(-6, 0);
    });
});
