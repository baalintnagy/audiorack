import { useRef, type MouseEvent, type PointerEvent, type WheelEvent } from 'react';
import type { NumberSpec } from '../shared/effects';
import { fromNormalized, roundForSpec, toNormalized } from './format';

/** A pointer position in CSS pixels within the canvas, with the canvas size. */
export interface CanvasPoint {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Something on a display that responds to the pointer: a line, a point or an area. */
export interface DragHandle {
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
 */
export function useCanvasDrag(hitTest: (point: CanvasPoint) => DragHandle | undefined) {
    const active = useRef<ActiveDrag | undefined>(undefined);
    const hitRef = useRef(hitTest);
    hitRef.current = hitTest;

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
                event.currentTarget.style.cursor = hitRef.current(point)?.cursor ?? '';
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
        onDoubleClick: (event: MouseEvent<HTMLCanvasElement>) =>
            hitRef.current(pointOf(event))?.reset?.(),
        onWheel: (event: WheelEvent<HTMLCanvasElement>) =>
            hitRef.current(pointOf(event))?.wheel?.(event.deltaY < 0 ? 1 : -1, event.shiftKey),
    };
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
