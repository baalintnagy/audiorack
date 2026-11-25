import { describe, expect, it } from 'vitest';
import { allEffects, setColor } from '../src/shared/chain';
import {
    EFFECT_INFO,
    PARALLEL_INFO,
    createBranch,
    createEffect,
    createParallelGroup,
    isParallelGroup,
    itemColor,
    type ChainItem,
    type Effect,
} from '../src/shared/effects';
import { normalizeRack } from '../src/shared/normalize';

function setup() {
    const eq = createEffect('eq') as Effect;
    const compressor = createEffect('compressor') as Effect;
    const group = createParallelGroup([createBranch([compressor]), createBranch()]);
    const chain: ChainItem[] = [eq, group];
    return { eq, compressor, group, chain };
}

describe('accent colors', () => {
    it('falls back to the default color of the type', () => {
        const { eq, group } = setup();
        expect(itemColor(eq)).toBe(EFFECT_INFO.eq.color);
        expect(itemColor(group)).toBe(PARALLEL_INFO.color);
    });

    it('sets and clears the color of effects, branch effects and groups', () => {
        const { compressor, group, chain } = setup();
        const painted = setColor(setColor(chain, compressor.id, '#123456'), group.id, '#abcdef');
        const paintedGroup = painted.find(isParallelGroup);
        const paintedCompressor = allEffects(painted).find(({ id }) => id === compressor.id);
        expect(paintedGroup && itemColor(paintedGroup)).toBe('#abcdef');
        expect(paintedCompressor && itemColor(paintedCompressor)).toBe('#123456');
        expect(itemColor(painted[0])).toBe(EFFECT_INFO.eq.color);

        const cleared = setColor(painted, compressor.id, undefined);
        const clearedCompressor = allEffects(cleared).find(({ id }) => id === compressor.id);
        expect(clearedCompressor).not.toHaveProperty('color');
    });

    it('keeps valid colors from untrusted state and drops anything else', () => {
        const rack = normalizeRack({
            chain: [
                { type: 'eq', color: '#FF00AA' },
                { type: 'limiter', color: 'red' },
                { type: 'gate', color: '#12345' },
                { type: 'volume', color: 42 },
                {
                    type: 'parallel',
                    color: '#00ff00',
                    branches: [{ effects: [{ type: 'compressor', color: ' #0000ff ' }] }],
                },
            ],
        });
        const [eq, limiter, gate, volume, group] = rack.chain;
        expect(eq.color).toBe('#ff00aa');
        expect(limiter).not.toHaveProperty('color');
        expect(gate).not.toHaveProperty('color');
        expect(volume).not.toHaveProperty('color');
        expect(group.color).toBe('#00ff00');
        expect(isParallelGroup(group) && group.branches[0].effects[0].color).toBe('#0000ff');
    });
});
