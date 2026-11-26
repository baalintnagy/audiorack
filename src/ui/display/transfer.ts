import { css } from '../graph';

/**
 * The scale of a square transfer curve (output level against input level, as on the compressor
 * and the gate): both axes run from `min` dB at the bottom left to 0 dB at the top right.
 */
export function transferScale(min: number, width: number, height: number) {
    return {
        toX: (db: number) => ((db - min) / -min) * width,
        toY: (db: number) => height - ((db - min) / -min) * height,
        xToDb: (x: number) => min + (x / width) * -min,
        yToDb: (y: number) => (y / height) * min,
        /** Level change for one pixel of vertical pointer movement. */
        dbPerPixel: -min / height,
    };
}

type TransferScale = ReturnType<typeof transferScale>;

/**
 * The grid of a transfer curve: lines every `step` dB from `first` up to 0 dB, labeled along
 * the bottom, and the dashed diagonal of unity gain.
 */
export function drawTransferGrid(
    ctx: CanvasRenderingContext2D,
    scale: TransferScale,
    width: number,
    height: number,
    first: number,
    step: number,
) {
    ctx.save();
    ctx.strokeStyle = css('--grid');
    ctx.fillStyle = css('--grid-label');
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    ctx.lineWidth = 1;
    for (let db = first; db < 0; db += step) {
        const x = Math.round(scale.toX(db)) + 0.5;
        const y = Math.round(scale.toY(db)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        ctx.fillText(`${db}`, scale.toX(db) + 2, height - 4);
    }
    ctx.strokeStyle = css('--grid-strong');
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(0, height);
    ctx.lineTo(width, 0);
    ctx.stroke();
    ctx.restore();
}
