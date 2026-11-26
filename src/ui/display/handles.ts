import type { NumberSpec } from '../../shared/effects';
import { fromNormalized, roundForSpec, toNormalized } from '../format';
import { RING_RADIUS } from './draw';
import type { CanvasPoint, DragHandle } from './pointer';

/**
 * Hit tests and handles for the controls on the displays. A hit test tells which part of a
 * control is under the pointer; a handle says what dragging, double-clicking and the wheel do.
 */

/** Pointer distance to a line, within which the line counts as hit. */
export const LINE_GRAB = 6;

/** Pointer travel, in pixels, that turns a node's ring through its whole range. */
const RING_DRAG_PIXELS = 160;

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
 * A handle for one setting, such as a line or a guide: `toValue` reads the setting off the
 * pointer while it drags. Double-click restores the default, the wheel steps it like a knob;
 * `extra` overrides any of these or adds `press` and `release`.
 */
export function settingHandle({
    id,
    cursor,
    spec,
    value,
    toValue,
    onChange,
    ...extra
}: {
    id: string;
    cursor: string;
    spec: NumberSpec;
    value: number;
    toValue: (point: CanvasPoint) => number;
    onChange: (value: number) => void;
} & Partial<DragHandle>): DragHandle {
    const set = (next: number) => onChange(specValue(spec, next));
    return {
        id,
        cursor,
        drag: (to) => set(toValue(to)),
        reset: () => set(spec.default),
        wheel: (direction, fine) => set(wheelStep(spec, value, direction, fine)),
        ...extra,
    };
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
    return settingHandle({
        id,
        cursor: 'ns-resize',
        spec,
        value,
        toValue: (to) => fromNormalized(spec, start + (startY - to.y) / RING_DRAG_PIXELS),
        onChange,
        wheel: undefined,
        ...extra,
    });
}
