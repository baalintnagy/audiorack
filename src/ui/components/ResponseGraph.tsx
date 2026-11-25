import { useMemo } from 'react';
import { cascadeMagnitude, type BiquadCoefficients } from '../../dsp/biquad';
import type { NumberSpec } from '../../shared/effects';
import {
    css,
    RING_RADIUS,
    dbToY,
    drawGrid,
    drawGuide,
    drawNode,
    drawSpectrum,
    frequencyToX,
    pixelFrequencies,
    ringTurn,
    strokeCurve,
    withAlpha,
    xToFrequency,
    yToDb,
} from '../graph';
import { useCanvasDrag, wheelStep } from '../canvasDrag';
import { useTelemetryStore } from '../telemetry';
import { useCanvas, type CanvasFrame } from '../useCanvas';

/**
 * A handle on the response graph. Dragging sets its frequency and level; with a `ring` it
 * controls a third setting too, turned with the mouse wheel and shown around the handle.
 */
export interface GraphNode {
    frequency: number;
    db: number;
    onDrag: (frequency: number, db: number) => void;
    ring?: { spec: NumberSpec; value: number; onChange: (value: number) => void };
    /**
     * Dotted guides from the handle to the axes whose reading is the setting: the frequency
     * scale below, the level scale at the side.
     */
    guides?: { frequency?: boolean; level?: boolean };
    /** Double-click on the display. */
    onReset?: () => void;
}

/** Frequency-response display over the live output spectrum, with an optional handle. */
export function ResponseGraph({
    sections,
    color,
    range = 24,
    node,
    overlay,
    deps,
    title,
}: {
    sections: (sampleRate: number) => BiquadCoefficients[];
    color: string;
    range?: number;
    node?: GraphNode;
    overlay?: (frame: CanvasFrame) => void;
    deps: unknown[];
    title?: string;
}) {
    const store = useTelemetryStore();
    const frequenciesFor = useMemo(() => {
        let cache: { width: number; values: Float32Array } | undefined;
        return (width: number) => {
            if (!cache || cache.width !== width) {
                cache = { width, values: pixelFrequencies(width) };
            }
            return cache.values;
        };
    }, []);

    const ref = useCanvas(
        (frame) => {
            const { ctx, width, height, telemetry } = frame;
            const sampleRate = telemetry?.sampleRate ?? store.sampleRate;
            const toY = (db: number) => dbToY(db, height, range);
            drawGrid(ctx, width, height, { dbRange: range, dbStep: range / 4 });
            drawSpectrum(
                ctx,
                telemetry?.post,
                width,
                height,
                css('--spectrum-post'),
                css('--spectrum-post-line'),
            );
            const frequencies = frequenciesFor(width);
            const coefficients = sections(sampleRate);
            const response = Float32Array.from(frequencies, (frequency) =>
                Math.max(
                    -range * 2,
                    20 *
                        Math.log10(
                            Math.max(cascadeMagnitude(coefficients, frequency, sampleRate), 1e-6),
                        ),
                ),
            );
            strokeCurve(ctx, frequencies, response, width, toY, {
                stroke: color,
                lineWidth: 2.5,
                fill: withAlpha(color, 0.14),
                baseline: toY(0),
                glow: true,
            });
            overlay?.(frame);
            if (node) {
                const x = frequencyToX(node.frequency, width);
                const y = toY(node.db);
                const gap = RING_RADIUS + 2;
                if (node.guides?.frequency) {
                    drawGuide(ctx, [x, 0], [x, y - gap], color);
                    drawGuide(ctx, [x, y + gap], [x, height], color);
                }
                if (node.guides?.level) {
                    drawGuide(ctx, [0, y], [x - gap, y], color);
                    drawGuide(ctx, [x + gap, y], [width, y], color);
                }
                const turn = node.ring ? ringTurn(node.ring.spec, node.ring.value) : 0;
                drawNode(ctx, x, y, color, turn);
            }
        },
        [range, color, ...deps],
    );

    const pointer = useCanvasDrag(({ x, y, width, height }) => {
        if (!node) {
            return undefined;
        }
        const nearNode =
            Math.hypot(x - frequencyToX(node.frequency, width), y - dbToY(node.db, height, range)) <
            12;
        return {
            cursor: nearNode ? 'move' : '',
            // A press anywhere moves the handle there.
            drag: (to) =>
                node.onDrag(
                    Math.min(20000, Math.max(20, xToFrequency(to.x, width))),
                    Math.min(range, Math.max(-range, yToDb(to.y, height, range))),
                ),
            reset: node.onReset,
            wheel:
                node.ring &&
                ((direction, fine) => {
                    const ring = node.ring;
                    ring?.onChange(wheelStep(ring.spec, ring.value, direction, fine));
                }),
        };
    });

    return (
        <canvas
            ref={ref}
            className={`display-canvas ${node ? 'interactive' : ''}`}
            title={title}
            {...pointer}
        />
    );
}
