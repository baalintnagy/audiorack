import { VOLUME_FIELDS, volumeGains } from '../../dsp/kernels/volume';
import { SPECS } from '../../shared/effects';
import { ControlGroup, Toggle } from '../components/Controls';
import { Knob } from '../components/Knob';
import { LevelMeter, LoudnessBar } from '../components/Meters';
import { css, withAlpha } from '../graph';
import { useCanvas } from '../useCanvas';
import type { EditorProps } from './types';

/** Visualizes the stereo image after width and pan as a sound stage. */
function StereoField({
    width,
    pan,
    color,
    mute,
}: {
    width: number;
    pan: number;
    color: string;
    mute: boolean;
}) {
    const ref = useCanvas(
        ({ ctx, width: w, height }) => {
            const cx = w / 2;
            const cy = height - 16;
            const radius = Math.min(w / 2 - 20, height - 32);
            ctx.strokeStyle = css('--grid');
            ctx.lineWidth = 1;
            [0.33, 0.66, 1].forEach((scale) => {
                ctx.beginPath();
                ctx.arc(cx, cy, radius * scale, Math.PI, 0);
                ctx.stroke();
            });
            ctx.fillStyle = css('--grid-label');
            ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
            ctx.fillText('L', cx - radius - 12, cy);
            ctx.fillText('R', cx + radius + 5, cy);
            if (mute) {
                ctx.fillStyle = css('--text-dim');
                ctx.textAlign = 'center';
                ctx.font = '600 14px ui-sans-serif, system-ui, sans-serif';
                ctx.fillText('MUTED', cx, cy - radius / 2);
                ctx.textAlign = 'start';
                return;
            }
            // 100% width spans the full stage; wider settings add a halo instead.
            const spread = Math.max(0.04, Math.PI * Math.min(1, width / 100));
            const center = -Math.PI / 2 + (pan / 100) * (Math.PI / 2);
            const from = Math.max(-Math.PI, center - spread / 2);
            const to = Math.min(0, center + spread / 2);
            if (width > 100) {
                ctx.beginPath();
                ctx.arc(cx, cy, radius * (1 + (width - 100) / 1000), from, to);
                ctx.strokeStyle = withAlpha(color, (width - 100) / 150);
                ctx.lineWidth = 6;
                ctx.stroke();
            }
            const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
            gradient.addColorStop(0, withAlpha(color, 0.5));
            gradient.addColorStop(1, withAlpha(color, 0.05));
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, radius, from, to);
            ctx.closePath();
            ctx.fillStyle = gradient;
            ctx.fill();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.stroke();
        },
        [width, pan, color, mute],
    );
    return <canvas ref={ref} className="stereo-canvas" />;
}

export function VolumeEditor({ effect, setParams, color }: EditorProps<'volume'>) {
    const p = effect.params;
    const gains = volumeGains(p);
    const balance = (value: number) =>
        Math.abs(value) < 1e-6 ? '-∞' : (20 * Math.log10(Math.abs(value))).toFixed(1);
    return (
        <div className="editor volume-editor">
            <div className="display split">
                <StereoField width={p.width} pan={p.pan} color={color} mute={p.mute} />
                <div className="volume-readout">
                    <div>
                        <span className="readout-label">Left</span>
                        <span className="readout-value">{balance(gains.left)} dB</span>
                    </div>
                    <div>
                        <span className="readout-label">Right</span>
                        <span className="readout-value">{balance(gains.right)} dB</span>
                    </div>
                    <div title="Momentary (bar) and short-term (marker) loudness of the output">
                        <span className="readout-label">Loudness, LUFS</span>
                        <LoudnessBar
                            color={color}
                            source={(telemetry) => {
                                const data = telemetry.meters.effects[effect.id];
                                return data && data.length > VOLUME_FIELDS.shortTerm
                                    ? {
                                          momentary: data[VOLUME_FIELDS.momentary],
                                          shortTerm: data[VOLUME_FIELDS.shortTerm],
                                      }
                                    : undefined;
                            }}
                        />
                    </div>
                </div>
                <LevelMeter
                    label="OUT"
                    source={(telemetry) => ({
                        peak: telemetry.meters.outputPeak,
                        rms: telemetry.meters.outputRms,
                    })}
                />
            </div>
            <div className="control-row">
                <ControlGroup title="Level">
                    <Knob
                        spec={SPECS.volumeDb}
                        value={p.gainDb}
                        onChange={(gainDb) => setParams({ gainDb })}
                        color={color}
                        size={72}
                    />
                </ControlGroup>
                <ControlGroup title="Stereo">
                    <Knob
                        spec={SPECS.pan}
                        value={p.pan}
                        onChange={(pan) => setParams({ pan })}
                        color={color}
                    />
                    <Knob
                        spec={SPECS.width}
                        value={p.width}
                        onChange={(width) => setParams({ width })}
                        color={color}
                    />
                </ControlGroup>
                <ControlGroup title="Utility">
                    <div className="stack">
                        <Toggle
                            active={p.mute}
                            onChange={(mute) => setParams({ mute })}
                            color="#ff5e7a"
                        >
                            Mute
                        </Toggle>
                        <Toggle
                            active={p.invertLeft}
                            onChange={(invertLeft) => setParams({ invertLeft })}
                            color={color}
                            title="Invert left channel polarity"
                        >
                            Ø L
                        </Toggle>
                        <Toggle
                            active={p.invertRight}
                            onChange={(invertRight) => setParams({ invertRight })}
                            color={color}
                            title="Invert right channel polarity"
                        >
                            Ø R
                        </Toggle>
                    </div>
                </ControlGroup>
            </div>
        </div>
    );
}
