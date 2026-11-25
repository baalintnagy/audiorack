import { useRef, type MouseEvent, type PointerEvent, type WheelEvent } from 'react';
import type { NumberSpec } from '../shared/effects';
import { fromNormalized, roundForSpec, toNormalized } from './format';
import { RING_RADIUS } from './graph';

/** A pointer position in CSS pixels within the canvas, with the canvas size. */
export interface CanvasPoint {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Something on a display that responds to the pointer: a line, a point or an area. */
export interface DragHandle {
    /** Names the handle for hover highlighting; see `useCanvasDrag`'s `onHover`. */
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
 * Pointer handling for canvas displays. `hitTest` names the handle under the pointer, if any;
 * the returned props drag it with pointer capture, show its cursor on hover, reset it on
 * double-click and step it with the wheel. Shift slows dragging down for fine adjustments.
 * `onHover` hears the `id` of the handle under the pointer, or being dragged, as it changes.
 */
export function useCanvasDrag(
    hitTest: (point: CanvasPoint) => DragHandle | undefined,
    onHover?: (id: string | undefined) => void,
) {
    const active = useRef<ActiveDrag | undefined>(undefined);
    const hitRef = useRef(hitTest);
    hitRef.current = hitTest;
    const hovered = useRef<string | undefined>(undefined);
    const hover = (id: string | undefined) => {
        if (id !== hovered.current) {
            hovered.current = id;
            onHover?.(id);
        }
    };

    const end = () => {
        active.current?.handle.release?.();
        active.current = undefined;
    };

    return {
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
}

/**
 * Whether the mouse wheel edits settings on the displays. Not in the side panel: wheel events
 * cannot be kept from scrolling it, so the wheel would change a setting and scroll at once.
 */
export function wheelEditsDisplays(): boolean {
    return !document.documentElement.classList.contains('side-panel');
}

/** Clamps a value to its spec and rounds it the way the knobs do. */
export function specValue(spec: NumberSpec, value: number): number {
    return roundForSpec(spec, Math.min(spec.max, Math.max(spec.min, value)));
}

/** One mouse wheel step along the spec's own scale, like a knob. */
export function wheelStep(
    spec: NumberSpec,
    value: number,
    direction: 1 | -1,
    fine: boolean,
): number {
    const position = toNormalized(spec, value) + direction * (fine ? 0.002 : 0.015);
    return specValue(spec, fromNormalized(spec, position));
}

/** Pointer distance to a horizontal line at `y`, within which the line counts as hit. */
export const LINE_GRAB = 6;

/** Pointer travel, in pixels, that turns a node's ring through its whole range. */
const RING_DRAG_PIXELS = 160;

/**
 * Which part of a node is under the pointer: its center, which moves it, or its ring, which
 * sets the third setting.
 */
export function nodePart(
    point: { x: number; y: number },
    x: number,
    y: number,
    ringRadius = RING_RADIUS,
): 'center' | 'ring' | undefined {
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance <= ringRadius - 5) {
        return 'center';
    }
    return distance <= ringRadius + 5 ? 'ring' : undefined;
}

/**
 * Dragging a node's ring up or down, like a knob: up raises the setting. The pointer can
 * leave the ring once it is grabbed.
 */
export function ringHandle(
    id: string,
    spec: NumberSpec,
    value: number,
    startY: number,
    onChange: (value: number) => void,
    extra: Partial<DragHandle> = {},
): DragHandle {
    const start = toNormalized(spec, value);
    return {
        id,
        cursor: 'ns-resize',
        drag: (to) =>
            onChange(
                specValue(spec, fromNormalized(spec, start + (startY - to.y) / RING_DRAG_PIXELS)),
            ),
        reset: () => onChange(spec.default),
        ...extra,
    };
}
