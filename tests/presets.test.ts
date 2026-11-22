import { describe, expect, it } from 'vitest';
import { MAX_PRESET_NAME, nextPresetName } from '../src/shared/presets';

describe('preset naming', () => {
    it('counts "Preset" names when the rack did not come from a preset', () => {
        expect(nextPresetName(undefined, [])).toBe('Preset 1');
        expect(nextPresetName(undefined, ['Preset 1', 'preset 2'])).toBe('Preset 3');
    });

    it('continues the name of the preset the rack came from', () => {
        expect(nextPresetName('Night Mode', ['Night Mode'])).toBe('Night Mode 2');
        expect(nextPresetName('Night Mode', ['Night Mode', 'Night Mode 2'])).toBe('Night Mode 3');
        expect(nextPresetName('Night Mode 2', ['Night Mode', 'Night Mode 2'])).toBe('Night Mode 3');
    });

    it('shortens long names but keeps the counter', () => {
        const name = nextPresetName('x'.repeat(MAX_PRESET_NAME), []);
        expect(name).toHaveLength(MAX_PRESET_NAME);
        expect(name.endsWith(' 2')).toBe(true);
    });
});
