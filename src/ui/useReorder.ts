import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';

/** Moves with Alt+↑ and Alt+↓, as insertion points relative to the item's own index. */
const KEY_STEPS: Record<string, number> = { ArrowUp: -1, ArrowDown: 2 };

/**
 * Reordering a list of `count` items by dragging its rows, or with Alt+↑/↓ on a row's focused
 * control. `onMove(from, to)` moves the item at `from` to the insertion point `to` (0 before
 * the first item, `count` after the last). Each row spreads `rowProps(index)` and adds
 * `marker(index)` to its classes, which shows where a dragged item would land; its control
 * passes key presses to `keyMove`, which tells whether it moved the item.
 */
export function useReorder(
    count: number,
    onMove: (from: number, to: number) => void,
    dragType: string,
) {
    const dragFrom = useRef<number | undefined>(undefined);
    const [dropAt, setDropAt] = useState<number>();

    const end = () => {
        dragFrom.current = undefined;
        setDropAt(undefined);
    };

    const rowProps = (index: number, data: string) => ({
        draggable: true,
        onDragStart: (event: DragEvent<HTMLElement>) => {
            dragFrom.current = index;
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData(dragType, data);
        },
        onDragOver: (event: DragEvent<HTMLElement>) => {
            if (dragFrom.current === undefined) {
                return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            // The upper half of a row drops before it, the lower half after it.
            const box = event.currentTarget.getBoundingClientRect();
            const at = event.clientY < box.top + box.height / 2 ? index : index + 1;
            if (at !== dropAt) {
                setDropAt(at);
            }
        },
        onDrop: (event: DragEvent<HTMLElement>) => {
            event.preventDefault();
            if (dragFrom.current !== undefined && dropAt !== undefined) {
                onMove(dragFrom.current, dropAt);
            }
            end();
        },
        onDragEnd: end,
    });

    const marker = (index: number) => {
        if (dropAt === index) {
            return 'drop-before';
        }
        return dropAt === count && index === count - 1 ? 'drop-after' : '';
    };

    const keyMove = (event: KeyboardEvent<HTMLElement>, index: number): boolean => {
        const step = event.altKey ? KEY_STEPS[event.key] : undefined;
        if (step === undefined) {
            return false;
        }
        event.preventDefault();
        onMove(index, index + step);
        return true;
    };

    return { rowProps, marker, keyMove };
}
