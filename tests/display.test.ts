import { describe, expect, it } from 'vitest';
import { SPECS, type NumberSpec } from '../src/shared/effects';
import { outsideCircle, ringTurn } from '../src/ui/display/draw';
import { nodePart, ringHandle, specValue, wheelStep } from '../src/ui/display/handles';
import { nodeHandle, type ControlNode } from '../src/ui/display/node';
import { type CanvasPoint } from '../src/ui/display/pointer';
import { frequencyToX } from '../src/ui/graph';
import { bandHandle, type BandNode, type NodeValue } from '../src/ui/editors/bandDisplay';
import { toNormalized } from '../src/ui/format';

const WIDTH = 600;
const HEIGHT = 200;

function at(x: number, y: number): CanvasPoint {
    return { x, y, width: WIDTH, height: HEIGHT };
}

describe('canvas value helpers', () => {
    it('clamps and rounds like the knobs', () => {
        expect(specValue(SPECS.thresholdDb, -12.345)).toBe(-12.3);
        expect(specValue(SPECS.thresholdDb, 8)).toBe(0);
        expect(specValue(SPECS.ratio, 0.2)).toBe(SPECS.ratio.min);
    });

    it('steps along the spec scale with the wheel, finer with Shift', () => {
        const coarse = wheelStep(SPECS.thresholdDb, -30, 1, false);
        const fine = wheelStep(SPECS.thresholdDb, -30, 1, true);
        expect(coarse).toBeGreaterThan(fine);
        expect(fine).toBeGreaterThan(-30);
        expect(wheelStep(SPECS.thresholdDb, -30, -1, false)).toBeLessThan(-30);
    });

    it('turns the ring half a circle each way for settings that can go negative', () => {
        expect(ringTurn(SPECS.satDynamics, 100)).toBe(0.5);
        expect(ringTurn(SPECS.satDynamics, -100)).toBe(-0.5);
        expect(ringTurn(SPECS.satDynamics, -50)).toBe(-0.25);
        expect(ringTurn(SPECS.makeupDb, 30)).toBe(0.5);
        expect(ringTurn(SPECS.makeupDb, -12)).toBe(-0.5);
        expect(ringTurn(SPECS.makeupDb, -6)).toBe(-0.25);
        expect(ringTurn(SPECS.deessThresholdDb, -60)).toBe(-0.5);
    });

    it('fills the whole ring for settings that cannot go negative', () => {
        expect(ringTurn(SPECS.kneeDb, 12)).toBe(0.5);
        expect(ringTurn(SPECS.kneeDb, 24)).toBe(1);
        expect(ringTurn(SPECS.ratio, SPECS.ratio.min)).toBe(0);
        // Log settings fill the ring along the knob's scale.
        expect(ringTurn(SPECS.q, SPECS.q.max)).toBe(1);
        expect(ringTurn(SPECS.q, Math.sqrt(SPECS.q.min * SPECS.q.max))).toBeCloseTo(0.5, 6);
        expect(ringTurn(SPECS.hysteresisDb, 12)).toBe(1);
    });
});

/** A two-band display, split at 1 kHz. */
function recorder(specs: BandNode['specs'], values: NodeValue[]) {
    const calls: {
        crossovers?: number[];
        selected?: number;
        patches: { index: number; patch: Partial<NodeValue> }[];
    } = { patches: [] };
    const node: BandNode = {
        specs,
        values,
        onChange: (index, patch) => calls.patches.push({ index, patch }),
        format: String,
    };
    const handle = (point: CanvasPoint) =>
        bandHandle({
            point,
            crossovers: [1000],
            onCrossovers: (crossovers) => (calls.crossovers = crossovers),
            select: (index) => (calls.selected = index),
            node,
        });
    return { calls, handle };
}

/** Node center: 16 px in from the band edges, 34 px from the top and 32 from the bottom. */
function nodeAt(specs: BandNode['specs'], value: NodeValue, left: number, right: number) {
    const along = (spec: NumberSpec, v: number) => toNormalized(spec, v);
    return {
        x: left + 16 + along(specs.x, value.x) * (right - left - 32),
        y: HEIGHT - 32 - along(specs.y, value.y) * (HEIGHT - 32 - 34),
    };
}

const SATURATOR = { x: SPECS.satTone, y: SPECS.satDriveDb, ring: SPECS.satDynamics };
const MULTIBAND = { x: SPECS.ratio, y: SPECS.thresholdDb, ring: SPECS.makeupDb };
const SPLIT = frequencyToX(1000, WIDTH);

describe('band display handles', () => {
    it('drags a crossover, kept within the allowed range', () => {
        const { calls, handle } = recorder(SATURATOR, [
            { x: 0, y: 6, ring: 0 },
            { x: 0, y: 6, ring: 0 },
        ]);
        const grabbed = handle(at(SPLIT + 3, 10));
        expect(grabbed.cursor).toBe('ew-resize');
        grabbed.drag?.(at(frequencyToX(2000, WIDTH), 10));
        expect(calls.crossovers?.[0]).toBeCloseTo(2000, -1);
        grabbed.drag?.(at(WIDTH, 10));
        expect(calls.crossovers).toEqual([SPECS.crossover.max]);
    });

    it('selects a band clicked away from its node, and turns its ring with the wheel', () => {
        const { calls, handle } = recorder(SATURATOR, [
            { x: 0, y: 6, ring: 0 },
            { x: 0, y: 6, ring: 0 },
        ]);
        const clicked = handle(at(frequencyToX(100, WIDTH), 40));
        expect(clicked.cursor).toBe('');
        expect(clicked.drag).toBeUndefined();
        clicked.press?.();
        expect(calls.selected).toBe(0);
        clicked.wheel?.(1, false);
        expect(calls.patches[0].index).toBe(0);
        expect(calls.patches[0].patch.ring).toBeGreaterThan(0);
    });

    it('moves both axes together without jumping to the pointer', () => {
        const values = [
            { x: 0, y: 6, ring: 0 },
            { x: 6, y: 18, ring: 50 },
        ];
        const { calls, handle } = recorder(SATURATOR, values);
        const center = nodeAt(SATURATOR, values[1], SPLIT, WIDTH);
        // Grabbed off-center: the node keeps that offset.
        const grabbed = handle(at(center.x + 4, center.y - 3));
        expect(grabbed.cursor).toBe('move');
        grabbed.press?.();
        expect(calls.selected).toBe(1);
        grabbed.drag?.(at(center.x + 4, center.y - 3));
        expect(calls.patches[0].patch.x).toBeCloseTo(6, 1);
        expect(calls.patches[0].patch.y).toBeCloseTo(18, 1);
        const target = nodeAt(SATURATOR, { x: -6, y: 30, ring: 0 }, SPLIT, WIDTH);
        grabbed.drag?.(at(target.x + 4, target.y - 3));
        expect(calls.patches[1]).toMatchObject({ index: 1, patch: { x: -6, y: 30 } });
    });

    it('spreads a log setting such as the ratio along the knob scale', () => {
        const values = [
            { x: 2, y: -24, ring: 0 },
            { x: 2, y: -24, ring: 0 },
        ];
        const { calls, handle } = recorder(MULTIBAND, values);
        const center = nodeAt(MULTIBAND, values[0], 0, SPLIT);
        const grabbed = handle(at(center.x, center.y));
        const middle = nodeAt(MULTIBAND, { x: Math.sqrt(20), y: -24, ring: 0 }, 0, SPLIT);
        grabbed.drag?.(at(middle.x, middle.y));
        expect(calls.patches[0].patch.x).toBeCloseTo(Math.sqrt(20), 1);
        expect(calls.patches[0].patch.y).toBeCloseTo(-24, 1);
    });

    it('resets all three settings on double-click', () => {
        const values = [
            { x: 4, y: -40, ring: 6 },
            { x: 2, y: -24, ring: 0 },
        ];
        const { calls, handle } = recorder(MULTIBAND, values);
        const center = nodeAt(MULTIBAND, values[0], 0, SPLIT);
        handle(at(center.x, center.y)).reset?.();
        expect(calls.patches[0].patch).toEqual({
            x: SPECS.ratio.default,
            y: SPECS.thresholdDb.default,
            ring: SPECS.makeupDb.default,
        });
    });
});

describe('node rings', () => {
    it('tells the center from the ring', () => {
        expect(nodePart({ x: 103, y: 100 }, 100, 100)).toBe('center');
        expect(nodePart({ x: 114, y: 100 }, 100, 100)).toBe('ring');
        expect(nodePart({ x: 100, y: 85 }, 100, 100)).toBe('ring');
        expect(nodePart({ x: 125, y: 100 }, 100, 100)).toBeUndefined();
    });

    it('turns the ring by dragging up or down, like a knob', () => {
        const values: number[] = [];
        const handle = ringHandle('ring', SPECS.kneeDb, 6, 100, (value) => values.push(value));
        expect(handle.cursor).toBe('ns-resize');
        handle.drag?.(at(0, 100));
        handle.drag?.(at(0, 60));
        handle.drag?.(at(0, 180));
        handle.reset?.();
        expect(values[0]).toBe(6);
        expect(values[1]).toBeGreaterThan(6);
        expect(values[2]).toBe(0);
        expect(values[3]).toBe(SPECS.kneeDb.default);
    });

    it("turns a band node's ring from its rim", () => {
        const values = [
            { x: 0, y: 6, ring: 0 },
            { x: 0, y: 6, ring: 0 },
        ];
        const { calls, handle } = recorder(SATURATOR, values);
        const center = nodeAt(SATURATOR, values[0], 0, SPLIT);
        const grabbed = handle(at(center.x + 13, center.y));
        expect(grabbed.cursor).toBe('ns-resize');
        expect(grabbed.id).toBe('ring:0');
        grabbed.drag?.(at(center.x + 13, center.y - 40));
        expect(calls.patches[0].index).toBe(0);
        expect(calls.patches[0].patch.ring).toBeGreaterThan(0);
        expect(calls.patches[0].patch.x).toBeUndefined();
    });
});

describe('node guides', () => {
    const node = { x: 50, y: 50, r: 10 };

    it('leaves out the part of a guide inside the node', () => {
        expect(outsideCircle([0, 50], [100, 50], node)).toEqual([
            [
                [0, 50],
                [40, 50],
            ],
            [
                [60, 50],
                [100, 50],
            ],
        ]);
    });

    it('starts a guide at the edge of the node it leaves from', () => {
        expect(outsideCircle([50, 50], [50, 100], node)).toEqual([
            [
                [50, 60],
                [50, 100],
            ],
        ]);
    });

    it('drops a guide that ends inside the node, so it never overshoots', () => {
        expect(outsideCircle([50, 50], [50, 44], node)).toEqual([]);
        expect(outsideCircle([0, 0], [100, 0], node)).toEqual([
            [
                [0, 0],
                [100, 0],
            ],
        ]);
    });
});

describe('control nodes', () => {
    /** A node at (100, 50) that records every move and reset, with both guides by default. */
    function control(extra: Partial<ControlNode<{ x?: number; y?: number }>> = {}) {
        const calls: string[] = [];
        const moves: { x?: number; y?: number }[] = [];
        const rings: number[] = [];
        const node: ControlNode<{ x?: number; y?: number }> = {
            x: 100,
            y: 50,
            atX: (x) => ({ x }),
            atY: (y) => ({ y }),
            apply: (patch) => moves.push(patch),
            ring: { spec: SPECS.kneeDb, value: 6, onChange: (value) => rings.push(value) },
            reset: {
                node: () => calls.push('node'),
                x: () => calls.push('x'),
                y: () => calls.push('y'),
            },
            across: { left: 0, right: 200 },
            down: { bottom: 150 },
            ...extra,
        };
        return { node, calls, moves, rings };
    }

    it('moves the node with the pointer from where it was grabbed', () => {
        const { node, moves } = control();
        const grabbed = nodeHandle(at(103, 48), node);
        expect(grabbed?.id).toBe('node');
        expect(grabbed?.cursor).toBe('move');
        grabbed?.drag?.(at(113, 28));
        expect(moves).toEqual([{ x: 110, y: 30 }]);
    });

    it('drags each guide for its own setting and resets only that one', () => {
        const { node, moves, calls } = control();
        const across = nodeHandle(at(20, 52), node);
        expect(across?.id).toBe('across');
        across?.drag?.(at(30, 42));
        across?.reset?.();
        const down = nodeHandle(at(103, 120), node);
        expect(down?.id).toBe('down');
        down?.drag?.(at(93, 140));
        down?.reset?.();
        nodeHandle(at(100, 50), node)?.reset?.();
        expect(moves).toEqual([{ y: 40 }, { x: 90 }]);
        expect(calls).toEqual(['y', 'x', 'node']);
    });

    it('runs the guide down from the node, or from the top when given', () => {
        expect(nodeHandle(at(100, 10), control().node)).toBeUndefined();
        const full = control({ down: { top: 0, bottom: 150 } }).node;
        expect(nodeHandle(at(100, 10), full)?.id).toBe('down');
        expect(nodeHandle(at(20, 80), full)).toBeUndefined();
    });

    it('leaves out guides the node does not have', () => {
        const { node } = control({ across: undefined });
        expect(nodeHandle(at(20, 52), node)).toBeUndefined();
    });

    it('turns the ring with the wheel on every part, and keys the ids', () => {
        const { node, rings } = control({ key: 3 });
        const ring = nodeHandle(at(114, 50), node);
        expect(ring?.id).toBe('ring:3');
        nodeHandle(at(100, 50), node)?.wheel?.(1, false);
        nodeHandle(at(20, 52), node)?.wheel?.(-1, false);
        expect(rings[0]).toBeGreaterThan(6);
        expect(rings[1]).toBeLessThan(6);
    });

    it("drags a band node's guides for one setting each", () => {
        const values = [
            { x: 0, y: 6, ring: 0 },
            { x: 6, y: 18, ring: 50 },
        ];
        const { calls, handle } = recorder(SATURATOR, values);
        const center = nodeAt(SATURATOR, values[1], SPLIT, WIDTH);
        const across = handle(at(WIDTH - 10, center.y + 2));
        expect(across.id).toBe('across:1');
        across.drag?.(at(WIDTH - 10, center.y + 2 - 20));
        expect(calls.patches[0].patch).toEqual({ y: expect.any(Number) });
        expect(calls.patches[0].patch.y).toBeGreaterThan(18);
        const down = handle(at(center.x + 2, HEIGHT - 40));
        expect(down.id).toBe('down:1');
        down.drag?.(at(center.x + 2 - 15, HEIGHT - 40));
        expect(calls.patches[1].patch).toEqual({ x: expect.any(Number) });
        expect(calls.patches[1].patch.x).toBeLessThan(6);
    });
});
