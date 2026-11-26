import { SPECS, type NumberSpec } from '../../shared/effects';
import { specValue } from '../display/handles';
import { drawControlNode, nodeHandle, ringWheel, type ControlNode } from '../display/node';
import type { CanvasPoint, DragHandle } from '../display/pointer';
import { formatFrequency, fromNormalized, toNormalized } from '../format';
import { css, frequencyToX, xToFrequency } from '../graph';

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

/** The name of a band: Low, Mid, High and so on, or Full for an unsplit signal. */
export function bandLabel(index: number, count: number): string {
    const names: Record<number, string[]> = {
        1: ['Full'],
        2: ['Low', 'High'],
        3: ['Low', 'Mid', 'High'],
        4: ['Low', 'Low Mid', 'High Mid', 'High'],
    };
    return names[count]?.[index] ?? '';
}

/** The crossovers between bands: a line with a handle in the middle and the frequency at the top. */
export function drawCrossovers(
    ctx: CanvasRenderingContext2D,
    crossovers: number[],
    width: number,
    height: number,
    color: string,
) {
    ctx.save();
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    crossovers.forEach((frequency, index) => {
        const x = Math.round(frequencyToX(frequency, width)) + 0.5;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, height / 2, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = css('--text');
        // Neighbouring labels alternate between two rows, so they do not overlap.
        ctx.fillText(formatFrequency(frequency), x + 6, 14 + (index % 2) * 12);
    });
    ctx.restore();
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

/**
 * The control node of one band, between its crossovers at `left` and `right`. Both axes follow
 * the knobs' scales; its guides run across the band and down to its floor.
 */
function bandControl(
    node: BandNode,
    band: number,
    left: number,
    right: number,
    height: number,
): ControlNode<Partial<NodeValue>> {
    const { specs, values, onChange } = node;
    const value = values[band];
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
    return {
        x: nodeX(specs.x, value.x, left, right),
        y: nodeY(specs.y, value.y, height),
        atX: (x) => ({ x: nodeXValue(specs.x, x, left, right) }),
        atY: (y) => ({ y: nodeYValue(specs.y, y, height) }),
        apply: set,
        ring: { spec: specs.ring, value: value.ring, onChange: (ring) => set({ ring }) },
        reset: {
            node: () => set({ x: specs.x.default, y: specs.y.default, ring: specs.ring.default }),
            x: () => set({ x: specs.x.default }),
            y: () => set({ y: specs.y.default }),
        },
        across: { left: left + 4, right: right - 4 },
        down: { bottom: height - NODE_BOTTOM },
        key: band,
    };
}

/** Draws every band's node, with its values next to the selected one. */
export function drawBandNodes(
    ctx: CanvasRenderingContext2D,
    node: BandNode,
    edges: number[],
    height: number,
    selected: number,
    tint: (index: number) => string,
    /** The `id` of the handle under the pointer, to highlight it. */
    hot?: string,
) {
    node.values.forEach((value, index) => {
        const left = edges[index];
        const right = edges[index + 1];
        const control = bandControl(node, index, left, right, height);
        const { y } = control;
        const color = tint(index);
        const on = index === selected;
        drawControlNode(ctx, control, color, hot, { selected: on, alpha: on ? 0.7 : 0.3 });
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
    return bandNodeHandle(point, node, band, bandEdges(crossovers, width), () => select(band));
}

/**
 * A band's node under the pointer (see {@link nodeHandle}); elsewhere in the band, a press
 * selects it and the wheel turns its node's ring.
 */
function bandNodeHandle(
    point: CanvasPoint,
    node: BandNode,
    band: number,
    edges: number[],
    press: () => void,
): DragHandle {
    const control = bandControl(node, band, edges[band], edges[band + 1], point.height);
    return (
        nodeHandle(point, control, { press }) ?? { cursor: '', press, wheel: ringWheel(control) }
    );
}
