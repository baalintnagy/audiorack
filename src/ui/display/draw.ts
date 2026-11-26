import type { NumberSpec } from '../../shared/effects';
import { toNormalized } from '../format';
import { withAlpha } from '../graph';

/**
 * Drawing of the controls on the displays: nodes with their rings, the dotted guides that run
 * from a node to its settings, and draggable lines such as thresholds. Each can be highlighted
 * (`hot`) while the pointer is over it or drags it.
 */

export const NODE_RADIUS = 6;
export const RING_RADIUS = 14;

type Point = [number, number];

/**
 * How far a node's ring is turned, as a share of a full circle, clockwise from the top.
 * Settings that can go negative turn both ways from zero, up to a half circle in each
 * direction; the others fill the whole circle from their minimum, along the knob's scale.
 */
export function ringTurn(spec: NumberSpec, value: number): number {
    if (spec.min >= 0) {
        return Math.min(1, Math.max(0, toNormalized(spec, value)));
    }
    if (value >= 0) {
        return spec.max > 0 ? Math.min(0.5, (value / spec.max) * 0.5) : 0;
    }
    return Math.max(-0.5, (value / -spec.min) * 0.5);
}

/**
 * A node that controls three settings: a filled dot with a ring around it showing the third
 * one, turned by `turn` (see {@link ringTurn}).
 */
export function drawNode(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    turn: number,
    selected = true,
    hot = false,
) {
    drawRing(ctx, x, y, RING_RADIUS, color, turn, hot);
    ctx.beginPath();
    ctx.arc(x, y, NODE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = selected ? 2 : 1.5;
    ctx.strokeStyle = selected ? '#ffffff' : withAlpha('#ffffff', 0.6);
    ctx.stroke();
}

/**
 * The ring of a node on its own, for points drawn in their own style (the EQ's). `turn` is a
 * share of a full circle from the top: positive clockwise, negative counterclockwise.
 */
export function drawRing(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    color: string,
    turn: number,
    hot = false,
) {
    ctx.save();
    ctx.lineWidth = hot ? 5 : 3.5;
    ctx.strokeStyle = withAlpha(color, hot ? 0.45 : 0.22);
    if (hot) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
    }
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    if (Math.abs(turn) > 0.003) {
        const sweep = Math.max(-1, Math.min(1, turn)) * Math.PI * 2;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, radius, -Math.PI / 2, -Math.PI / 2 + sweep, turn < 0);
        ctx.stroke();
    }
    ctx.restore();
}

/** The parts of the segment from `from` to `to` that lie outside a circle. */
export function outsideCircle(
    from: Point,
    to: Point,
    circle: { x: number; y: number; r: number },
): [Point, Point][] {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const a = dx * dx + dy * dy;
    if (a === 0) {
        return [];
    }
    const fx = from[0] - circle.x;
    const fy = from[1] - circle.y;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - circle.r * circle.r;
    const discriminant = b * b - 4 * a * c;
    if (discriminant <= 0) {
        return [[from, to]];
    }
    const root = Math.sqrt(discriminant);
    const enter = (-b - root) / (2 * a);
    const leave = (-b + root) / (2 * a);
    const at = (t: number): Point => [from[0] + dx * t, from[1] + dy * t];
    const parts: [Point, Point][] = [];
    if (enter > 0) {
        parts.push([from, at(Math.min(enter, 1))]);
    }
    if (leave < 1) {
        parts.push([at(Math.max(leave, 0)), to]);
    }
    return parts.filter(([p, q]) => Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.5);
}

interface LineStyle {
    color: string;
    /** Color at rest; highlighted lines use `color`. */
    base: string;
    hot: boolean;
    dash: number[];
    width: number;
    hotWidth: number;
    glow: number;
}

/**
 * Strokes the path that `trace` describes in a line style. A highlighted line gets a soft band
 * behind it, a thicker stroke and a glow, so it stands out from the display.
 */
function strokeLine(ctx: CanvasRenderingContext2D, trace: () => void, style: LineStyle) {
    ctx.save();
    ctx.lineCap = 'round';
    if (style.hot) {
        ctx.lineWidth = 10;
        ctx.strokeStyle = withAlpha(style.color, 0.22);
        trace();
        ctx.stroke();
        ctx.shadowColor = style.color;
        ctx.shadowBlur = style.glow;
    }
    ctx.setLineDash(style.dash);
    ctx.lineWidth = style.hot ? style.hotWidth : style.width;
    ctx.strokeStyle = style.hot ? style.color : style.base;
    trace();
    ctx.stroke();
    ctx.restore();
}

/**
 * A dotted line from a node to where its setting reads off the display, such as the level a
 * threshold sits at or the frequency a handle is set to. With `around`, the part inside that
 * node's ring is left out, so the guide never crosses the node. Guides can be dragged for their
 * setting; `hot` highlights one while the pointer is over it, like a dashed line.
 */
export function drawGuide(
    ctx: CanvasRenderingContext2D,
    from: Point,
    to: Point,
    color: string,
    alpha = 0.7,
    around?: { x: number; y: number },
    hot = false,
) {
    const parts = around
        ? outsideCircle(from, to, { ...around, r: RING_RADIUS + 3 })
        : [[from, to] as [Point, Point]];
    const trace = () => {
        ctx.beginPath();
        parts.forEach(([start, end]) => {
            ctx.moveTo(start[0], start[1]);
            ctx.lineTo(end[0], end[1]);
        });
    };
    strokeLine(ctx, trace, {
        color,
        base: withAlpha(color, alpha),
        hot,
        dash: hot ? [1, 4] : [1, 3],
        width: 1.5,
        hotWidth: 3,
        glow: 12,
    });
}

/**
 * A line that can be dragged, such as a threshold: dashed in `base` at rest, and highlighted in
 * `color` while the pointer is over it or drags it (`hot`). `dash` empty draws it solid.
 */
export function drawHandleLine(
    ctx: CanvasRenderingContext2D,
    points: Point[],
    {
        color,
        base,
        hot,
        dash = [4, 4],
    }: { color: string; base: string; hot: boolean; dash?: number[] },
) {
    if (points.length < 2) {
        return;
    }
    const trace = () => {
        ctx.beginPath();
        points.forEach(([x, y], index) => (index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    };
    strokeLine(ctx, trace, {
        color,
        base,
        hot,
        dash: hot && dash.length ? dash.map((length) => length * 1.5) : dash,
        width: 1,
        hotWidth: 2.5,
        glow: 14,
    });
}
