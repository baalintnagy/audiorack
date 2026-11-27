import { describe, expect, it } from 'vitest';
import { RackRouting } from '../src/offscreen/routing';
import { allEffects, countEffects, countGroups } from '../src/shared/chain';
import {
    EFFECT_TYPES,
    MIN_BRANCHES,
    SPECS,
    createBranch,
    createEffect,
    createParallelGroup,
    defaultRack,
} from '../src/shared/effects';
import { MAX_CHAIN_LENGTH, MAX_PARALLEL_GROUPS, normalizeRack } from '../src/shared/normalize';
import { FACTORY_PRESETS } from '../src/shared/presets';
import { SPECTRUM_BINS, toLogSpectrum } from '../src/shared/spectrum';

describe('rack normalization', () => {
    it('keeps valid state intact', () => {
        const rack = { ...defaultRack(), chain: EFFECT_TYPES.map((type) => createEffect(type)) };
        expect(normalizeRack(JSON.parse(JSON.stringify(rack)))).toEqual(rack);
    });

    it('recovers from malformed input', () => {
        expect(normalizeRack(null).chain.length).toBeGreaterThan(0);
        const rack = normalizeRack({
            bypass: 'yes',
            inputDb: 1e9,
            outputDb: -1e9,
            chain: [
                { type: 'unknown' },
                { type: 'compressor', id: 'a', params: { ratio: -5, attackMs: 'fast' } },
                { type: 'eq', id: 'a', params: { bands: [{ type: 'bogus', frequency: 1 }] } },
                { type: 'multiband', params: { crossovers: [9000, 100] } },
            ],
        });
        expect(rack.bypass).toBe(false);
        expect(rack.inputDb).toBe(24);
        expect(rack.outputDb).toBe(-60);
        expect(rack.chain.map((effect) => effect.type)).toEqual(['compressor', 'eq', 'multiband']);
        expect(new Set(rack.chain.map((effect) => effect.id)).size).toBe(3);
        const [compressor, eq, multiband] = allEffects(rack.chain);
        expect(compressor.type === 'compressor' && compressor.params.ratio).toBe(1);
        expect(eq.type === 'eq' && eq.params.bands[0].type).toBe('bell');
        expect(eq.type === 'eq' && eq.params.bands[0].frequency).toBe(20);
        expect(multiband.type === 'multiband' && multiband.params.crossovers).toEqual([100, 9000]);
        expect(multiband.type === 'multiband' && multiband.params.bands).toHaveLength(3);
    });

    it('reads effects stored under an earlier name as their current type', () => {
        const stored = {
            type: 'volume',
            id: 'u',
            color: '#123456',
            params: { pan: -50, width: 0 },
        };
        const rack = normalizeRack({
            chain: [stored, { type: 'parallel', branches: [{ effects: [stored] }, {}] }],
        });
        const [top, nested] = allEffects(rack.chain);
        expect(top).toMatchObject({ type: 'utility', color: '#123456' });
        expect(top.type === 'utility' && top.params).toMatchObject({ pan: -50, width: 0 });
        expect(nested.type).toBe('utility');
        // Written back under the current name, the rack reads the same again.
        expect(normalizeRack(JSON.parse(JSON.stringify(rack)))).toEqual(rack);
    });

    it('drops names that only look like a legacy one', () => {
        const rack = normalizeRack({ chain: [{ type: 'toString' }, { type: 'Volume' }] });
        expect(rack.chain).toEqual([]);
    });

    it('limits the chain length', () => {
        const chain = Array.from({ length: 40 }, () => createEffect('utility'));
        expect(normalizeRack({ chain }).chain).toHaveLength(MAX_CHAIN_LENGTH);
    });

    it('produces valid factory presets', () => {
        FACTORY_PRESETS.forEach((preset) => {
            const rack = preset.create();
            expect(normalizeRack(rack)).toEqual(rack);
        });
    });
});

describe('spectrum reduction', () => {
    it('maps FFT bins to log-spaced bands', () => {
        const fft = new Float32Array(4096).fill(-90);
        fft[Math.round(1000 / (24000 / 4096))] = -10;
        const spectrum = toLogSpectrum(fft, 48000);
        expect(spectrum).toHaveLength(SPECTRUM_BINS);
        expect(Math.max(...spectrum)).toBeGreaterThan(-40);
        expect(Math.min(...spectrum)).toBe(-90);
    });
});

describe('parallel rack state', () => {
    it('normalizes groups, pads branches and keeps version 1 racks loading', () => {
        const rack = normalizeRack({
            version: 1,
            chain: [
                { type: 'eq', id: 'x' },
                {
                    type: 'parallel',
                    id: 'x',
                    branches: [
                        {
                            id: 'b',
                            gainDb: 99,
                            effects: [
                                { type: 'compressor', id: 'x' },
                                { type: 'parallel', branches: [] },
                            ],
                        },
                    ],
                },
            ],
        });
        expect(rack.version).toBe(2);
        const [, group] = rack.chain;
        expect(group.type).toBe('parallel');
        if (group.type !== 'parallel') {
            return;
        }
        expect(group.branches).toHaveLength(MIN_BRANCHES);
        expect(group.branches[0].gainDb).toBe(SPECS.branchGainDb.max);
        // Groups cannot nest: only the compressor survives inside the branch.
        expect(group.branches[0].effects.map((effect) => effect.type)).toEqual(['compressor']);
        const ids = [rack.chain[0].id, group.id, group.branches[0].effects[0].id];
        expect(new Set(ids).size).toBe(3);
    });

    it('counts effects inside branches towards the rack limit', () => {
        const effects = Array.from({ length: 12 }, () => createEffect('utility'));
        const rack = normalizeRack({
            chain: [
                ...effects.slice(0, 6),
                createParallelGroup([createBranch(effects), createBranch(effects)]),
                ...Array.from({ length: MAX_PARALLEL_GROUPS + 1 }, () => createParallelGroup()),
            ],
        });
        expect(countEffects(rack.chain)).toBe(MAX_CHAIN_LENGTH);
        expect(countGroups(rack.chain)).toBe(MAX_PARALLEL_GROUPS);
        expect(normalizeRack(JSON.parse(JSON.stringify(rack)))).toEqual(rack);
    });
});

describe('rack routing', () => {
    it('lets tabs follow the shared rack or keep their own', () => {
        const routing = new RackRouting();
        const shared = { ...defaultRack(), inputDb: 3 };
        const own = { ...defaultRack(), inputDb: -3 };
        expect(routing.assign(1, own, 'tab', [1, 2])).toEqual([1]);
        expect(routing.assign(2, shared, 'shared', [1, 2])).toEqual([2]);
        expect(routing.rackFor(1)).toBe(own);
        expect(routing.rackFor(2)).toBe(shared);
        // Pushing the shared rack from tab 1 returns it to the shared rack.
        expect(routing.assign(1, shared, 'shared', [1, 2])).toEqual([1, 2]);
        expect(routing.rackFor(1)).toBe(shared);
    });
});
