import { MAX_FREQUENCY, MIN_FREQUENCY, SPECTRUM_FREQUENCIES } from '../shared/spectrum';

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

/**
 * The spectrum levels at the bottom and the top of a display, in dBFS, where a full-scale sine
 * reads 0 dB as on the Spectrum analyzer.
 */
const SPECTRUM_FLOOR = -82;
const SPECTRUM_CEILING = 8;

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
