import { useRef } from 'react';
import { autoMakeupDb, gainComputerDb, gainReductionDb } from '../../dsp/dynamics';
import { SPECS } from '../../shared/effects';
import type { Telemetry } from '../../shared/messages';
import { ControlGroup, Segmented, Toggle } from '../components/Controls';
import { Knob } from '../components/Knob';
import { DynamicsHistory, ReductionMeter } from '../components/Meters';
import { drawHandleLine, RING_RADIUS } from '../display/draw';
import { settingHandle, specValue } from '../display/handles';
import { drawControlNode, nodeHandle, ringWheel, type ControlNode } from '../display/node';
import { useCanvasDrag, type CanvasPoint, type DragHandle } from '../display/pointer';
import { drawTransferGrid, transferScale } from '../display/transfer';
import { fromNormalized, toNormalized } from '../format';
import { css } from '../graph';
import { useCanvas } from '../useCanvas';
import type { EditorProps } from './types';
import { outputPeak } from '../telemetry';

const CURVE_MIN = -60;
/** Space kept between the node's ratio track and the sides of the display. */
const RATIO_INSET = RING_RADIUS + 4;

/** Inverts the static curve to estimate the detector level from a reduction reading. */
export function levelForReduction(
    reduction: number,
    thresholdDb: number,
    ratio: number,
    kneeDb: number,
): number {
    if (reduction <= 0.01) {
        return thresholdDb - kneeDb / 2 - 1;
    }
    let low = thresholdDb - kneeDb;
    let high = 40;
    for (let iteration = 0; iteration < 40; iteration++) {
        const middle = (low + high) / 2;
        if (gainReductionDb(middle, thresholdDb, ratio, kneeDb) < reduction) {
            low = middle;
        } else {
            high = middle;
        }
    }
    return (low + high) / 2;
}

/** The settings a transfer curve shows. */
interface CurveSettings {
    thresholdDb: number;
    ratio: number;
    kneeDb: number;
    makeupDb: number;
}

type CurvePatch = { thresholdDb?: number; ratio?: number; kneeDb?: number };

/**
 * The node of an editable transfer curve: across the display for the ratio along its knob scale,
 * from 1:1 at the left to ∞ at the right, and up and down for the threshold on the level scale.
 * Its ring sets the knee; its guides run across for the threshold and from top to bottom for the
 * ratio. Makeup gain moves the curve but not the node, so each axis reads one setting only, even
 * with auto makeup, which follows the threshold and the ratio.
 */
function curveNode(
    curve: CurveSettings,
    width: number,
    height: number,
    onChange: (patch: CurvePatch) => void,
): ControlNode<CurvePatch> {
    const { thresholdDb, ratio, kneeDb } = curve;
    const scale = transferScale(CURVE_MIN, width, height);
    const track = width - 2 * RATIO_INSET;
    return {
        x: RATIO_INSET + toNormalized(SPECS.ratio, ratio) * track,
        y: scale.toY(thresholdDb),
        atX: (x) => ({
            ratio: specValue(SPECS.ratio, fromNormalized(SPECS.ratio, (x - RATIO_INSET) / track)),
        }),
        atY: (y) => ({ thresholdDb: specValue(SPECS.thresholdDb, scale.yToDb(y)) }),
        apply: onChange,
        ring: {
            spec: SPECS.kneeDb,
            value: kneeDb,
            onChange: (value) => onChange({ kneeDb: value }),
        },
        reset: {
            node: () =>
                onChange({
                    thresholdDb: SPECS.thresholdDb.default,
                    ratio: SPECS.ratio.default,
                    kneeDb: SPECS.kneeDb.default,
                }),
            x: () => onChange({ ratio: SPECS.ratio.default }),
            y: () => onChange({ thresholdDb: SPECS.thresholdDb.default }),
        },
        across: { left: 0, right: width },
        down: { top: 0, bottom: height },
    };
}

/**
 * What the pointer grabs on an editable transfer curve: the node (see {@link curveNode}) or the
 * curve above the threshold, for the ratio. The wheel sets the knee anywhere on the curve.
 */
function curveHandle(
    point: CanvasPoint,
    curve: CurveSettings,
    onChange: (patch: CurvePatch) => void,
): DragHandle {
    const { x, y, width, height } = point;
    const { thresholdDb, ratio, kneeDb, makeupDb } = curve;
    const node = curveNode(curve, width, height, onChange);
    const grabbed = nodeHandle(point, node);
    if (grabbed) {
        return grabbed;
    }
    const scale = transferScale(CURVE_MIN, width, height);
    const input = scale.xToDb(x);
    const curveY = scale.toY(gainComputerDb(input, thresholdDb, ratio, kneeDb) + makeupDb);
    if (x > scale.toX(thresholdDb) && Math.abs(y - curveY) < 10) {
        return settingHandle({
            id: 'slope',
            cursor: 'ns-resize',
            spec: SPECS.ratio,
            value: ratio,
            // The input level stays where the curve was grabbed; the output follows the pointer,
            // which sets the slope above the threshold.
            toValue: (to) => {
                const output = scale.yToDb(to.y) - makeupDb;
                return output <= thresholdDb
                    ? SPECS.ratio.max
                    : (input - thresholdDb) / (output - thresholdDb);
            },
            onChange: (value) => onChange({ ratio: value }),
            wheel: ringWheel(node),
        });
    }
    return { cursor: '', wheel: ringWheel(node) };
}

/**
 * The static curve of the compressor, with a dot at the current detector level. With
 * `onChange` it can be edited: see {@link curveHandle}.
 */
export function TransferCurve({
    thresholdDb,
    ratio,
    kneeDb,
    makeupDb,
    color,
    reduction,
    onChange,
}: CurveSettings & {
    color: string;
    reduction: (telemetry: Telemetry) => number;
    onChange?: (patch: CurvePatch) => void;
}) {
    const dot = useRef(CURVE_MIN);
    const { handlers: pointer, hot } = useCanvasDrag((point) =>
        onChange
            ? curveHandle(point, { thresholdDb, ratio, kneeDb, makeupDb }, onChange)
            : undefined,
    );

    const ref = useCanvas(
        ({ ctx, width, height, telemetry, live }) => {
            const scale = transferScale(CURVE_MIN, width, height);
            const { toX, toY } = scale;
            const outputAt = (input: number) =>
                gainComputerDb(input, thresholdDb, ratio, kneeDb) + makeupDb;
            drawTransferGrid(ctx, scale, width, height, -48, 12);
            // An editable curve shows the threshold as the knee node's dotted guide instead.
            if (!onChange) {
                const lineX = Math.round(toX(thresholdDb)) + 0.5;
                drawHandleLine(
                    ctx,
                    [
                        [lineX, 0],
                        [lineX, height],
                    ],
                    { color, base: css('--threshold'), hot: false, dash: [] },
                );
            }
            ctx.beginPath();
            for (let x = 0; x <= width; x += 2) {
                const y = toY(outputAt(scale.xToDb(x)));
                if (x === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.strokeStyle = color;
            ctx.lineWidth = 2.5;
            ctx.shadowColor = color;
            ctx.shadowBlur = 10;
            ctx.stroke();
            ctx.shadowBlur = 0;
            if (onChange) {
                const curve = { thresholdDb, ratio, kneeDb, makeupDb };
                drawControlNode(ctx, curveNode(curve, width, height, onChange), color, hot);
                const ratioText = ratio >= SPECS.ratio.max ? '∞' : ratio.toFixed(1);
                ctx.fillStyle = css('--grid-label');
                ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
                ctx.fillText(
                    `${thresholdDb.toFixed(1)} dB · ${ratioText}:1 · knee ${kneeDb.toFixed(1)}`,
                    6,
                    14,
                );
            }
            if (telemetry) {
                const target = levelForReduction(reduction(telemetry), thresholdDb, ratio, kneeDb);
                if (live) {
                    dot.current += (target - dot.current) * 0.5;
                }
                const input = Math.max(CURVE_MIN, Math.min(0, dot.current));
                ctx.beginPath();
                ctx.arc(toX(input), toY(outputAt(input)), 5, 0, Math.PI * 2);
                ctx.fillStyle = '#ffffff';
                ctx.shadowColor = color;
                ctx.shadowBlur = 12;
                ctx.fill();
                ctx.shadowBlur = 0;
            }
        },
        [thresholdDb, ratio, kneeDb, makeupDb, color, onChange !== undefined, hot],
    );
    return (
        <canvas
            ref={ref}
            className="transfer-canvas"
            title={
                onChange
                    ? 'Drag the node up and down for the threshold, sideways for the ratio (1:1 at the left, ∞ at the right), its ring for the knee · the curve above the threshold drags the ratio too'
                    : undefined
            }
            {...(onChange ? pointer : {})}
        />
    );
}

export function CompressorEditor({ effect, setParams, color }: EditorProps<'compressor'>) {
    const p = effect.params;
    const reduction = (telemetry: Telemetry) => telemetry.meters.effects[effect.id]?.[0] ?? 0;
    const makeup = p.makeupDb + (p.autoMakeup ? autoMakeupDb(p.thresholdDb, p.ratio) : 0);
    return (
        <div className="editor dynamics-editor">
            <div className="display split">
                <TransferCurve
                    thresholdDb={p.thresholdDb}
                    ratio={p.ratio}
                    kneeDb={p.kneeDb}
                    makeupDb={makeup}
                    color={color}
                    reduction={reduction}
                    onChange={setParams}
                />
                <DynamicsHistory
                    reduction={reduction}
                    level={(telemetry) => outputPeak(telemetry, effect.id)}
                    color={color}
                    thresholdDb={p.thresholdDb}
                    threshold={{
                        spec: SPECS.thresholdDb,
                        onChange: (thresholdDb) => setParams({ thresholdDb }),
                    }}
                />
                <ReductionMeter value={reduction} color={color} />
            </div>
            <div className="control-row">
                <ControlGroup title="Detection">
                    <Knob
                        spec={SPECS.thresholdDb}
                        value={p.thresholdDb}
                        onChange={(thresholdDb) => setParams({ thresholdDb })}
                        color={color}
                    />
                    <Knob
                        spec={SPECS.ratio}
                        value={p.ratio}
                        onChange={(ratio) => setParams({ ratio })}
                        color={color}
                    />
                    <Knob
                        spec={SPECS.kneeDb}
                        value={p.kneeDb}
                        onChange={(kneeDb) => setParams({ kneeDb })}
                        color={color}
                    />
                    <div className="stack">
                        <Segmented
                            value={p.detection}
                            options={[
                                { value: 'peak', label: 'Peak' },
                                { value: 'rms', label: 'RMS' },
                            ]}
                            onChange={(detection) => setParams({ detection })}
                            color={color}
                            vertical
                        />
                    </div>
                </ControlGroup>
                <ControlGroup title="Timing">
                    <Knob
                        spec={SPECS.attackMs}
                        value={p.attackMs}
                        onChange={(attackMs) => setParams({ attackMs })}
                        color={color}
                    />
                    <Knob
                        spec={SPECS.releaseMs}
                        value={p.releaseMs}
                        onChange={(releaseMs) => setParams({ releaseMs })}
                        color={color}
                    />
                    <Knob
                        spec={SPECS.sidechainHpHz}
                        value={p.sidechainHpHz}
                        onChange={(sidechainHpHz) => setParams({ sidechainHpHz })}
                        color={color}
                    />
                </ControlGroup>
                <ControlGroup title="Output">
                    <Knob
                        spec={SPECS.makeupDb}
                        value={p.makeupDb}
                        onChange={(makeupDb) => setParams({ makeupDb })}
                        color={color}
                    />
                    <Knob
                        spec={SPECS.mix}
                        value={p.mix}
                        onChange={(mix) => setParams({ mix })}
                        color={color}
                    />
                    <div className="stack">
                        <Toggle
                            active={p.autoMakeup}
                            onChange={(autoMakeup) => setParams({ autoMakeup })}
                            color={color}
                            title="Automatically compensate part of the gain reduction"
                        >
                            Auto
                        </Toggle>
                    </div>
                </ControlGroup>
            </div>
        </div>
    );
}
