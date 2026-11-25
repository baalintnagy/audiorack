import { SPECS, type NumberSpec } from '../../shared/effects';
import {
    nodePart,
    ringHandle,
    specValue,
    wheelStep,
    type CanvasPoint,
    type DragHandle,
} from '../canvasDrag';
import { fromNormalized, toNormalized } from '../format';
import {
    RING_RADIUS,
    css,
    drawGuide,
    drawNode,
    frequencyToX,
    ringTurn,
    xToFrequency,
} from '../graph';

/** Smallest ratio between neighbouring crossovers. */
const MIN_GAP = 1.25;
/** Room left for the crossover labels above and the band names below the nodes. */
const NODE_TOP = 34;
const NODE_BOTTOM = 32;
/** Room kept clear of the crossovers at each side of a band. */
const NODE_MARGIN = 16;

/** The three settings a band node controls. */
export interface NodeValue {
    /** Across the band, left to right. */
    x: number;
    /** Up the display. */
    y: number;
    /** Mouse wheel, shown as a ring around the node. */
    ring: number;
}

/**
 * Three per-band settings on one node: dragging moves it across and up the band, the wheel
 * turns its ring. Both axes follow the knobs' scales, so log settings such as a ratio spread
 * evenly.
 */
export interface BandNode {
    specs: { [K in keyof NodeValue]: NumberSpec };
    values: NodeValue[];
    onChange: (index: number, patch: Partial<NodeValue>) => void;
    /** Shown next to the selected band's node. */
    format: (value: NodeValue) => string;
}

export function bandEdges(crossovers: number[], width: number): number[] {
    return [20, ...crossovers, 20000].map((frequency) => frequencyToX(frequency, width));
}

function nodeX(spec: NumberSpec, value: number, left: number, right: number): number {
    const span = right - left - 2 * NODE_MARGIN;
    if (span < 8) {
        return (left + right) / 2;
    }
    return left + NODE_MARGIN + toNormalized(spec, value) * span;
}

function nodeXValue(spec: NumberSpec, x: number, left: number, right: number): number {
    const span = right - left - 2 * NODE_MARGIN;
    if (span < 8) {
        return spec.default;
    }
    return fromNormalized(spec, (x - left - NODE_MARGIN) / span);
}

function nodeY(spec: NumberSpec, value: number, height: number): number {
    const bottom = height - NODE_BOTTOM;
    return bottom - toNormalized(spec, value) * (bottom - NODE_TOP);
}

function nodeYValue(spec: NumberSpec, y: number, height: number): number {
    const bottom = height - NODE_BOTTOM;
    return fromNormalized(spec, (bottom - y) / (bottom - NODE_TOP));
}

/** Draws every band's node, with its values next to the selected one. */
export function drawBandNodes(
    ctx: CanvasRenderingContext2D,
    node: BandNode,
    edges: number[],
    height: number,
    selected: number,
    tint: (index: number) => string,
    /** The `id` of the handle under the pointer, to highlight its ring. */
    hot?: string,
) {
    const { specs } = node;
    node.values.forEach((value, index) => {
        const left = edges[index];
        const right = edges[index + 1];
        const x = nodeX(specs.x, value.x, left, right);
        const y = nodeY(specs.y, value.y, height);
        const color = tint(index);
        const on = index === selected;
        // Guides: the vertical setting across the band, the horizontal one down to its floor.
        const alpha = on ? 0.7 : 0.3;
        drawGuide(ctx, [left + 4, y], [x - RING_RADIUS - 2, y], color, alpha);
        drawGuide(ctx, [x + RING_RADIUS + 2, y], [right - 4, y], color, alpha);
        drawGuide(ctx, [x, y + RING_RADIUS + 2], [x, height - NODE_BOTTOM], color, alpha);
        drawNode(ctx, x, y, color, ringTurn(specs.ring, value.ring), on, hot === `ring:${index}`);
        if (on && right - left > 60) {
            ctx.fillStyle = css('--grid-label');
            ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
            ctx.textAlign = 'center';
            // One line when it fits the band, otherwise one line per setting; placed in the half
            // of the band away from the node.
            const text = node.format(value);
            const lines =
                ctx.measureText(text).width < right - left - 8 ? [text] : text.split(' · ');
            const top = y > height / 2 ? 62 : height - NODE_BOTTOM - 6 - (lines.length - 1) * 12;
            lines.forEach((line, row) => ctx.fillText(line, (left + right) / 2, top + row * 12));
            ctx.textAlign = 'start';
        }
    });
}

/**
 * The handle under the pointer on a band display: a crossover, a band's node, or the band
 * itself, which `select`s it.
 */
export function bandHandle({
    point,
    crossovers,
    onCrossovers,
    select,
    node,
}: {
    point: CanvasPoint;
    crossovers: number[];
    onCrossovers: (crossovers: number[]) => void;
    select: (index: number) => void;
    node: BandNode;
}): DragHandle {
    const { x, width } = point;
    const crossover = crossovers.findIndex(
        (frequency) => Math.abs(frequencyToX(frequency, width) - x) < 8,
    );
    if (crossover >= 0) {
        const lower = crossover > 0 ? crossovers[crossover - 1] * MIN_GAP : SPECS.crossover.min;
        const upper =
            crossover < crossovers.length - 1
                ? crossovers[crossover + 1] / MIN_GAP
                : SPECS.crossover.max;
        return {
            cursor: 'ew-resize',
            drag: (to) => {
                const frequency = Math.min(upper, Math.max(lower, xToFrequency(to.x, width)));
                onCrossovers(
                    crossovers.map((value, index) =>
                        index === crossover ? Math.round(frequency) : value,
                    ),
                );
            },
        };
    }
    const frequency = xToFrequency(x, width);
    const band = crossovers.filter((value) => value < frequency).length;
    return nodeHandle(point, node, band, bandEdges(crossovers, width), () => select(band));
}

function nodeHandle(
    point: CanvasPoint,
    node: BandNode,
    band: number,
    edges: number[],
    press: () => void,
): DragHandle {
    const { specs, values, onChange } = node;
    const value = values[band];
    const left = edges[band];
    const right = edges[band + 1];
    const { height } = point;
    const set = (patch: Partial<NodeValue>) =>
        onChange(
            band,
            Object.fromEntries(
                Object.entries(patch).map(([key, next]) => [
                    key,
                    specValue(specs[key as keyof NodeValue], next),
                ]),
            ),
        );
    const wheel: DragHandle['wheel'] = (direction, fine) =>
        set({ ring: wheelStep(specs.ring, value.ring, direction, fine) });
    const x = nodeX(specs.x, value.x, left, right);
    const y = nodeY(specs.y, value.y, height);
    const part = nodePart(point, x, y);
    if (!part) {
        return { cursor: '', press, wheel };
    }
    if (part === 'ring') {
        return ringHandle(
            `ring:${band}`,
            specs.ring,
            value.ring,
            point.y,
            (ring) => set({ ring }),
            {
                press,
                wheel,
            },
        );
    }
    // The node moves with the pointer from where it was grabbed, without jumping to it.
    const offsetX = x - point.x;
    const offsetY = y - point.y;
    return {
        id: `node:${band}`,
        cursor: 'move',
        press,
        drag: (to) =>
            set({
                x: nodeXValue(specs.x, to.x + offsetX, left, right),
                y: nodeYValue(specs.y, to.y + offsetY, height),
            }),
        reset: () => set({ x: specs.x.default, y: specs.y.default, ring: specs.ring.default }),
        wheel,
    };
}
