import { describe, expect, it } from 'vitest';
import {
    MAX_PRESET_NAME,
    moveListItem,
    nextPresetName,
    presetMatches,
    upsertPreset,
} from '../src/shared/presets';

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

describe('preset order', () => {
    const list = ['a', 'b', 'c', 'd'];

    it('moves an item to an insertion point', () => {
        expect(moveListItem(list, 0, 4)).toEqual(['b', 'c', 'd', 'a']);
        expect(moveListItem(list, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
        expect(moveListItem(list, 1, 3)).toEqual(['a', 'c', 'b', 'd']);
        expect(moveListItem(list, 2, 1)).toEqual(['a', 'c', 'b', 'd']);
    });

    it('leaves the list alone when the item stays put or the index is bad', () => {
        expect(moveListItem(list, 1, 1)).toBe(list);
        expect(moveListItem(list, 1, 2)).toBe(list);
        expect(moveListItem(list, 7, 0)).toBe(list);
    });

    it('overwrites a preset in place and adds new ones last', () => {
        const presets = [{ name: 'One' }, { name: 'Two' }, { name: 'Three' }];
        const replaced = { name: 'Two', version: 2 };
        expect(upsertPreset<{ name: string; version?: number }>(presets, replaced)).toEqual([
            { name: 'One' },
            replaced,
            { name: 'Three' },
        ]);
        expect(upsertPreset(presets, { name: 'Four' }).map((preset) => preset.name)).toEqual([
            'One',
            'Two',
            'Three',
            'Four',
        ]);
    });
});

describe('preset search', () => {
    it('matches every word typed, in any order, in the name or the description', () => {
        expect(presetMatches('voice', 'Voice Clarity', 'Presence for speech')).toBe(true);
        expect(presetMatches('speech clar', 'Voice Clarity', 'Presence for speech')).toBe(true);
        expect(presetMatches('voice bass', 'Voice Clarity', 'Presence for speech')).toBe(false);
    });

    it('ignores case, accents and punctuation', () => {
        expect(presetMatches('CAFE', 'Café night')).toBe(true);
        expect(presetMatches('élan', 'Elan')).toBe(true);
        expect(presetMatches('lofi radio', 'Lo-Fi Radio')).toBe(true);
        expect(presetMatches('lo-fi', 'Lo-Fi Radio')).toBe(true);
    });

    it('matches everything when nothing is typed', () => {
        expect(presetMatches('', 'Anything')).toBe(true);
        expect(presetMatches('   ', 'Anything')).toBe(true);
    });
});
