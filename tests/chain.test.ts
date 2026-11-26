import { describe, expect, it } from 'vitest';
import {
    allEffects,
    canInsert,
    displayOrder,
    insertItem,
    insertionPoint,
    locate,
    mapEffect,
    moveItem,
    panelOrder,
    removeItem,
    stepSelection,
    toggleBypass,
    ungroup,
} from '../src/shared/chain';
import {
    createBranch,
    createEffect,
    createParallelGroup,
    isParallelGroup,
    type ChainItem,
    type Effect,
    type ParallelGroup,
} from '../src/shared/effects';
import { MAX_CHAIN_LENGTH, MAX_PARALLEL_GROUPS } from '../src/shared/normalize';

function setup() {
    const eq = createEffect('eq') as Effect;
    const compressor = createEffect('compressor') as Effect;
    const limiter = createEffect('limiter') as Effect;
    const group = createParallelGroup([createBranch([compressor]), createBranch()]);
    const chain: ChainItem[] = [eq, group, limiter];
    const [wet, dry] = group.branches;
    return { eq, compressor, limiter, group, chain, wet, dry };
}

const ids = (chain: ChainItem[]) => allEffects(chain).map((effect) => effect.id);

function groupOf(chain: ChainItem[]): ParallelGroup {
    const group = chain.find(isParallelGroup);
    if (!group) {
        throw new Error('No parallel group in the chain.');
    }
    return group;
}

describe('chain operations', () => {
    it('locates effects in the main chain and in branches', () => {
        const { chain, compressor, limiter, group, wet } = setup();
        expect(locate(chain, limiter.id)).toEqual({ index: 2 });
        expect(locate(chain, compressor.id)).toEqual({
            branch: { groupId: group.id, branchId: wet.id },
            index: 0,
        });
        expect(locate(chain, 'missing')).toBeUndefined();
    });

    it('moves effects within a lane, accounting for the removed item', () => {
        const { chain, eq, limiter } = setup();
        const moved = moveItem(chain, eq.id, { index: 3 });
        expect(moved.map((item) => item.id).slice(-1)).toEqual([eq.id]);
        expect(moveItem(chain, limiter.id, { index: 0 })[0].id).toBe(limiter.id);
    });

    it('moves effects into and out of parallel branches', () => {
        const { chain, eq, compressor, group, dry } = setup();
        const into = moveItem(chain, eq.id, {
            branch: { groupId: group.id, branchId: dry.id },
            index: 0,
        });
        expect(groupOf(into).branches[1].effects.map((effect) => effect.id)).toEqual([eq.id]);
        expect(into).toHaveLength(2);
        const out = moveItem(chain, compressor.id, { index: 0 });
        expect(out[0].id).toBe(compressor.id);
        expect(groupOf(out).branches[0].effects).toEqual([]);
    });

    it('keeps groups out of branches', () => {
        const { chain, compressor, group, wet } = setup();
        const nested = createParallelGroup();
        const target = { branch: { groupId: group.id, branchId: wet.id }, index: 0 };
        expect(insertItem(chain, nested, target)).toBe(chain);
        expect(moveItem(chain, group.id, target)).toBe(chain);
        expect(insertionPoint(chain, nested, compressor.id)).toEqual({ index: 2 });
    });

    it('inserts new items after the selection', () => {
        const { chain, compressor, group, wet } = setup();
        const utility = createEffect('utility') as Effect;
        expect(insertionPoint(chain, utility, compressor.id)).toEqual({
            branch: { groupId: group.id, branchId: wet.id },
            index: 1,
        });
        expect(insertionPoint(chain, utility, undefined)).toEqual({ index: 3 });
    });

    it('updates and removes nested effects', () => {
        const { chain, compressor, group } = setup();
        const bypassed = mapEffect(chain, compressor.id, (effect) => ({
            ...effect,
            bypass: true,
        }));
        expect(groupOf(bypassed).branches[0].effects[0].bypass).toBe(true);
        expect(ids(removeItem(chain, compressor.id))).not.toContain(compressor.id);
        expect(removeItem(chain, group.id)).toHaveLength(2);
    });

    it('toggles the bypass of effects and groups', () => {
        const { chain, compressor, group } = setup();
        const bypassed = toggleBypass(toggleBypass(chain, compressor.id), group.id);
        expect(groupOf(bypassed).bypass).toBe(true);
        expect(groupOf(bypassed).branches[0].effects[0].bypass).toBe(true);
        expect(toggleBypass(bypassed, group.id)[1].bypass).toBe(false);
    });

    it('flattens a group into its effects in series', () => {
        const { chain, eq, compressor, limiter, group } = setup();
        expect(ungroup(chain, group.id).map((item) => item.id)).toEqual([
            eq.id,
            compressor.id,
            limiter.id,
        ]);
    });

    it('enforces the effect and group limits', () => {
        const full = Array.from(
            { length: MAX_CHAIN_LENGTH },
            () => createEffect('utility') as Effect,
        );
        expect(canInsert(full, createEffect('eq') as Effect)).toBe(false);
        expect(canInsert(full, createParallelGroup())).toBe(true);
        const groups = Array.from({ length: MAX_PARALLEL_GROUPS }, () => createParallelGroup());
        expect(canInsert(groups, createParallelGroup())).toBe(false);
    });
});

describe('chain selection order', () => {
    it('lists each group before the effects in its branches', () => {
        const { eq, compressor, limiter, group, chain } = setup();
        expect(displayOrder(chain)).toEqual([eq.id, group.id, compressor.id, limiter.id]);
    });

    it('steps through the display order and stops at the ends', () => {
        const { eq, compressor, limiter, group, chain } = setup();
        expect(stepSelection(chain, eq.id, 1)).toBe(group.id);
        expect(stepSelection(chain, group.id, 1)).toBe(compressor.id);
        expect(stepSelection(chain, limiter.id, -1)).toBe(compressor.id);
        expect(stepSelection(chain, limiter.id, 1)).toBe(limiter.id);
        expect(stepSelection(chain, eq.id, -1)).toBe(eq.id);
        expect(stepSelection(chain, compressor.id, Infinity)).toBe(limiter.id);
        expect(stepSelection(chain, compressor.id, -Infinity)).toBe(eq.id);
    });

    it('starts from the matching end without a selection', () => {
        const { eq, limiter, chain } = setup();
        expect(stepSelection(chain, undefined, 1)).toBe(eq.id);
        expect(stepSelection(chain, undefined, -1)).toBe(limiter.id);
        expect(stepSelection(chain, 'missing', -Infinity)).toBe(eq.id);
        expect(stepSelection(chain, 'missing', Infinity)).toBe(limiter.id);
        expect(stepSelection([], undefined, 1)).toBeUndefined();
    });

    it('orders side panel panels like the chain strip, whatever order they were pinned in', () => {
        const { eq, compressor, limiter, group, chain } = setup();
        expect(panelOrder(chain, [limiter.id, eq.id, compressor.id])).toEqual([
            eq.id,
            compressor.id,
            limiter.id,
        ]);
        // The selection lands between the pinned items, and duplicates or stale ids drop out.
        expect(panelOrder(chain, [limiter.id, eq.id, 'missing', group.id, eq.id])).toEqual([
            eq.id,
            group.id,
            limiter.id,
        ]);
        expect(panelOrder(chain, [undefined])).toEqual([]);
    });
});
