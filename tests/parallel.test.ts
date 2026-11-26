import { describe, expect, it } from 'vitest';
import { StereoDelay } from '../src/dsp/delay';
import { BRANCH_METER_VALUES } from '../src/dsp/parallel';
import { RackProcessor } from '../src/dsp/rack';
import {
    createBranch,
    createEffect,
    createParallelGroup,
    defaultRack,
    type ChainItem,
    type EffectOf,
    type EffectParamsMap,
    type EffectType,
} from '../src/shared/effects';
import { BLOCK, SAMPLE_RATE, noise, peak, processStereo, rms, sine } from './helpers';

const HALF_DB = 20 * Math.log10(0.5);

function effect<T extends EffectType>(type: T, params: Partial<EffectParamsMap[T]> = {}) {
    const base = createEffect(type);
    return { ...base, params: { ...base.params, ...params } } as EffectOf<T>;
}

function rackWith(chain: ChainItem[]) {
    const rack = new RackProcessor(SAMPLE_RATE);
    rack.setRack({ ...defaultRack(), chain });
    return rack;
}

function run(rack: RackProcessor, input: Float32Array) {
    return processStereo(input, input, (l, r, frames) => rack.process(l, r, frames))[0];
}

function maxDifference(a: Float32Array, b: Float32Array, from: number) {
    return a
        .subarray(from)
        .reduce((max, value, i) => Math.max(max, Math.abs(value - b[from + i])), 0);
}

function delayed(signal: Float32Array, samples: number) {
    const result = new Float32Array(signal.length);
    result.set(signal.subarray(0, signal.length - samples), samples);
    return result;
}

/** A limiter that never limits, so it acts as a pure lookahead delay. */
const transparentLimiter = () => effect('limiter', { ceilingDb: 0, lookaheadMs: 5 });
const LIMITER_LATENCY = Math.round(0.005 * SAMPLE_RATE) - 1;

describe('stereo delay', () => {
    it('delays by whole samples and reallocates only on changes', () => {
        const delay = new StereoDelay();
        delay.setDelay(3);
        const left = Float32Array.from([1, 2, 3, 4, 5]);
        const right = Float32Array.from(left);
        delay.process(left, right, 5);
        expect([...left]).toEqual([0, 0, 0, 1, 2]);
        delay.setDelay(3);
        const next = Float32Array.from([6, 7]);
        delay.process(next, Float32Array.from(next), 2);
        expect([...next]).toEqual([3, 4]);
    });
});

describe('parallel groups', () => {
    it('starts new groups at unity gain', () => {
        const input = sine(300, 0.1, 0.25);
        const output = run(rackWith([createParallelGroup()]), input);
        expect(rms(output)).toBeCloseTo(rms(input), 2);
    });

    it('sums branches, with an empty branch carrying the dry signal', () => {
        const input = sine(300, 0.1, 0.25);
        const group = createParallelGroup([createBranch(), createBranch()]);
        const output = run(rackWith([group]), input);
        expect(
            maxDifference(
                output,
                input.map((value) => value * 2),
                0,
            ),
        ).toBeLessThan(1e-6);
    });

    it('plays only soloed branches while any branch is soloed', () => {
        const input = noise(0.1, 0.25);
        const group = createParallelGroup([
            { ...createBranch(), solo: true },
            createBranch([effect('utility', { gainDb: 12 })]),
        ]);
        expect(maxDifference(run(rackWith([group]), input), input, 0)).toBeLessThan(1e-5);
    });

    it('cancels identical branches when one has inverted polarity', () => {
        const input = noise(0.1, 0.25);
        const group = createParallelGroup([createBranch(), { ...createBranch(), invert: true }]);
        expect(peak(run(rackWith([group]), input))).toBeLessThan(1e-6);
    });

    it('pans branches with a constant-power law', () => {
        const input = sine(300, 0.1, 0.25);
        const group = createParallelGroup([{ ...createBranch(), pan: -100 }]);
        group.branches = [group.branches[0]];
        const rack = rackWith([group]);
        const [left, right] = processStereo(input, input, (l, r, frames) =>
            rack.process(l, r, frames),
        );
        expect(rms(left)).toBeCloseTo(rms(input) * Math.SQRT2, 3);
        expect(peak(right)).toBeLessThan(1e-6);
    });

    it('applies branch levels and mutes', () => {
        const input = noise(0.1, 0.25);
        const group = createParallelGroup([
            { ...createBranch(), gainDb: HALF_DB },
            { ...createBranch(), gainDb: HALF_DB },
            { ...createBranch([effect('utility', { gainDb: 12 })]), mute: true },
        ]);
        expect(maxDifference(run(rackWith([group]), input), input, 0)).toBeLessThan(1e-5);
    });

    it('delay-compensates branches with lookahead', () => {
        const input = noise(0.2, 0.2);
        const group = createParallelGroup([
            { ...createBranch([transparentLimiter()]), gainDb: HALF_DB },
            { ...createBranch(), gainDb: HALF_DB },
        ]);
        const output = run(rackWith([group]), input);
        // Without compensation the dry half would arrive early and comb-filter the sum.
        expect(maxDifference(output, delayed(input, LIMITER_LATENCY), 0)).toBeLessThan(1e-5);
    });

    it('keeps the latency of a bypassed effect, so bypassing never shifts the signal', () => {
        const input = noise(0.2, 0.2);
        const limiter = transparentLimiter();
        const rack = rackWith([limiter]);
        run(rack, input);
        rack.setRack({ ...defaultRack(), chain: [{ ...limiter, bypass: true }] });
        const output = run(rack, input);
        expect(maxDifference(output, delayed(input, LIMITER_LATENCY), BLOCK * 10)).toBeLessThan(
            1e-5,
        );
    });

    it('passes the dry signal when the whole group is bypassed', () => {
        const input = sine(300, 0.2, 0.25);
        const group = createParallelGroup([createBranch([effect('utility', { gainDb: -20 })])]);
        const rack = rackWith([group]);
        run(rack, input);
        rack.setRack({ ...defaultRack(), chain: [{ ...group, bypass: true }] });
        const output = run(rack, input);
        expect(rms(output, 4800)).toBeCloseTo(rms(input, 4800), 4);
    });

    it('reports branch levels and the meters of nested effects', () => {
        const compressor = effect('compressor', { thresholdDb: -30 });
        const group = createParallelGroup([createBranch([compressor]), createBranch()]);
        const rack = rackWith([group]);
        run(rack, sine(500, 0.2, 0.8));
        const meters = rack.takeMeters();
        // Two branches followed by the sum.
        expect(meters.effects[group.id]).toHaveLength(3 * BRANCH_METER_VALUES);
        expect(meters.effects[group.id][BRANCH_METER_VALUES]).toBeCloseTo(0.8, 2);
        expect(meters.effects[compressor.id][0]).toBeGreaterThan(6);
    });

    it('keeps effect state when an effect moves into a branch', () => {
        const compressor = effect('compressor', { thresholdDb: -30, attackMs: 50 });
        const loud = sine(500, 0.5, 0.8);
        const reductionAfterMove = (moved: typeof compressor) => {
            const rack = rackWith([compressor]);
            run(rack, loud);
            rack.takeMeters();
            const group = createParallelGroup([createBranch([moved]), createBranch()]);
            rack.setRack({ ...defaultRack(), chain: [group] });
            run(rack, loud.subarray(0, BLOCK));
            return rack.takeMeters().effects[moved.id][0];
        };
        const kept = reductionAfterMove(compressor);
        const fresh = reductionAfterMove({ ...compressor, id: 'fresh' });
        expect(kept).toBeGreaterThan(10);
        expect(fresh).toBeLessThan(kept / 2);
    });
});
