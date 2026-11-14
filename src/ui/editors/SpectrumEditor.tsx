import { useRef, useState, type PointerEvent } from 'react';
import { ANALYZER_CHANNELS, FFT_SIZES, SPECS, type AnalyzerChannel } from '../../shared/effects';
import { SPECTRUM_BINS, SPECTRUM_FREQUENCIES } from '../../shared/spectrum';
import { ControlGroup, Segmented, Toggle } from '../components/Controls';
import { Knob } from '../components/Knob';
import { formatFrequency } from '../format';
import { css, drawGrid, frequencyToX, withAlpha, xToFrequency } from '../graph';
import { useTelemetry } from '../telemetry';
import { useCanvas } from '../useCanvas';
import type { EditorProps } from './types';

export const CHANNEL_LABELS: Record<AnalyzerChannel, string> = {
    mono: 'Mono',
    left: 'L',
    right: 'R',
    mid: 'Mid',
    side: 'Side',
};

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PEAK_FALL_DB = 0.35;

export function noteName(frequency: number): string {
    const midi = 69 + 12 * Math.log2(frequency / 440);
    const nearest = Math.round(midi);
    const cents = Math.round((midi - nearest) * 100);
    const name = `${NOTES[((nearest % 12) + 12) % 12]}${Math.floor(nearest / 12) - 1}`;
    return cents === 0 ? name : `${name} ${cents > 0 ? '+' : ''}${cents}c`;
}

/** Applies the display tilt that makes typical program material read roughly flat. */
export function tilted(db: number, frequency: number, tilt: number) {
    return db + tilt * Math.log2(frequency / 1000);
}

/** Interpolated value of a log-spaced spectrum at an arbitrary frequency. */
function valueAt(spectrum: Float32Array, frequency: number): number {
    const position =
        (Math.log(frequency / SPECTRUM_FREQUENCIES[0]) /
            Math.log(SPECTRUM_FREQUENCIES[SPECTRUM_BINS - 1] / SPECTRUM_FREQUENCIES[0])) *
        (SPECTRUM_BINS - 1);
    const base = Math.max(0, Math.min(SPECTRUM_BINS - 2, Math.floor(position)));
    const fraction = Math.min(1, Math.max(0, position - base));
    return spectrum[base] * (1 - fraction) + spectrum[base + 1] * fraction;
}

export function SpectrumEditor({ effect, setParams, color }: EditorProps<'spectrum'>) {
    const p = effect.params;
    const [frozen, setFrozen] = useState(false);
    const [hover, setHover] = useState<{ x: number; y: number }>();
    const display = useRef(new Float32Array(SPECTRUM_BINS).fill(-140));
    const peaks = useRef(new Float32Array(SPECTRUM_BINS).fill(-140));

    useTelemetry((telemetry) => {
        const data = telemetry.meters.effects[effect.id];
        if (frozen || !data || data.length !== SPECTRUM_BINS) {
            return;
        }
        // Rise instantly, fall according to the smoothing setting.
        const keep = Math.min(0.97, (p.smoothing / 100) * 0.97);
        data.forEach((value, index) => {
            const previous = display.current[index];
            display.current[index] =
                value > previous ? value : previous * keep + value * (1 - keep);
            peaks.current[index] = Math.max(value, peaks.current[index] - PEAK_FALL_DB);
        });
    });

    const ref = useCanvas(
        ({ ctx, width, height }) => {
            const range = p.rangeDb;
            const toY = (db: number) => Math.min(height, Math.max(0, (-db / range) * height));
            drawGrid(ctx, width, height);
            ctx.save();
            ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
            for (let db = -12; db > -range; db -= 12) {
                const y = Math.round(toY(db)) + 0.5;
                ctx.strokeStyle = css('--grid');
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                ctx.stroke();
                ctx.fillStyle = css('--grid-label');
                ctx.fillText(`${db}`, width - 26, y - 3);
            }
            ctx.restore();

            const points = Array.from(display.current, (value, index) => {
                const frequency = SPECTRUM_FREQUENCIES[index];
                return [frequencyToX(frequency, width), toY(tilted(value, frequency, p.tilt))];
            });
            const gradient = ctx.createLinearGradient(0, 0, 0, height);
            gradient.addColorStop(0, withAlpha(color, 0.55));
            gradient.addColorStop(1, withAlpha(color, 0.04));
            ctx.beginPath();
            ctx.moveTo(0, height);
            points.forEach(([x, y]) => ctx.lineTo(x, y));
            ctx.lineTo(width, height);
            ctx.closePath();
            ctx.fillStyle = gradient;
            ctx.fill();
            ctx.beginPath();
            points.forEach(([x, y], index) => (index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.6;
            ctx.shadowColor = color;
            ctx.shadowBlur = 8;
            ctx.stroke();
            ctx.shadowBlur = 0;

            if (p.peakHold) {
                ctx.beginPath();
                peaks.current.forEach((value, index) => {
                    const frequency = SPECTRUM_FREQUENCIES[index];
                    const x = frequencyToX(frequency, width);
                    const y = toY(tilted(value, frequency, p.tilt));
                    if (index === 0) {
                        ctx.moveTo(x, y);
                    } else {
                        ctx.lineTo(x, y);
                    }
                });
                ctx.strokeStyle = withAlpha('#ffffff', 0.45);
                ctx.lineWidth = 1;
                ctx.stroke();
            }

            if (hover) {
                const frequency = xToFrequency(hover.x, width);
                const level = tilted(valueAt(display.current, frequency), frequency, p.tilt);
                ctx.strokeStyle = withAlpha('#ffffff', 0.35);
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.moveTo(Math.round(hover.x) + 0.5, 0);
                ctx.lineTo(Math.round(hover.x) + 0.5, height);
                ctx.stroke();
                ctx.setLineDash([]);
                const label = `${formatFrequency(frequency)} · ${noteName(frequency)} · ${level.toFixed(1)} dB`;
                ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
                const textWidth = ctx.measureText(label).width;
                const boxX = Math.min(width - textWidth - 16, hover.x + 10);
                ctx.fillStyle = 'rgb(10 12 16 / 85%)';
                ctx.fillRect(boxX, 8, textWidth + 12, 22);
                ctx.fillStyle = css('--text');
                ctx.fillText(label, boxX + 6, 23);
            }
        },
        [p, hover, color],
    );

    const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setHover({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    };

    return (
        <div className="editor analyzer-editor">
            <div className="display">
                <canvas
                    ref={ref}
                    className="display-canvas"
                    onPointerMove={onPointerMove}
                    onPointerLeave={() => setHover(undefined)}
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
                <ControlGroup title="Display">
                    <Knob
                        spec={SPECS.analyzerRange}
                        value={p.rangeDb}
                        onChange={(rangeDb) => setParams({ rangeDb })}
                        color={color}
                    />
                    <Knob
                        spec={SPECS.tilt}
                        value={p.tilt}
                        onChange={(tilt) => setParams({ tilt })}
                        color={color}
                    />
                    <Knob
                        spec={SPECS.smoothing}
                        value={p.smoothing}
                        onChange={(smoothing) => setParams({ smoothing })}
                        color={color}
                    />
                    <div className="stack">
                        <Toggle
                            active={p.peakHold}
                            onChange={(peakHold) => setParams({ peakHold })}
                            color={color}
                        >
                            Peaks
                        </Toggle>
                        <Toggle
                            active={frozen}
                            onChange={setFrozen}
                            color={color}
                            title="Hold the current spectrum"
                        >
                            Freeze
                        </Toggle>
                    </div>
                </ControlGroup>
            </div>
        </div>
    );
}
