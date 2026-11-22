import {
    isParallelGroup,
    type ChainItem,
    type Effect,
    type ParallelBranch,
    type ParallelGroup,
} from './effects';
import { MAX_CHAIN_LENGTH, MAX_PARALLEL_GROUPS } from './normalize';

/** Addresses one branch of a parallel group. */
export interface BranchRef {
    groupId: string;
    branchId: string;
}

/**
 * An insertion point in a serial lane: the main chain when `branch` is omitted, otherwise
 * the effects of one parallel branch. `index` counts the items currently in that lane.
 */
export interface ChainPosition {
    branch?: BranchRef;
    index: number;
}

/** Every effect in the rack, in processing order within each lane. */
export function allEffects(chain: ChainItem[]): Effect[] {
    return chain.flatMap((item) =>
        isParallelGroup(item) ? item.branches.flatMap((branch) => branch.effects) : [item],
    );
}

export function countEffects(chain: ChainItem[]): number {
    return allEffects(chain).length;
}

export function countGroups(chain: ChainItem[]): number {
    return chain.filter(isParallelGroup).length;
}

/** Whether `item` fits within the rack's effect and group limits. */
export function canInsert(chain: ChainItem[], item: ChainItem): boolean {
    if (!isParallelGroup(item)) {
        return countEffects(chain) < MAX_CHAIN_LENGTH;
    }
    return (
        countGroups(chain) < MAX_PARALLEL_GROUPS &&
        countEffects(chain) + countEffects([item]) <= MAX_CHAIN_LENGTH
    );
}

export function findItem(chain: ChainItem[], id: string): ChainItem | undefined {
    return chain.find((item) => item.id === id) ?? allEffects(chain).find((item) => item.id === id);
}

export function findGroup(chain: ChainItem[], id: string): ParallelGroup | undefined {
    const item = chain.find((candidate) => candidate.id === id);
    return item && isParallelGroup(item) ? item : undefined;
}

export function locate(chain: ChainItem[], id: string): ChainPosition | undefined {
    const index = chain.findIndex((item) => item.id === id);
    if (index >= 0) {
        return { index };
    }
    return chain
        .filter(isParallelGroup)
        .flatMap((group) =>
            group.branches.map((branch) => ({
                branch: { groupId: group.id, branchId: branch.id },
                index: branch.effects.findIndex((effect) => effect.id === id),
            })),
        )
        .find((position) => position.index >= 0);
}

/** Item ids in the order the chain strip shows them: each group before its branches' effects. */
export function displayOrder(chain: ChainItem[]): string[] {
    return chain.flatMap((item) =>
        isParallelGroup(item)
            ? [item.id, ...allEffects([item]).map((effect) => effect.id)]
            : [item.id],
    );
}

/**
 * The items open as panels when several are shown: `shown` (pinned items and the selection) in
 * display order, so they read like the chain strip, left to right and each group top-down.
 * Ids no longer in the chain are left out.
 */
export function panelOrder(chain: ChainItem[], shown: Iterable<string | undefined>): string[] {
    const wanted = new Set(shown);
    return displayOrder(chain).filter((id) => wanted.has(id));
}

/**
 * The item `step` places from `id` in display order, stopping at either end. Without a shown
 * `id`, stepping forward starts at the first item and stepping back at the last.
 */
export function stepSelection(
    chain: ChainItem[],
    id: string | undefined,
    step: number,
): string | undefined {
    const order = displayOrder(chain);
    const found = id === undefined ? -1 : order.indexOf(id);
    // Without a selection, start just outside the end the step moves away from.
    const index = found >= 0 ? found : step > 0 ? -1 : order.length;
    return order[Math.min(order.length - 1, Math.max(0, index + step))];
}

/** The insertion point right after `id`, or the end of the main chain. */
export function positionAfter(chain: ChainItem[], id: string | undefined): ChainPosition {
    const position = id === undefined ? undefined : locate(chain, id);
    return position ? { ...position, index: position.index + 1 } : { index: chain.length };
}

/** Where to add `item` after `id`: groups go after the group containing a branch position. */
export function insertionPoint(
    chain: ChainItem[],
    item: ChainItem,
    id: string | undefined,
): ChainPosition {
    const position = positionAfter(chain, id);
    return isParallelGroup(item) && position.branch
        ? positionAfter(chain, position.branch.groupId)
        : position;
}

function mapBranches(
    chain: ChainItem[],
    update: (branch: ParallelBranch, group: ParallelGroup) => ParallelBranch,
): ChainItem[] {
    return chain.map((item) =>
        isParallelGroup(item)
            ? { ...item, branches: item.branches.map((branch) => update(branch, item)) }
            : item,
    );
}

function insertAt<T>(items: T[], item: T, index: number): T[] {
    const at = Math.min(Math.max(index, 0), items.length);
    return [...items.slice(0, at), item, ...items.slice(at)];
}

export function mapEffect(
    chain: ChainItem[],
    id: string,
    update: (effect: Effect) => Effect,
): ChainItem[] {
    const replace = (effect: Effect) => (effect.id === id ? update(effect) : effect);
    return mapBranches(chain, (branch) => ({
        ...branch,
        effects: branch.effects.map(replace),
    })).map((item) => (isParallelGroup(item) ? item : replace(item)));
}

export function mapGroup(
    chain: ChainItem[],
    id: string,
    update: (group: ParallelGroup) => ParallelGroup,
): ChainItem[] {
    return chain.map((item) => (isParallelGroup(item) && item.id === id ? update(item) : item));
}

/** Flips the bypass of the effect or parallel group `id`. */
export function toggleBypass(chain: ChainItem[], id: string): ChainItem[] {
    const flip = <T extends ChainItem>(item: T): T => ({ ...item, bypass: !item.bypass });
    return mapGroup(mapEffect(chain, id, flip), id, flip);
}

export function removeItem(chain: ChainItem[], id: string): ChainItem[] {
    return mapBranches(
        chain.filter((item) => item.id !== id),
        (branch) => ({ ...branch, effects: branch.effects.filter((effect) => effect.id !== id) }),
    );
}

/** Inserts an item; parallel groups can only be placed in the main chain. */
export function insertItem(
    chain: ChainItem[],
    item: ChainItem,
    position: ChainPosition,
): ChainItem[] {
    const target = position.branch;
    if (!target) {
        return insertAt(chain, item, position.index);
    }
    if (isParallelGroup(item)) {
        return chain;
    }
    return mapBranches(chain, (branch, group) =>
        group.id === target.groupId && branch.id === target.branchId
            ? { ...branch, effects: insertAt(branch.effects, item, position.index) }
            : branch,
    );
}

/** Whether two positions address the same lane: the main chain or one branch. */
export function sameLane(a: ChainPosition, b: ChainPosition): boolean {
    return a.branch?.groupId === b.branch?.groupId && a.branch?.branchId === b.branch?.branchId;
}

/** Moves an item to an insertion point given relative to the lane before the move. */
export function moveItem(chain: ChainItem[], id: string, position: ChainPosition): ChainItem[] {
    const item = findItem(chain, id);
    const from = locate(chain, id);
    if (!item || !from || (isParallelGroup(item) && position.branch)) {
        return chain;
    }
    const shift = sameLane(from, position) && from.index < position.index ? 1 : 0;
    return insertItem(removeItem(chain, id), item, {
        ...position,
        index: position.index - shift,
    });
}

/** Replaces a parallel group with its effects in series, branch after branch. */
export function ungroup(chain: ChainItem[], id: string): ChainItem[] {
    return chain.flatMap((item) =>
        isParallelGroup(item) && item.id === id
            ? item.branches.flatMap((branch) => branch.effects)
            : [item],
    );
}
