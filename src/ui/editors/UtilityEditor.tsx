import { UTILITY_FIELDS, utilityGains } from '../../dsp/kernels/utility';
import { SPECS } from '../../shared/effects';
import { ControlGroup, Toggle } from '../components/Controls';
import { Knob } from '../components/Knob';
import { LevelMeter, LoudnessBar } from '../components/Meters';
import { specValue } from '../display/handles';
import { drawControlNode, nodeHandle, ringWheel, type ControlNode } from '../display/node';
import { useCanvasDrag } from '../display/pointer';
import { formatValue, fromNormalized, toNormalized } from '../format';
import { css, withAlpha } from '../graph';
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

/** Half the width of the stage at a height: how far a guide across it reaches the outer arc. */
function reachAt(y: number, cy: number, radius: number) {
    return Math.sqrt(Math.max(0, radius * radius - (cy - y) ** 2));
}

/** The settings the sound stage shows. */
interface StageSettings {
    pan: number;
    gainDb: number;
    width: number;
}

/**
 * The node on the sound stage: across it for the pan, from hard left to hard right, and up from
 * its floor for the width, from mono at the floor to the widest setting at the top of the stage.
 * Its ring sets the gain; its guides run across the stage (up to its outer arc) for the width and
 * down to the floor for the pan.
 */
function stageNode(
    settings: StageSettings,
    w: number,
    height: number,
    onChange: (patch: Partial<StageSettings>) => void,
): ControlNode<Partial<StageSettings>> {
    const { pan, gainDb, width } = settings;
    const { cx, cy, radius } = stage(w, height);
    const y = cy - toNormalized(SPECS.width, width) * radius;
    const reach = reachAt(y, cy, radius);
    return {
        x: cx + (pan / 100) * radius,
        y,
        atX: (x) => ({ pan: specValue(SPECS.pan, ((x - cx) / radius) * 100) }),
        atY: (to) => ({
            width: specValue(SPECS.width, fromNormalized(SPECS.width, (cy - to) / radius)),
        }),
        apply: onChange,
        ring: {
            spec: SPECS.utilityGainDb,
            value: gainDb,
            onChange: (value) => onChange({ gainDb: value }),
        },
        reset: {
            node: () =>
                onChange({
                    pan: SPECS.pan.default,
                    gainDb: SPECS.utilityGainDb.default,
                    width: SPECS.width.default,
                }),
            x: () => onChange({ pan: SPECS.pan.default }),
            y: () => onChange({ width: SPECS.width.default }),
        },
        across: { left: cx - reach, right: cx + reach },
        down: { bottom: cy },
    };
}

/**
 * Visualizes the stereo image after width and pan as a sound stage. Its node sets three
 * settings: drag it sideways for the pan and up or down for the width; its ring sets the gain.
 */
function StereoField({
    width,
    pan,
    gainDb,
    color,
    mute,
    onChange,
}: {
    width: number;
    pan: number;
    gainDb: number;
    color: string;
    mute: boolean;
    onChange: (patch: { pan?: number; width?: number; gainDb?: number }) => void;
}) {
    const settings = { pan, gainDb, width };
    // The wheel sets the gain anywhere on the stage.
    const { handlers: pointer, hot } = useCanvasDrag((point) => {
        if (mute) {
            return undefined;
        }
        const node = stageNode(settings, point.width, point.height, onChange);
        return nodeHandle(point, node) ?? { cursor: '', wheel: ringWheel(node) };
    });

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
            drawControlNode(ctx, stageNode(settings, w, height, onChange), color, hot);
            ctx.fillStyle = css('--grid-label');
            ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
            ctx.fillText(
                `${formatValue(SPECS.utilityGainDb, gainDb)} · width ${width.toFixed(0)}%`,
                6,
                14,
            );
        },
        [width, pan, gainDb, color, mute, hot],
    );
    return (
        <canvas
            ref={ref}
            className="stereo-canvas"
            title="Drag the node sideways to pan, up or down for the width, its ring for the gain"
            {...pointer}
        />
    );
}

export function UtilityEditor({ effect, setParams, color }: EditorProps<'utility'>) {
    const p = effect.params;
    const gains = utilityGains(p);
    const balance = (value: number) =>
        Math.abs(value) < 1e-6 ? '-∞' : (20 * Math.log10(Math.abs(value))).toFixed(1);
    return (
        <div className="editor utility-editor">
            <div className="display split">
                <StereoField
                    width={p.width}
                    pan={p.pan}
                    gainDb={p.gainDb}
                    color={color}
                    mute={p.mute}
                    onChange={setParams}
                />
                <div className="utility-readout">
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
                                return data && data.length > UTILITY_FIELDS.shortTerm
                                    ? {
                                          momentary: data[UTILITY_FIELDS.momentary],
                                          shortTerm: data[UTILITY_FIELDS.shortTerm],
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
                <ControlGroup title="Stereo & gain">
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
                    <Knob
                        spec={SPECS.utilityGainDb}
                        value={p.gainDb}
                        onChange={(gainDb) => setParams({ gainDb })}
                        color={color}
                    />
                </ControlGroup>
                <ControlGroup title="Mute & polarity">
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
