import { describe, expect, it } from 'vitest';
import { SPECS, type NumberSpec } from '../src/shared/effects';
import { specValue, wheelStep, type CanvasPoint } from '../src/ui/canvasDrag';
import { bandHandle, type BandNode, type NodeValue } from '../src/ui/editors/bandDisplay';
import { toNormalized } from '../src/ui/format';
import { frequencyToX, ringTurn } from '../src/ui/graph';

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
