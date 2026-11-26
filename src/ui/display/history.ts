import { css } from '../graph';

/**
 * Drawing of rolling histories of readings, such as loudness over the last minute: one reading
 * per telemetry frame in a ring buffer, the oldest at the left.
 */

/**
 * Strokes a ring buffer whose oldest reading is at `position` across `width`. Readings at or
 * below `floor` leave a gap, so silence draws nothing.
 */
export function strokeHistory(
    ctx: CanvasRenderingContext2D,
    values: Float32Array,
    position: number,
    width: number,
    toY: (value: number) => number,
    floor: number,
) {
    const step = width / (values.length - 1);
    ctx.beginPath();
    let drawing = false;
    for (let index = 0; index < values.length; index++) {
        const value = values[(position + index) % values.length];
        if (value <= floor) {
            drawing = false;
            continue;
        }
        if (drawing) {
            ctx.lineTo(index * step, toY(value));
        } else {
            ctx.moveTo(index * step, toY(value));
            drawing = true;
        }
    }
    ctx.stroke();
}

/** Horizontal grid lines every `step` from below `max` down to above `min`, labeled at the left. */
export function drawLevelGrid(
    ctx: CanvasRenderingContext2D,
    width: number,
    toY: (value: number) => number,
    { min, max, step }: { min: number; max: number; step: number },
) {
    ctx.save();
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    ctx.lineWidth = 1;
    for (let value = max - step; value > min; value -= step) {
        const y = Math.round(toY(value)) + 0.5;
        ctx.strokeStyle = css('--grid');
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        ctx.fillStyle = css('--grid-label');
        ctx.fillText(`${value}`, 4, y - 2);
    }
    ctx.restore();
}
