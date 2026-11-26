import type { NumberSpec } from '../../shared/effects';
import { drawGuide, drawNode, RING_RADIUS, ringTurn } from './draw';
import { LINE_GRAB, nodePart, ringHandle, wheelStep } from './handles';
import type { CanvasPoint, DragHandle } from './pointer';

/**
 * Where a control node sits and what it shows: its position, its ring, its guides and their
 * resets. This is all that drawing it and finding its parts under the pointer need.
 */
export interface NodeLayout {
    /** Where the node sits on the display. */
    x: number;
    y: number;
    /** The third setting, shown and turned on the ring. */
    ring: { spec: NumberSpec; value: number; onChange: (value: number) => void };
    /**
     * Double-click: on the node, restores all three settings; on a guide, that guide's own
     * setting (`x` for the one down, `y` for the one across).
     */
    reset?: { node?: () => void; x?: () => void; y?: () => void };
    /** The guide across the node, from `left` to `right`; none without it. */
    across?: { left: number; right: number };
    /** The guide through the node, down to `bottom` from the node, or from `top`; none without it. */
    down?: { top?: number; bottom: number };
    /** Tells apart the handles of several nodes on one display, such as a band's index. */
    key?: string | number;
}

/**
 * A control node: one point on a display that sets three settings. Dragging it sets the two
 * that its position reads, its ring the third. Its dotted guides run from it to where those two
 * read off the display, across for the vertical setting and down (or top to bottom) for the
 * horizontal one, and each drags its own setting.
 *
 * Displays describe their node with this, and leave the pointer and the drawing to
 * {@link nodeHandle} and {@link drawControlNode}, so every node behaves the same way.
 */
export interface ControlNode<Patch extends object> extends NodeLayout {
    /** The setting the node's horizontal position reads, for a position, clamped to its range. */
    atX: (x: number) => Patch;
    /** The setting the node's vertical position reads, for a position, clamped to its range. */
    atY: (y: number) => Patch;
    /** Applies the settings of a move: both when the node moves, one when a guide does. */
    apply: (patch: Patch) => void;
}

/** A node's guides: across at its height, and down through it. */
type GuidePart = 'across' | 'down';

/** The part of a node a handle belongs to. */
type NodePartName = 'node' | 'ring' | GuidePart;

/** The `id` of a node's handle, for highlighting it: `ring`, or `ring:2` with a key. */
function nodeHandleId(node: NodeLayout, part: NodePartName): string {
    return node.key === undefined ? part : `${part}:${node.key}`;
}

/** The mouse wheel turns a node's ring, wherever it is used on the node's display. */
export function ringWheel(node: NodeLayout): NonNullable<DragHandle['wheel']> {
    const { spec, value, onChange } = node.ring;
    return (direction, fine) => onChange(wheelStep(spec, value, direction, fine));
}

/** Which of a node's guides is under the pointer. The node itself and its ring come first. */
function guideAt(point: { x: number; y: number }, node: NodeLayout): GuidePart | undefined {
    if (Math.hypot(point.x - node.x, point.y - node.y) <= RING_RADIUS + 3) {
        return undefined;
    }
    const { across, down } = node;
    if (
        across &&
        Math.abs(point.y - node.y) <= LINE_GRAB &&
        point.x >= across.left &&
        point.x <= across.right
    ) {
        return 'across';
    }
    if (
        down &&
        Math.abs(point.x - node.x) <= LINE_GRAB &&
        point.y >= (down.top ?? node.y) &&
        point.y <= down.bottom
    ) {
        return 'down';
    }
    return undefined;
}

/**
 * The handle of a node under the pointer, if any: its center moves it, its ring turns the third
 * setting like a knob, its guides drag one setting each. The node and its guides move with the
 * pointer from where they were grabbed, without jumping to it. The wheel turns the ring on every
 * part. `extra` is added to each handle, such as a `press` that selects the node.
 */
export function nodeHandle<Patch extends object>(
    point: CanvasPoint,
    node: ControlNode<Patch>,
    extra: Partial<DragHandle> = {},
): DragHandle | undefined {
    const wheel = ringWheel(node);
    const offsetX = node.x - point.x;
    const offsetY = node.y - point.y;
    const part = nodePart(point, node.x, node.y);
    if (part === 'ring') {
        const { spec, value, onChange } = node.ring;
        return ringHandle(nodeHandleId(node, 'ring'), spec, value, point.y, onChange, {
            wheel,
            ...extra,
        });
    }
    if (part === 'center') {
        return {
            id: nodeHandleId(node, 'node'),
            cursor: 'move',
            drag: (to) => node.apply({ ...node.atX(to.x + offsetX), ...node.atY(to.y + offsetY) }),
            reset: node.reset?.node,
            wheel,
            ...extra,
        };
    }
    const guide = guideAt(point, node);
    if (guide === 'across') {
        return {
            id: nodeHandleId(node, 'across'),
            cursor: 'ns-resize',
            drag: (to) => node.apply(node.atY(to.y + offsetY)),
            reset: node.reset?.y,
            wheel,
            ...extra,
        };
    }
    if (guide === 'down') {
        return {
            id: nodeHandleId(node, 'down'),
            cursor: 'ew-resize',
            drag: (to) => node.apply(node.atX(to.x + offsetX)),
            reset: node.reset?.x,
            wheel,
            ...extra,
        };
    }
    return undefined;
}

/**
 * A node's dotted guides, kept off the node. `hot` is the `id` of the handle under the pointer:
 * a guide lights up while it is hot.
 */
export function drawControlGuides(
    ctx: CanvasRenderingContext2D,
    node: NodeLayout,
    color: string,
    hot?: string,
    alpha = 0.7,
) {
    const { x, y, across, down } = node;
    if (across) {
        const lit = hot === nodeHandleId(node, 'across');
        drawGuide(ctx, [across.left, y], [across.right, y], color, alpha, node, lit);
    }
    if (down) {
        const lit = hot === nodeHandleId(node, 'down');
        drawGuide(ctx, [x, down.top ?? y], [x, down.bottom], color, alpha, node, lit);
    }
}

/**
 * Draws a node with its ring and, unless `guides` is false, its guides; the hot part lights up.
 * An unselected node is drawn quieter, its guides at `alpha`.
 */
export function drawControlNode(
    ctx: CanvasRenderingContext2D,
    node: NodeLayout,
    color: string,
    hot?: string,
    { selected = true, alpha = 0.7, guides = true } = {},
) {
    if (guides) {
        drawControlGuides(ctx, node, color, hot, alpha);
    }
    const turn = ringTurn(node.ring.spec, node.ring.value);
    drawNode(ctx, node.x, node.y, color, turn, selected, hot === nodeHandleId(node, 'ring'));
}
