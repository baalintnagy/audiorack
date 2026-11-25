import type { NumberSpec } from '../shared/effects';
import { MAX_FREQUENCY, MIN_FREQUENCY, SPECTRUM_FREQUENCIES } from '../shared/spectrum';
import { toNormalized } from './format';

const LOG_RANGE = Math.log(MAX_FREQUENCY / MIN_FREQUENCY);

export function frequencyToX(frequency: number, width: number): number {
    return (Math.log(frequency / MIN_FREQUENCY) / LOG_RANGE) * width;
}

export function xToFrequency(x: number, width: number): number {
    return MIN_FREQUENCY * Math.exp((x / width) * LOG_RANGE);
}

export function dbToY(db: number, height: number, range: number): number {
    return height / 2 - (db / range) * (height / 2);
}

export function yToDb(y: number, height: number, range: number): number {
    return ((height / 2 - y) / (height / 2)) * range;
}

export function pixelFrequencies(width: number, step = 2): Float32Array {
    const count = Math.max(2, Math.ceil(width / step) + 1);
    return Float32Array.from({ length: count }, (_, index) =>
        xToFrequency((index / (count - 1)) * width, width),
    );
}

const GRID_FREQUENCIES = [30, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

function frequencyLabel(frequency: number) {
    return frequency >= 1000 ? `${frequency / 1000}k` : `${frequency}`;
}

export function css(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

export function drawGrid(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    options: { dbRange?: number; dbStep?: number; labels?: boolean } = {},
) {
    const { dbRange, dbStep = 6, labels = true } = options;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = css('--grid');
    ctx.fillStyle = css('--grid-label');
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    GRID_FREQUENCIES.forEach((frequency) => {
        const x = Math.round(frequencyToX(frequency, width)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        if (labels) {
            ctx.fillText(frequencyLabel(frequency), x + 3, height - 4);
        }
    });
    if (dbRange) {
        for (let db = -dbRange + dbStep; db < dbRange; db += dbStep) {
            const y = Math.round(dbToY(db, height, dbRange)) + 0.5;
            ctx.strokeStyle = db === 0 ? css('--grid-strong') : css('--grid');
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
            if (labels) {
                ctx.fillText(`${db > 0 ? '+' : ''}${db}`, width - 22, y - 3);
            }
        }
    }
    ctx.restore();
}

const SPECTRUM_FLOOR = -96;
const SPECTRUM_CEILING = -6;

/** Draws a log-spaced spectrum (from telemetry) as a filled area. */
export function drawSpectrum(
    ctx: CanvasRenderingContext2D,
    spectrum: number[] | undefined,
    width: number,
    height: number,
    fill: string,
    stroke?: string,
) {
    if (!spectrum || spectrum.length === 0) {
        return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, height);
    spectrum.forEach((value, index) => {
        const x = frequencyToX(SPECTRUM_FREQUENCIES[index], width);
        // Tilt by +4.5 dB/octave so music reads roughly flat, as analyzers commonly do.
        const tilted = value + 4.5 * Math.log2(SPECTRUM_FREQUENCIES[index] / 1000);
        const level = (tilted - SPECTRUM_FLOOR) / (SPECTRUM_CEILING - SPECTRUM_FLOOR);
        const y = height - Math.min(1, Math.max(0, level)) * height;
        ctx.lineTo(x, y);
    });
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
    }
    ctx.restore();
}

export function strokeCurve(
    ctx: CanvasRenderingContext2D,
    frequencies: Float32Array,
    values: Float32Array,
    width: number,
    toY: (value: number) => number,
    style: { stroke: string; lineWidth?: number; fill?: string; baseline?: number; glow?: boolean },
) {
    ctx.save();
    ctx.beginPath();
    frequencies.forEach((frequency, index) => {
        const x = frequencyToX(frequency, width);
        const y = toY(values[index]);
        if (index === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });
    if (style.fill !== undefined && style.baseline !== undefined) {
        ctx.save();
        ctx.lineTo(width, style.baseline);
        ctx.lineTo(0, style.baseline);
        ctx.closePath();
        ctx.fillStyle = style.fill;
        ctx.fill();
        ctx.restore();
        ctx.beginPath();
        frequencies.forEach((frequency, index) => {
            const x = frequencyToX(frequency, width);
            const y = toY(values[index]);
            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
    }
    if (style.glow) {
        ctx.shadowColor = style.stroke;
        ctx.shadowBlur = 8;
    }
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.lineWidth ?? 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
}

export function withAlpha(hex: string, alpha: number): string {
    const value = hex.replace('#', '');
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgb(${r} ${g} ${b} / ${Math.round(alpha * 100)}%)`;
}

/** A small round grip marking something on a display that can be dragged. */
export function drawGrip(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
}

export const NODE_RADIUS = 6;
export const RING_RADIUS = 14;

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
 * share of a full circle from the top: positive clockwise, negative counterclockwise. `hot`
 * highlights it while the pointer is over it.
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

/**
 * A dotted line from a node to where its setting reads off the display, such as the level a
 * threshold sits at or the frequency a handle is set to.
 */
export function drawGuide(
    ctx: CanvasRenderingContext2D,
    from: [number, number],
    to: [number, number],
    color: string,
    alpha = 0.7,
) {
    ctx.save();
    ctx.setLineDash([1, 3]);
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = withAlpha(color, alpha);
    ctx.beginPath();
    ctx.moveTo(from[0], from[1]);
    ctx.lineTo(to[0], to[1]);
    ctx.stroke();
    ctx.restore();
}
