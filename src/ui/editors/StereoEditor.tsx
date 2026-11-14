import { useMemo, useRef } from 'react';
import { STEREO_FIELDS } from '../../dsp/kernels/analyzers';
import { SPECS } from '../../shared/effects';
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
        const count = (data.length - STEREO_FIELDS.points) / 2;
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
            const barWidth = width - padding * 2;
            ctx.fillStyle = css('--text');
            ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
            ctx.fillText('Correlation', padding, 22);
            ctx.textAlign = 'right';
            ctx.fillText(r.correlation.toFixed(2), width - padding, 22);
            ctx.textAlign = 'start';
            drawBar(ctx, padding, 32, barWidth, r.correlation, ['-1', '0', '+1'], (value) =>
                value < 0
                    ? css('--meter-clip')
                    : value < 0.3
                      ? css('--meter-high')
                      : css('--meter-low'),
            );
            ctx.fillStyle = css('--text');
            ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
            ctx.fillText('Balance', padding, 88);
            ctx.textAlign = 'right';
            const balance = r.balance;
            const side = Math.abs(balance) < 0.05 ? 'C' : balance > 0 ? 'L' : 'R';
            ctx.fillText(`${Math.abs(balance).toFixed(1)} dB ${side}`, width - padding, 88);
            ctx.textAlign = 'start';
            drawBar(ctx, padding, 98, barWidth, -balance / 12, ['L', 'C', 'R'], () => color);
            ctx.fillStyle = css('--text');
            ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
            ctx.fillText('Width (S/M)', padding, 154);
            ctx.textAlign = 'right';
            ctx.fillText(`${Math.round(r.width * 100)} %`, width - padding, 154);
            ctx.textAlign = 'start';
            ctx.fillStyle = css('--meter-bg');
            ctx.fillRect(padding, 164, barWidth, 10);
            ctx.fillStyle = withAlpha(color, 0.8);
            ctx.fillRect(padding, 164, Math.min(1, r.width) * barWidth, 10);
            if (r.correlation < 0) {
                ctx.fillStyle = css('--meter-clip');
                ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
                ctx.fillText('Phase issues: mono playback will lose energy', padding, 200);
            }
        },
        [color],
    );

    return (
        <div className="editor analyzer-editor">
            <div className="display split">
                <canvas ref={scope} className="stereo-scope" />
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
                    Vertical traces are mono content, horizontal ones are side (stereo) content. A
                    negative correlation means parts of the signal cancel when summed to mono.
                </div>
            </div>
        </div>
    );
}
