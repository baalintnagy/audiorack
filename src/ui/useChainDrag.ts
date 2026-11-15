import { useRef, useState, type DragEvent } from 'react';
import { locate, sameLane, type ChainPosition } from '../shared/chain';
import type { ChainItem } from '../shared/effects';

const DRAG_TYPE = 'application/x-audiorack-item';

interface DragState {
    id: string;
    group: boolean;
    from: ChainPosition;
}

/** The insertion index in a lane for pointer `x`: after every item whose centre lies left of it. */
export function dropIndex(centers: number[], x: number): number {
    return centers.filter((center) => center < x).length;
}

/** Whether dropping the item at `from` onto `to` would leave it where it is. */
export function isNoOpMove(from: ChainPosition, to: ChainPosition): boolean {
    return sameLane(from, to) && (to.index === from.index || to.index === from.index + 1);
}

/** Horizontal centres of the items directly inside a lane element. */
function itemCenters(lane: HTMLElement): number[] {
    return [...lane.querySelectorAll(':scope > [role="listitem"]')].map((item) => {
        const rect = item.getBoundingClientRect();
        return rect.left + rect.width / 2;
    });
}

function samePosition(a: ChainPosition | undefined, b: ChainPosition | undefined): boolean {
    return a === b || (a !== undefined && b !== undefined && a.index === b.index && sameLane(a, b));
}

/**
 * Drag and drop of chain items between the main chain and parallel branches. Lanes, not the
 * items in them, are the drop targets, so the gaps and the controls around the items accept
 * drops too.
 */
export function useChainDrag(chain: ChainItem[], onMove: (id: string, to: ChainPosition) => void) {
    const dragged = useRef<DragState | undefined>(undefined);
    const [drop, setDrop] = useState<ChainPosition>();

    const clear = () => {
        dragged.current = undefined;
        setDrop(undefined);
    };

    return {
        start(event: DragEvent<HTMLElement>, id: string, group: boolean) {
            event.stopPropagation();
            const from = locate(chain, id);
            if (!from) {
                return;
            }
            dragged.current = { id, group, from };
            event.dataTransfer.setData(DRAG_TYPE, id);
            event.dataTransfer.effectAllowed = 'move';
        },
        end: clear,
        /**
         * Offers the lane under the pointer as a drop target, `branch` for a parallel branch and
         * the main chain otherwise. Groups only land in the main chain, so over a branch the
         * event is left to the main chain around it.
         */
        over(event: DragEvent<HTMLElement>, branch?: ChainPosition['branch']) {
            const state = dragged.current;
            if (!state || (state.group && branch)) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'move';
            const index = dropIndex(itemCenters(event.currentTarget), event.clientX);
            const position: ChainPosition = branch ? { branch, index } : { index };
            const next = isNoOpMove(state.from, position) ? undefined : position;
            if (!samePosition(drop, next)) {
                setDrop(next);
            }
        },
        /** Hides the marker once the pointer leaves the element that handles it. */
        leave(event: DragEvent<HTMLElement>) {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setDrop(undefined);
            }
        },
        drop(event: DragEvent<HTMLElement>) {
            event.preventDefault();
            event.stopPropagation();
            const state = dragged.current;
            if (state && drop) {
                onMove(state.id, drop);
            }
            clear();
        },
        /** `drop-before`/`drop-after` classes for the item at `position`. */
        markers(position: ChainPosition, last: boolean): string {
            const before = samePosition(drop, position) ? 'drop-before' : '';
            const after =
                last && samePosition(drop, { ...position, index: position.index + 1 })
                    ? 'drop-after'
                    : '';
            return `${before} ${after}`;
        },
        isTarget: (position: ChainPosition) => samePosition(drop, position),
    };
}

export type ChainDrag = ReturnType<typeof useChainDrag>;
