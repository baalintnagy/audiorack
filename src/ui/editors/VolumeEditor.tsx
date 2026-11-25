import { VOLUME_FIELDS, volumeGains } from '../../dsp/kernels/volume';
import { SPECS } from '../../shared/effects';
import { ControlGroup, Toggle } from '../components/Controls';
import { Knob } from '../components/Knob';
import { LevelMeter, LoudnessBar } from '../components/Meters';
import { specValue, useCanvasDrag, wheelStep, type DragHandle } from '../canvasDrag';
import { css, drawGrip, drawGuide, withAlpha } from '../graph';
import { useCanvas } from '../useCanvas';
import type { EditorProps } from './types';

/** Where the sound stage sits in a canvas of the given size. */
function stage(w: number, height: number) {
    return { cx: w / 2, cy: height - 16, radius: Math.min(w / 2 - 20, height - 32) };
}

/** The arc covered by the image: its center and edges as canvas angles (-π is left). */
function arc(width: number, pan: number) {
    // 100% width spans the full stage; wider settings add a halo instead.
    const spread = Math.max(0.04, Math.PI * Math.min(1, width / 100));
    const center = -Math.PI / 2 + (pan / 100) * (Math.PI / 2);
    return {
        center,
        from: Math.max(-Math.PI, center - spread / 2),
        to: Math.min(0, center + spread / 2),
    };
}

/** Distance of the handle from the stage center, as a share of the radius, for a width. */
const HANDLE_INNER = 0.15;

function handleDistance(width: number, radius: number) {
    return radius * (HANDLE_INNER + (1 - HANDLE_INNER) * (width / SPECS.width.max));
}

/** The handle sits on the image's center line: its angle is the pan, its distance the width. */
function handlePosition(width: number, pan: number, w: number, height: number) {
    const { cx, cy, radius } = stage(w, height);
    const { center } = arc(width, pan);
    const distance = handleDistance(width, radius);
    return { x: cx + Math.cos(center) * distance, y: cy + Math.sin(center) * distance };
}

/**
 * Visualizes the stereo image after width and pan as a sound stage. One handle sets both: drag
 * it around the stage to pan, towards or away from the center for the width.
 */
function StereoField({
    width,
    pan,
    color,
    mute,
    onChange,
}: {
    width: number;
    pan: number;
    color: string;
    mute: boolean;
    onChange: (patch: { pan?: number; width?: number }) => void;
}) {
    const ref = useCanvas(
        ({ ctx, width: w, height }) => {
            const { cx, cy, radius } = stage(w, height);
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
            const { from, to } = arc(width, pan);
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
            const handle = handlePosition(width, pan, w, height);
            drawGuide(ctx, [cx, cy], [handle.x, handle.y], color);
            drawGrip(ctx, handle.x, handle.y, color);
        },
        [width, pan, color, mute],
    );
    const pointer = useCanvasDrag(({ x, y, width: w, height }) => {
        if (mute) {
            return undefined;
        }
        const { cx, cy, radius } = stage(w, height);
        const wheel: DragHandle['wheel'] = (direction, fine) =>
            onChange({ width: wheelStep(SPECS.width, width, direction, fine) });
        if (Math.hypot(x - cx, y - cy) > radius * 1.15) {
            return { cursor: '', wheel };
        }
        // The drag moves the handle by the pointer's movement, wherever it was pressed.
        const handle = handlePosition(width, pan, w, height);
        const offsetX = handle.x - x;
        const offsetY = handle.y - y;
        return {
            cursor: 'move',
            drag: (point) => {
                const hx = point.x + offsetX - cx;
                const hy = Math.min(0, point.y + offsetY - cy);
                // Below the stage the handle stays on its floor: hard left or right.
                const angle =
                    hy < 0 ? Math.atan2(hy, hx) : hx < 0 ? -Math.PI : hx > 0 ? 0 : -Math.PI / 2;
                const share = (Math.hypot(hx, hy) / radius - HANDLE_INNER) / (1 - HANDLE_INNER);
                onChange({
                    pan: specValue(SPECS.pan, ((angle + Math.PI / 2) / (Math.PI / 2)) * 100),
                    width: specValue(SPECS.width, share * SPECS.width.max),
                });
            },
            reset: () => onChange({ pan: SPECS.pan.default, width: SPECS.width.default }),
            wheel,
        };
    });
    return (
        <canvas
            ref={ref}
            className="stereo-canvas"
            title="Drag the handle around the stage to pan, in or out for the width · wheel for the width"
            {...pointer}
        />
    );
}

export function VolumeEditor({ effect, setParams, color }: EditorProps<'volume'>) {
    const p = effect.params;
    const gains = volumeGains(p);
    const balance = (value: number) =>
        Math.abs(value) < 1e-6 ? '-∞' : (20 * Math.log10(Math.abs(value))).toFixed(1);
    return (
        <div className="editor volume-editor">
            <div className="display split">
                <StereoField
                    width={p.width}
                    pan={p.pan}
                    color={color}
                    mute={p.mute}
                    onChange={setParams}
                />
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
