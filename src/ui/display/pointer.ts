import { useRef, useState, type MouseEvent, type PointerEvent, type WheelEvent } from 'react';

/** A pointer position in CSS pixels within the canvas, with the canvas size. */
export interface CanvasPoint {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Something on a display that responds to the pointer: a line, a point or an area. */
export interface DragHandle {
    /** Names the handle, so the display can highlight it; see `useCanvasDrag`'s `hot`. */
    id?: string;
    /** Cursor shown while hovering or dragging it. */
    cursor: string;
    /** Called once when it is pressed, before the first `drag`. */
    press?: () => void;
    /** Called on press and with every move while the button is held. */
    drag?: (point: CanvasPoint) => void;
    /** Called when the button is released or the drag is cancelled. */
    release?: () => void;
    /** Double-click: restores the default. */
    reset?: () => void;
    /** Mouse wheel; `fine` while Shift is held. */
    wheel?: (direction: 1 | -1, fine: boolean) => void;
}

/** Share of the pointer movement applied while Shift is held. */
const FINE_SCALE = 0.2;

function pointOf(event: MouseEvent<HTMLCanvasElement>): CanvasPoint {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        width: rect.width,
        height: rect.height,
    };
}

interface ActiveDrag {
    handle: DragHandle;
    /** Where the handle is being moved to; lags the pointer while Shift is held. */
    point: CanvasPoint;
    lastX: number;
    lastY: number;
}

/**
 * Whether the mouse wheel edits settings on the displays. Not in the side panel: wheel events
 * cannot be kept from scrolling it, so the wheel would change a setting and scroll at once.
 */
export function wheelEditsDisplays(): boolean {
    return !document.documentElement.classList.contains('side-panel');
}

/**
 * Pointer handling for canvas displays. `hitTest` names the handle under the pointer, if any.
 * `handlers` go on the canvas: they drag the handle with pointer capture, show its cursor on
 * hover, reset it on double-click and step it with the wheel; Shift slows dragging down for
 * fine adjustments. `hot` is the `id` of the handle under the pointer, or being dragged, for the
 * display to highlight.
 */
export function useCanvasDrag(hitTest: (point: CanvasPoint) => DragHandle | undefined) {
    const active = useRef<ActiveDrag | undefined>(undefined);
    const hitRef = useRef(hitTest);
    hitRef.current = hitTest;
    const [hot, setHot] = useState<string>();
    // Mirrors `hot`, so a move that changes nothing sets no state.
    const hovered = useRef<string | undefined>(undefined);
    const hover = (id: string | undefined) => {
        if (id !== hovered.current) {
            hovered.current = id;
            setHot(id);
        }
    };

    const end = () => {
        active.current?.handle.release?.();
        active.current = undefined;
    };

    const handlers = {
        onPointerDown: (event: PointerEvent<HTMLCanvasElement>) => {
            if (event.button !== 0) {
                return;
            }
            const point = pointOf(event);
            const handle = hitRef.current(point);
            if (!handle) {
                return;
            }
            handle.press?.();
            if (handle.drag) {
                event.currentTarget.setPointerCapture(event.pointerId);
                active.current = { handle, point, lastX: point.x, lastY: point.y };
                handle.drag(point);
            }
        },
        onPointerMove: (event: PointerEvent<HTMLCanvasElement>) => {
            const point = pointOf(event);
            const drag = active.current;
            if (!drag) {
                const handle = hitRef.current(point);
                event.currentTarget.style.cursor = handle?.cursor ?? '';
                hover(handle?.id);
                return;
            }
            const scale = event.shiftKey ? FINE_SCALE : 1;
            drag.point = {
                ...point,
                x: drag.point.x + (point.x - drag.lastX) * scale,
                y: drag.point.y + (point.y - drag.lastY) * scale,
            };
            drag.lastX = point.x;
            drag.lastY = point.y;
            drag.handle.drag?.(drag.point);
        },
        onPointerUp: end,
        onPointerCancel: end,
        onPointerLeave: () => {
            if (!active.current) {
                hover(undefined);
            }
        },
        onDoubleClick: (event: MouseEvent<HTMLCanvasElement>) =>
            hitRef.current(pointOf(event))?.reset?.(),
        onWheel: (event: WheelEvent<HTMLCanvasElement>) => {
            if (!wheelEditsDisplays()) {
                return;
            }
            hitRef.current(pointOf(event))?.wheel?.(event.deltaY < 0 ? 1 : -1, event.shiftKey);
        },
    };
    return { handlers, hot };
}
