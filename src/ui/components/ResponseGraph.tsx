import { useMemo } from 'react';
import { cascadeMagnitude, type BiquadCoefficients } from '../../dsp/biquad';
import {
    drawControlNode,
    nodeHandle,
    ringWheel,
    type ControlNode,
    type NodeLayout,
} from '../display/node';
import { useCanvasDrag } from '../display/pointer';
import {
    css,
    dbToY,
    drawGrid,
    drawSpectrum,
    frequencyToX,
    pixelFrequencies,
    strokeCurve,
    withAlpha,
    xToFrequency,
    yToDb,
} from '../graph';
import { useTelemetryStore } from '../telemetry';
import { useCanvas, type CanvasFrame } from '../useCanvas';

/**
 * A node on the response graph. Dragging sets its frequency and level; its `ring` controls a
 * third setting, shown around it.
 */
export interface GraphNode {
    frequency: number;
    db: number;
    onDrag: (frequency: number, db: number) => void;
    ring: NodeLayout['ring'];
    /**
     * Dotted guides from the handle to the axes whose reading is the setting: the frequency
     * scale below, the level scale at the side.
     */
    guides?: { frequency?: boolean; level?: boolean };
    /** Double-click on the display: restores all three settings. */
    onReset: () => void;
}

/**
 * The control node of a {@link GraphNode} on a graph of the given size and level range. Its
 * guides, when shown, run from top to bottom and across the whole graph; each resets all three
 * settings like the node.
 */
function controlNode(
    node: GraphNode,
    width: number,
    height: number,
    range: number,
): ControlNode<{ frequency?: number; db?: number }> {
    return {
        x: frequencyToX(node.frequency, width),
        y: dbToY(node.db, height, range),
        atX: (x) => ({ frequency: Math.min(20000, Math.max(20, xToFrequency(x, width))) }),
        atY: (y) => ({ db: Math.min(range, Math.max(-range, yToDb(y, height, range))) }),
        apply: ({ frequency = node.frequency, db = node.db }) => node.onDrag(frequency, db),
        ring: node.ring,
        reset: { node: node.onReset, x: node.onReset, y: node.onReset },
        across: node.guides?.level ? { left: 0, right: width } : undefined,
        down: node.guides?.frequency ? { top: 0, bottom: height } : undefined,
    };
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

    const { handlers: pointer, hot } = useCanvasDrag((point) => {
        if (!node) {
            return undefined;
        }
        const control = controlNode(node, point.width, point.height, range);
        // Away from the node and its guides, a press moves the node to the pointer.
        return (
            nodeHandle(point, control) ?? {
                cursor: '',
                drag: (to) => control.apply({ ...control.atX(to.x), ...control.atY(to.y) }),
                reset: node.onReset,
                wheel: ringWheel(control),
            }
        );
    });

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
                drawControlNode(ctx, controlNode(node, width, height, range), color, hot);
            }
        },
        [range, color, hot, ...deps],
    );

    return (
        <canvas
            ref={ref}
            className={`display-canvas ${node ? 'interactive' : ''}`}
            title={title}
            {...pointer}
        />
    );
}
