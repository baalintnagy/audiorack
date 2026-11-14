import { describe, expect, it } from 'vitest';
import { EFFECT_TYPES, createEffect, defaultRack } from '../src/shared/effects';
import { MAX_CHAIN_LENGTH, normalizeRack } from '../src/shared/normalize';
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
            chain: [
                { type: 'unknown' },
                { type: 'compressor', id: 'a', params: { ratio: -5, attackMs: 'fast' } },
                { type: 'eq', id: 'a', params: { bands: [{ type: 'bogus', frequency: 1 }] } },
                { type: 'multiband', params: { crossovers: [9000, 100] } },
            ],
        });
        expect(rack.bypass).toBe(false);
        expect(rack.inputDb).toBe(24);
        expect(rack.chain.map((effect) => effect.type)).toEqual(['compressor', 'eq', 'multiband']);
        expect(new Set(rack.chain.map((effect) => effect.id)).size).toBe(3);
        const [compressor, eq, multiband] = rack.chain;
        expect(compressor.type === 'compressor' && compressor.params.ratio).toBe(1);
        expect(eq.type === 'eq' && eq.params.bands[0].type).toBe('bell');
        expect(eq.type === 'eq' && eq.params.bands[0].frequency).toBe(20);
        expect(multiband.type === 'multiband' && multiband.params.crossovers).toEqual([100, 9000]);
        expect(multiband.type === 'multiband' && multiband.params.bands).toHaveLength(3);
    });

    it('limits the chain length', () => {
        const chain = Array.from({ length: 40 }, () => createEffect('volume'));
        expect(normalizeRack({ chain }).chain).toHaveLength(MAX_CHAIN_LENGTH);
    });

    it('produces valid factory presets', () => {
        FACTORY_PRESETS.forEach((preset) => {
            const rack = preset.create();
            expect(normalizeRack(rack).chain.map((effect) => effect.type)).toEqual(
                rack.chain.map((effect) => effect.type),
            );
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
