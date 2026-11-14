import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { SPECTROGRAM_BINS } from '../../dsp/kernels/analyzers';
import {
    ANALYZER_CHANNELS,
    FFT_SIZES,
    SPECS,
    SPECTROGRAM_PALETTES,
    type SpectrogramParams,
} from '../../shared/effects';
import { MAX_FREQUENCY, MIN_FREQUENCY, logFrequencies } from '../../shared/spectrum';
import { ControlGroup, Segmented, Toggle } from '../components/Controls';
import { Knob } from '../components/Knob';
import { formatFrequency } from '../format';
import { css, withAlpha } from '../graph';
import { useTelemetry } from '../telemetry';
import { useCanvas } from '../useCanvas';
import { CHANNEL_LABELS, noteName, tilted } from './SpectrumEditor';
import type { EditorProps } from './types';

const COLUMNS = 480;
const FREQUENCIES = logFrequencies(SPECTROGRAM_BINS);
const LABELS = [50, 100, 200, 500, 1000, 2000, 5000, 10000];

const PALETTE_STOPS: Record<SpectrogramParams['palette'], number[][]> = {
    magma: [
        [0, 0, 4],
        [28, 16, 68],
        [79, 18, 123],
        [129, 37, 129],
        [181, 54, 122],
        [229, 80, 100],
        [251, 135, 97],
        [254, 194, 135],
        [252, 253, 191],
    ],
    ice: [
        [0, 0, 0],
        [6, 18, 48],
        [16, 56, 112],
        [26, 110, 170],
        [70, 175, 215],
        [170, 230, 245],
        [255, 255, 255],
    ],
    mono: [
        [0, 0, 0],
        [255, 255, 255],
    ],
};

/** 256-entry RGB lookup table interpolated from the palette stops. */
export function buildPalette(name: SpectrogramParams['palette']): Uint8ClampedArray {
    const stops = PALETTE_STOPS[name];
    const table = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
        const position = (i / 255) * (stops.length - 1);
        const base = Math.min(stops.length - 2, Math.floor(position));
        const fraction = position - base;
        for (let c = 0; c < 3; c++) {
            table[i * 3 + c] = stops[base][c] * (1 - fraction) + stops[base + 1][c] * fraction;
        }
    }
    return table;
}

function frequencyToRow(frequency: number, height: number) {
    return (
        height -
        (Math.log(frequency / MIN_FREQUENCY) / Math.log(MAX_FREQUENCY / MIN_FREQUENCY)) * height
    );
}

export function SpectrogramEditor({ effect, setParams, color }: EditorProps<'spectrogram'>) {
    const p = effect.params;
    const [frozen, setFrozen] = useState(false);
    const [hoverY, setHoverY] = useState<number>();
    const palette = useMemo(() => buildPalette(p.palette), [p.palette]);
    const history = useRef({
        values: new Float32Array(COLUMNS * SPECTROGRAM_BINS).fill(-140),
        column: 0,
    });
    const image = useMemo(() => {
        const canvas = document.createElement('canvas');
        canvas.width = COLUMNS;
        canvas.height = SPECTROGRAM_BINS;
        const context = canvas.getContext('2d')!;
        return { canvas, context, pixels: context.createImageData(COLUMNS, SPECTROGRAM_BINS) };
    }, []);

    const paintColumn = (source: number, target: number) => {
        const { values } = history.current;
        const { pixels } = image;
        const span = Math.max(1, p.ceilingDb - p.floorDb);
        for (let bin = 0; bin < SPECTROGRAM_BINS; bin++) {
            const level = tilted(values[source * SPECTROGRAM_BINS + bin], FREQUENCIES[bin], p.tilt);
            const shade = Math.round(Math.min(1, Math.max(0, (level - p.floorDb) / span)) * 255);
            const offset = ((SPECTROGRAM_BINS - 1 - bin) * COLUMNS + target) * 4;
            pixels.data[offset] = palette[shade * 3];
            pixels.data[offset + 1] = palette[shade * 3 + 1];
            pixels.data[offset + 2] = palette[shade * 3 + 2];
            pixels.data[offset + 3] = 255;
        }
    };

    /** Repaints the whole image so the newest column is at the right edge. */
    const repaint = () => {
        const { column } = history.current;
        for (let x = 0; x < COLUMNS; x++) {
            paintColumn((column + x) % COLUMNS, x);
        }
        image.context.putImageData(image.pixels, 0, 0);
    };

    useEffect(repaint, [palette, p.floorDb, p.ceilingDb, p.tilt]);

    useTelemetry((telemetry) => {
        const data = telemetry.meters.effects[effect.id];
        if (frozen || !data || data.length !== SPECTROGRAM_BINS) {
            return;
        }
        const h = history.current;
        h.values.set(data, h.column * SPECTROGRAM_BINS);
        h.column = (h.column + 1) % COLUMNS;
        // Scroll the existing pixels left by one column and paint the newest at the edge.
        const { pixels } = image;
        for (let row = 0; row < SPECTROGRAM_BINS; row++) {
            const start = row * COLUMNS * 4;
            pixels.data.copyWithin(start, start + 4, start + COLUMNS * 4);
        }
        paintColumn((h.column + COLUMNS - 1) % COLUMNS, COLUMNS - 1);
        image.context.putImageData(pixels, 0, 0);
    });

    const ref = useCanvas(
        ({ ctx, width, height }) => {
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(image.canvas, 0, 0, width, height);
            ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
            LABELS.forEach((frequency) => {
                const y = Math.round(frequencyToRow(frequency, height)) + 0.5;
                ctx.strokeStyle = 'rgb(255 255 255 / 12%)';
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(18, y);
                ctx.stroke();
                ctx.fillStyle = 'rgb(255 255 255 / 70%)';
                ctx.fillText(
                    frequency >= 1000 ? `${frequency / 1000}k` : `${frequency}`,
                    22,
                    y + 3,
                );
            });
            ctx.fillStyle = css('--grid-label');
            ctx.fillText('now', width - 26, height - 6);
            if (hoverY !== undefined) {
                const frequency =
                    MIN_FREQUENCY * Math.pow(MAX_FREQUENCY / MIN_FREQUENCY, 1 - hoverY / height);
                ctx.strokeStyle = withAlpha('#ffffff', 0.4);
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.moveTo(0, Math.round(hoverY) + 0.5);
                ctx.lineTo(width, Math.round(hoverY) + 0.5);
                ctx.stroke();
                ctx.setLineDash([]);
                const label = `${formatFrequency(frequency)} · ${noteName(frequency)}`;
                ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
                const textWidth = ctx.measureText(label).width;
                const y = Math.min(height - 26, Math.max(4, hoverY - 26));
                ctx.fillStyle = 'rgb(10 12 16 / 85%)';
                ctx.fillRect(width - textWidth - 22, y, textWidth + 12, 20);
                ctx.fillStyle = css('--text');
                ctx.fillText(label, width - textWidth - 16, y + 14);
            }
        },
        [hoverY, palette, p],
    );

    return (
        <div className="editor analyzer-editor">
            <div className="display">
                <canvas
                    ref={ref}
                    className="display-canvas spectrogram-canvas"
                    onPointerMove={(event: PointerEvent<HTMLCanvasElement>) =>
                        setHoverY(event.clientY - event.currentTarget.getBoundingClientRect().top)
                    }
                    onPointerLeave={() => setHoverY(undefined)}
                />
                {frozen && <div className="display-badge">Frozen</div>}
            </div>
            <div className="control-row">
                <ControlGroup title="Source">
                    <div className="stack">
                        <Segmented
                            label="Channel"
                            value={p.channel}
                            options={ANALYZER_CHANNELS.map((value) => ({
                                value,
                                label: CHANNEL_LABELS[value],
                            }))}
                            onChange={(channel) => setParams({ channel })}
                            color={color}
                        />
                        <Segmented
                            label="Resolution"
                            value={p.fftSize}
                            options={FFT_SIZES.map((value) => ({
                                value,
                                label: `${value / 1024}k`,
                            }))}
                            onChange={(fftSize) => setParams({ fftSize })}
                            color={color}
                        />
                    </div>
                </ControlGroup>
                <ControlGroup title="Levels">
                    <Knob
                        spec={SPECS.floorDb}
                        value={p.floorDb}
                        onChange={(floorDb) =>
                            setParams({ floorDb: Math.min(floorDb, p.ceilingDb - 12) })
                        }
                        color={color}
                    />
                    <Knob
                        spec={SPECS.spectrogramCeilingDb}
                        value={p.ceilingDb}
                        onChange={(ceilingDb) =>
                            setParams({ ceilingDb: Math.max(ceilingDb, p.floorDb + 12) })
                        }
                        color={color}
                    />
                    <Knob
                        spec={SPECS.tilt}
                        value={p.tilt}
                        defaultValue={3}
                        onChange={(tilt) => setParams({ tilt })}
                        color={color}
                    />
                </ControlGroup>
                <ControlGroup title="Colors">
                    <div className="stack">
                        <Segmented
                            value={p.palette}
                            options={SPECTROGRAM_PALETTES.map((value) => ({
                                value,
                                label: value[0].toUpperCase() + value.slice(1),
                            }))}
                            onChange={(palette) => setParams({ palette })}
                            color={color}
                        />
                        <Toggle active={frozen} onChange={setFrozen} color={color}>
                            Freeze
                        </Toggle>
                    </div>
                </ControlGroup>
            </div>
        </div>
    );
}
