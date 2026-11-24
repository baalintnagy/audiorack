import { useMemo, useRef } from 'react';
import {
    STEREO_BANDS,
    STEREO_BAND_FIELDS,
    STEREO_FIELDS,
    STEREO_POINTS,
} from '../../dsp/kernels/analyzers';
import { SPECS } from '../../shared/effects';
import { MAX_FREQUENCY, MIN_FREQUENCY, logFrequencies } from '../../shared/spectrum';
import { ControlGroup, Segmented, Toggle } from '../components/Controls';
import { Knob } from '../components/Knob';
import { css, withAlpha } from '../graph';
import { useTelemetry } from '../telemetry';
import { useCanvas } from '../useCanvas';
import type { EditorProps } from './types';

interface Readings {
    correlation: number;
    balance: number;
    width: number;
}

const BAND_FREQUENCIES = logFrequencies(STEREO_BANDS);
const BAND_LABELS = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
const BAND_FLOOR_DB = -90;
const BAND_CEILING_DB = -20;

interface Band {
    level: number;
    position: number;
    width: number;
    correlation: number;
}

/** Green for in-phase content, through yellow, to red for content that cancels in mono. */
function correlationColor(correlation: number): string {
    return correlation < 0
        ? css('--meter-clip')
        : correlation < 0.3
          ? css('--meter-high')
          : css('--meter-low');
}

function frequencyLabel(frequency: number): string {
    return frequency >= 1000 ? `${frequency / 1000}k` : `${frequency}`;
}

/**
 * The stereo image per frequency band, low at the bottom: each band is a bar centered where it
 * sits between left and right, as wide as its side content, colored by its correlation and
 * brighter the louder it is.
 */
function FrequencyImage({ id }: { id: string }) {
    const bands = useRef<Band[]>(
        Array.from({ length: STEREO_BANDS }, () => ({
            level: -140,
            position: 0,
            width: 0,
            correlation: 1,
        })),
    );
    useTelemetry((telemetry) => {
        const data = telemetry.meters.effects[id];
        if (!data || data.length < STEREO_FIELDS.bands + STEREO_BANDS * STEREO_BAND_FIELDS.size) {
            return;
        }
        bands.current.forEach((band, index) => {
            const start = STEREO_FIELDS.bands + index * STEREO_BAND_FIELDS.size;
            const level = data[start + STEREO_BAND_FIELDS.level];
            // Fast rise, slower fall, like a meter.
            band.level = level > band.level ? level : band.level + (level - band.level) * 0.25;
            band.position += (data[start + STEREO_BAND_FIELDS.position] - band.position) * 0.3;
            band.width += (data[start + STEREO_BAND_FIELDS.width] - band.width) * 0.3;
            band.correlation +=
                (data[start + STEREO_BAND_FIELDS.correlation] - band.correlation) * 0.3;
        });
    });
    const ref = useCanvas(({ ctx, width, height }) => {
        const left = 34;
        const plotWidth = width - left - 10;
        const center = left + plotWidth / 2;
        const half = plotWidth / 2;
        const top = 8;
        const plotHeight = height - top - 22;
        const logRange = Math.log(MAX_FREQUENCY / MIN_FREQUENCY);
        const toY = (frequency: number) =>
            top + plotHeight - (Math.log(frequency / MIN_FREQUENCY) / logRange) * plotHeight;
        ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
        ctx.fillStyle = css('--grid-label');
        ctx.strokeStyle = css('--grid');
        ctx.lineWidth = 1;
        BAND_LABELS.forEach((frequency) => {
            const y = Math.round(toY(frequency)) + 0.5;
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(left + plotWidth, y);
            ctx.stroke();
            ctx.textAlign = 'right';
            ctx.fillText(frequencyLabel(frequency), left - 6, y + 3);
        });
        [-0.5, 0.5].forEach((fraction) => {
            const x = Math.round(center + fraction * half) + 0.5;
            ctx.beginPath();
            ctx.moveTo(x, top);
            ctx.lineTo(x, top + plotHeight);
            ctx.stroke();
        });
        ctx.strokeStyle = css('--grid-strong');
        ctx.beginPath();
        ctx.moveTo(Math.round(center) + 0.5, top);
        ctx.lineTo(Math.round(center) + 0.5, top + plotHeight);
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.fillText('L', left + 6, height - 6);
        ctx.fillText('C', center, height - 6);
        ctx.fillText('R', left + plotWidth - 6, height - 6);
        ctx.textAlign = 'start';
        const bandHeight = Math.max(2, plotHeight / STEREO_BANDS - 1);
        bands.current.forEach((band, index) => {
            const loudness = (band.level - BAND_FLOOR_DB) / (BAND_CEILING_DB - BAND_FLOOR_DB);
            if (loudness <= 0) {
                return;
            }
            const spread = 0.03 + Math.min(1, band.width) * 0.97;
            const from = Math.max(-1, band.position - spread);
            const to = Math.min(1, band.position + spread);
            ctx.globalAlpha = 0.2 + Math.min(1, loudness) * 0.8;
            ctx.fillStyle = correlationColor(band.correlation);
            ctx.fillRect(
                center + from * half,
                toY(BAND_FREQUENCIES[index]) - bandHeight / 2,
                Math.max(2, (to - from) * half),
                bandHeight,
            );
        });
        ctx.globalAlpha = 1;
    }, []);
    return <canvas ref={ref} className="stereo-bands" />;
}

/** Horizontal bipolar meter used for correlation and balance. */
function drawBar(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    value: number,
    labels: [string, string, string],
    tint: (value: number) => string,
) {
    const height = 10;
    ctx.fillStyle = css('--meter-bg');
    ctx.fillRect(x, y, width, height);
    const center = x + width / 2;
    const position = center + (Math.max(-1, Math.min(1, value)) * width) / 2;
    ctx.fillStyle = tint(value);
    ctx.fillRect(Math.min(center, position), y, Math.abs(position - center), height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(position - 1, y - 2, 2, height + 4);
    ctx.fillStyle = css('--grid-strong');
    ctx.fillRect(center, y, 1, height);
    ctx.fillStyle = css('--grid-label');
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(labels[0], x, y + height + 12);
    ctx.textAlign = 'center';
    ctx.fillText(labels[1], center, y + height + 12);
    ctx.textAlign = 'right';
    ctx.fillText(labels[2], x + width, y + height + 12);
    ctx.textAlign = 'start';
}

export function StereoEditor({ effect, setParams, color }: EditorProps<'stereo'>) {
    const p = effect.params;
    const readings = useRef<Readings>({ correlation: 0, balance: 0, width: 0 });
    const gain = useRef(1);
    const size = useRef({ width: 0, height: 0 });
    const trail = useMemo(() => document.createElement('canvas'), []);

    useTelemetry((telemetry) => {
        const data = telemetry.meters.effects[effect.id];
        if (!data || data.length <= STEREO_FIELDS.points) {
            return;
        }
        const r = readings.current;
        r.correlation += (data[STEREO_FIELDS.correlation] - r.correlation) * 0.3;
        r.balance += (data[STEREO_FIELDS.balance] - r.balance) * 0.3;
        r.width += (data[STEREO_FIELDS.width] - r.width) * 0.3;
        const peak = data[STEREO_FIELDS.peak];
        const target = p.autoGain ? Math.min(30, 0.85 / Math.max(peak, 0.03)) : 1;
        gain.current += (target - gain.current) * (target < gain.current ? 0.5 : 0.05);

        const { width, height } = size.current;
        if (width === 0 || height === 0) {
            return;
        }
        if (trail.width !== width || trail.height !== height) {
            trail.width = width;
            trail.height = height;
        }
        const ctx = trail.getContext('2d')!;
        // Fade older traces according to the persistence setting.
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = `rgb(0 0 0 / ${Math.round((1 - (p.persistence / 100) * 0.92) * 100)}%)`;
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'lighter';
        const cx = width / 2;
        const cy = height / 2;
        const radius = Math.min(width, height) / 2 - 8;
        const scale = (radius * gain.current) / Math.SQRT2;
        const point = (index: number) => {
            const l = data[STEREO_FIELDS.points + index * 2];
            const rr = data[STEREO_FIELDS.points + index * 2 + 1];
            return [cx + (rr - l) * scale, cy - (l + rr) * scale];
        };
        const count = STEREO_POINTS;
        if (p.display === 'lines') {
            ctx.strokeStyle = withAlpha(color, 0.6);
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let i = 0; i < count; i++) {
                const [x, y] = point(i);
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.stroke();
        } else {
            ctx.fillStyle = withAlpha(color, 0.55);
            for (let i = 0; i < count; i++) {
                const [x, y] = point(i);
                ctx.fillRect(x - 1, y - 1, 2, 2);
            }
        }
        ctx.globalCompositeOperation = 'source-over';
    });

    const scope = useCanvas(
        ({ ctx, width, height }) => {
            size.current = { width, height };
            const cx = width / 2;
            const cy = height / 2;
            const radius = Math.min(width, height) / 2 - 8;
            ctx.strokeStyle = css('--grid');
            ctx.lineWidth = 1;
            [0.5, 1].forEach((fraction) => {
                ctx.beginPath();
                ctx.arc(cx, cy, radius * fraction, 0, Math.PI * 2);
                ctx.stroke();
            });
            const axes: [number, string][] = [
                [-Math.PI / 4, 'R'],
                [(-3 * Math.PI) / 4, 'L'],
                [-Math.PI / 2, 'M'],
                [0, '+S'],
                [Math.PI, '-S'],
            ];
            ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
            axes.forEach(([angle, label]) => {
                ctx.strokeStyle = label === 'M' ? css('--grid-strong') : css('--grid');
                ctx.beginPath();
                ctx.moveTo(cx - Math.cos(angle) * radius, cy - Math.sin(angle) * radius);
                ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
                ctx.stroke();
                ctx.fillStyle = css('--grid-label');
                ctx.textAlign = 'center';
                ctx.fillText(
                    label,
                    cx + Math.cos(angle) * (radius - 10),
                    cy + Math.sin(angle) * (radius - 10) + 4,
                );
            });
            ctx.textAlign = 'start';
            if (trail.width === width && trail.height === height) {
                ctx.drawImage(trail, 0, 0);
            }
            ctx.fillStyle = css('--grid-label');
            ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
            const zoom = 20 * Math.log10(gain.current);
            ctx.fillText(`zoom ${zoom >= 0 ? '+' : ''}${zoom.toFixed(1)} dB`, 8, height - 8);
        },
        [color, p],
    );

    const meters = useCanvas(
        ({ ctx, width }) => {
            const r = readings.current;
            const padding = 14;
            const gap = 24;
            const column = (width - padding * 2 - gap * 2) / 3;
            const heading = (x: number, title: string, value: string, warn = false) => {
                ctx.fillStyle = warn ? css('--meter-clip') : css('--text');
                ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
                ctx.fillText(title, x, 20);
                ctx.textAlign = 'right';
                ctx.fillText(value, x + column, 20);
                ctx.textAlign = 'start';
            };
            const phaseIssue = r.correlation < 0;
            // Red when parts of the signal cancel in mono.
            heading(padding, 'Correlation', r.correlation.toFixed(2), phaseIssue);
            drawBar(ctx, padding, 30, column, r.correlation, ['-1', '0', '+1'], (value) =>
                value < 0
                    ? css('--meter-clip')
                    : value < 0.3
                      ? css('--meter-high')
                      : css('--meter-low'),
            );
            const balanceX = padding + column + gap;
            const balance = r.balance;
            const side = Math.abs(balance) < 0.05 ? 'C' : balance > 0 ? 'L' : 'R';
            heading(balanceX, 'Balance', `${Math.abs(balance).toFixed(1)} dB ${side}`);
            drawBar(ctx, balanceX, 30, column, -balance / 12, ['L', 'C', 'R'], () => color);
            const widthX = padding + (column + gap) * 2;
            heading(widthX, 'Width (S/M)', `${Math.round(r.width * 100)} %`);
            ctx.fillStyle = css('--meter-bg');
            ctx.fillRect(widthX, 30, column, 10);
            ctx.fillStyle = withAlpha(color, 0.8);
            ctx.fillRect(widthX, 30, Math.min(1, r.width) * column, 10);
            ctx.fillStyle = css('--grid-label');
            ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
            ctx.fillText('mono', widthX, 52);
            ctx.textAlign = 'right';
            ctx.fillText('100 %', widthX + column, 52);
            ctx.textAlign = 'start';
        },
        [color],
    );

    return (
        <div className="editor analyzer-editor stereo-editor">
            <div className="display stereo-display">
                <div className="stereo-views">
                    <canvas ref={scope} className="stereo-scope" />
                    <FrequencyImage id={effect.id} />
                </div>
                <canvas ref={meters} className="stereo-meters" />
            </div>
            <div className="control-row">
                <ControlGroup title="Scope">
                    <div className="stack">
                        <Segmented
                            value={p.display}
                            options={[
                                { value: 'dots', label: 'Dots' },
                                { value: 'lines', label: 'Lines' },
                            ]}
                            onChange={(display) => setParams({ display })}
                            color={color}
                        />
                        <Toggle
                            active={p.autoGain}
                            onChange={(autoGain) => setParams({ autoGain })}
                            color={color}
                            title="Scale quiet signals up to fill the scope"
                        >
                            Auto zoom
                        </Toggle>
                    </div>
                    <Knob
                        spec={SPECS.persistence}
                        value={p.persistence}
                        onChange={(persistence) => setParams({ persistence })}
                        color={color}
                    />
                </ControlGroup>
                <div className="control-note">
                    Scope: vertical traces are mono content, horizontal ones are side content. By
                    frequency: each band sits where it is panned and is as wide as its stereo
                    content; green is in phase, red cancels when summed to mono.
                </div>
            </div>
        </div>
    );
}
