import { useEffect, useRef, type DependencyList } from 'react';
import { useTelemetryStore } from './telemetry';
import type { Telemetry } from '../shared/messages';

export interface CanvasFrame {
    ctx: CanvasRenderingContext2D;
    width: number;
    height: number;
    telemetry: Telemetry | undefined;
    /** True when the frame was triggered by new engine readings. */
    live: boolean;
    /** Number of telemetry frames received since the previous draw. */
    ticks: number;
}

/**
 * Keeps a HiDPI canvas sized to its element and redraws it when dependencies change,
 * when telemetry arrives, or when it is resized. Redraws are coalesced per animation frame.
 */
export function useCanvas(draw: (frame: CanvasFrame) => void, deps: DependencyList) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawRef = useRef(draw);
    drawRef.current = draw;
    const store = useTelemetryStore();
    const schedule = useRef<(live: boolean) => void>(() => {});

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        let frame = 0;
        let pendingTicks = 0;
        const render = () => {
            frame = 0;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return;
            }
            const ratio = window.devicePixelRatio || 1;
            const width = canvas.clientWidth;
            const height = canvas.clientHeight;
            if (canvas.width !== Math.round(width * ratio)) {
                canvas.width = Math.round(width * ratio);
            }
            if (canvas.height !== Math.round(height * ratio)) {
                canvas.height = Math.round(height * ratio);
            }
            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            ctx.clearRect(0, 0, width, height);
            const ticks = pendingTicks;
            pendingTicks = 0;
            drawRef.current({
                ctx,
                width,
                height,
                telemetry: store.latest,
                live: ticks > 0,
                ticks,
            });
        };
        schedule.current = (live: boolean) => {
            if (live) {
                pendingTicks++;
            }
            if (!frame) {
                frame = requestAnimationFrame(render);
            }
        };
        const observer = new ResizeObserver(() => schedule.current(false));
        observer.observe(canvas);
        const unsubscribe = store.subscribe(() => schedule.current(true));
        schedule.current(false);
        return () => {
            observer.disconnect();
            unsubscribe();
            cancelAnimationFrame(frame);
        };
    }, [store]);

    useEffect(() => {
        schedule.current(false);
    }, deps);

    return canvasRef;
}
