import { useMemo, useRef, type PointerEvent, type WheelEvent } from 'react';
import { cascadeMagnitude, type BiquadCoefficients } from '../../dsp/biquad';
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

export interface GraphNode {
    frequency: number;
    db: number;
    onDrag: (frequency: number, db: number) => void;
    onWheel?: (direction: 1 | -1) => void;
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
    const size = useRef({ width: 1, height: 1 });
    const dragging = useRef(false);
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
            size.current = { width, height };
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
                ctx.beginPath();
                ctx.arc(x, y, 8, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#ffffff';
                ctx.stroke();
            }
        },
        [range, color, ...deps],
    );

    const move = (event: PointerEvent<HTMLCanvasElement>) => {
        if (!node) {
            return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        const { width, height } = size.current;
        const frequency = Math.min(
            20000,
            Math.max(20, xToFrequency(event.clientX - rect.left, width)),
        );
        const db = Math.min(
            range,
            Math.max(-range, yToDb(event.clientY - rect.top, height, range)),
        );
        node.onDrag(frequency, db);
    };

    return (
        <canvas
            ref={ref}
            className={`display-canvas ${node ? 'interactive' : ''}`}
            title={title}
            onPointerDown={(event) => {
                if (!node) {
                    return;
                }
                dragging.current = true;
                event.currentTarget.setPointerCapture(event.pointerId);
                move(event);
            }}
            onPointerMove={(event) => dragging.current && move(event)}
            onPointerUp={() => (dragging.current = false)}
            onPointerCancel={() => (dragging.current = false)}
            onWheel={(event: WheelEvent<HTMLCanvasElement>) =>
                node?.onWheel?.(event.deltaY < 0 ? 1 : -1)
            }
        />
    );
}
