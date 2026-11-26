import { GATE_FIELDS } from '../../dsp/kernels/gate';
import { SPECS } from '../../shared/effects';
import type { Telemetry } from '../../shared/messages';
import { ControlGroup } from '../components/Controls';
import { Knob } from '../components/Knob';
import { DynamicsHistory, ReductionMeter } from '../components/Meters';
import { drawGuide, RING_RADIUS } from '../display/draw';
import { LINE_GRAB, settingHandle, specValue } from '../display/handles';
import {
    drawControlGuides,
    drawControlNode,
    nodeHandle,
    ringWheel,
    type ControlNode,
} from '../display/node';
import { useCanvasDrag, type CanvasPoint, type DragHandle } from '../display/pointer';
import { drawTransferGrid, transferScale } from '../display/transfer';
import { css, withAlpha } from '../graph';
import { useCanvas } from '../useCanvas';
import type { EditorProps } from './types';

/** Input and output range of the transfer curve, in dB. */
const CURVE_MIN = -84;

/** The settings the gate's transfer curve shows. */
interface GateSettings {
    thresholdDb: number;
    rangeDb: number;
    hysteresisDb: number;
}

/**
 * The gate's transfer curve scale. Levels below the curve's range sit on its floor, where the
 * node stays when the range is deep.
 */
function gateScale(width: number, height: number) {
    const scale = transferScale(CURVE_MIN, width, height);
    return { ...scale, toY: (db: number) => scale.toY(Math.max(CURVE_MIN, db)) };
}

/**
 * The gate's node, where it opens: sideways for the threshold, down for more range (on the
 * floor of the curve, when the range is deep). Its ring sets the hysteresis; its guides run
 * across for the range and from top to bottom for the threshold.
 */
function gateNode(
    gate: GateSettings,
    width: number,
    height: number,
    onChange: (patch: Partial<GateSettings>) => void,
): ControlNode<Partial<GateSettings>> {
    const { thresholdDb, rangeDb, hysteresisDb } = gate;
    const scale = gateScale(width, height);
    const y = scale.toY(thresholdDb - rangeDb);
    return {
        x: scale.toX(thresholdDb),
        y,
        atX: (x) => ({ thresholdDb: specValue(SPECS.gateThresholdDb, scale.xToDb(x)) }),
        // The range follows the vertical movement, since the node may sit on the floor.
        atY: (to) => ({
            rangeDb: specValue(SPECS.gateRangeDb, rangeDb + (to - y) * scale.dbPerPixel),
        }),
        apply: onChange,
        ring: {
            spec: SPECS.hysteresisDb,
            value: hysteresisDb,
            onChange: (value) => onChange({ hysteresisDb: value }),
        },
        reset: {
            node: () =>
                onChange({
                    thresholdDb: SPECS.gateThresholdDb.default,
                    rangeDb: SPECS.gateRangeDb.default,
                    hysteresisDb: SPECS.hysteresisDb.default,
                }),
            x: () => onChange({ thresholdDb: SPECS.gateThresholdDb.default }),
            y: () => onChange({ rangeDb: SPECS.gateRangeDb.default }),
        },
        across: { left: 0, right: width },
        down: { top: 0, bottom: height },
    };
}

/**
 * What the pointer grabs on the gate's curve: the guide where it closes (the hysteresis) or the
 * node where it opens (see {@link gateNode}). The wheel sets the hysteresis anywhere on the
 * curve.
 */
function gateHandle(
    point: CanvasPoint,
    gate: GateSettings,
    onChange: (patch: Partial<GateSettings>) => void,
): DragHandle {
    const { x, y, width, height } = point;
    const { thresholdDb, rangeDb, hysteresisDb } = gate;
    const scale = gateScale(width, height);
    const node = gateNode(gate, width, height, onChange);
    // Where it closes: the hysteresis is how far that sits left of the threshold. It comes
    // before the threshold guide, which it can lie right next to.
    const closeDb = thresholdDb - hysteresisDb;
    const closeX = scale.toX(closeDb);
    const onClosingGuide =
        hysteresisDb > 0 &&
        Math.abs(x - closeX) <= LINE_GRAB &&
        y >= scale.toY(closeDb) &&
        y <= scale.toY(closeDb - rangeDb) &&
        Math.hypot(x - node.x, y - node.y) > RING_RADIUS + 3;
    if (onClosingGuide) {
        const offsetX = closeX - x;
        return settingHandle({
            id: 'hysteresis',
            cursor: 'ew-resize',
            spec: SPECS.hysteresisDb,
            value: hysteresisDb,
            toValue: (to) => thresholdDb - scale.xToDb(to.x + offsetX),
            onChange: (value) => onChange({ hysteresisDb: value }),
        });
    }
    return nodeHandle(point, node) ?? { cursor: '', wheel: ringWheel(node) };
}

/**
 * Static curve of the gate: unity above the threshold, lowered by the range below it, with the
 * hysteresis loop between the opening and closing levels. See {@link gateHandle} for editing it.
 */
function GateCurve({
    color,
    onChange,
    ...gate
}: GateSettings & {
    color: string;
    onChange: (patch: Partial<GateSettings>) => void;
}) {
    const { thresholdDb, rangeDb, hysteresisDb } = gate;
    const { handlers: pointer, hot } = useCanvasDrag((point) => gateHandle(point, gate, onChange));

    const ref = useCanvas(
        ({ ctx, width, height }) => {
            const scale = gateScale(width, height);
            const { toX, toY } = scale;
            drawTransferGrid(ctx, scale, width, height, -72, 12);
            const close = thresholdDb - hysteresisDb;
            // Closed: lowered by the range up to the opening level. Levels lowered below the
            // curve's range run along its floor, until the input is high enough to rise off it.
            const offFloor = Math.min(thresholdDb, CURVE_MIN + rangeDb);
            ctx.strokeStyle = withAlpha(color, 0.55);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(toX(CURVE_MIN), toY(CURVE_MIN - rangeDb));
            ctx.lineTo(toX(offFloor), toY(offFloor - rangeDb));
            ctx.lineTo(toX(thresholdDb), toY(thresholdDb - rangeDb));
            ctx.stroke();
            // Guides around the node where it opens. None crosses the node, however small the
            // range or the hysteresis.
            const node = gateNode(gate, width, height, onChange);
            // Across: the level the gate lowers the threshold to while closed. The threshold,
            // from top to bottom; between the node and unity it shows the range.
            drawControlGuides(ctx, node, color, hot);
            // Where it closes.
            drawGuide(
                ctx,
                [toX(close), toY(close)],
                [toX(close), toY(close - rangeDb)],
                color,
                0.4,
                node,
                hot === 'hysteresis',
            );
            // Open: unity from the closing level up.
            ctx.strokeStyle = color;
            ctx.lineWidth = 2.5;
            ctx.shadowColor = color;
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.moveTo(toX(close), toY(close));
            ctx.lineTo(toX(0), toY(0));
            ctx.stroke();
            ctx.shadowBlur = 0;
            drawControlNode(ctx, node, color, hot, { guides: false });
            ctx.fillStyle = css('--grid-label');
            ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
            ctx.fillText(
                `${thresholdDb.toFixed(1)} dB · range ${rangeDb.toFixed(1)} · hyst ${hysteresisDb.toFixed(1)}`,
                6,
                14,
            );
        },
        [thresholdDb, rangeDb, hysteresisDb, color, hot],
    );
    return (
        <canvas
            ref={ref}
            className="transfer-canvas"
            title="Drag the node sideways for the threshold, down for more range, its ring for the hysteresis"
            {...pointer}
        />
    );
}

export function GateEditor({ effect, setParams, color }: EditorProps<'gate'>) {
    const p = effect.params;
    const readings = (telemetry: Telemetry) => telemetry.meters.effects[effect.id];
    const reduction = (telemetry: Telemetry) => readings(telemetry)?.[GATE_FIELDS.reduction] ?? 0;
    const level = (telemetry: Telemetry) => readings(telemetry)?.[GATE_FIELDS.level] ?? 0;
    return (
        <div className="editor dynamics-editor">
            <div className="display split">
                <GateCurve
                    thresholdDb={p.thresholdDb}
                    rangeDb={p.rangeDb}
                    hysteresisDb={p.hysteresisDb}
                    color={color}
                    onChange={setParams}
                />
                <DynamicsHistory
                    reduction={reduction}
                    level={level}
                    color={color}
                    thresholdDb={p.thresholdDb}
                    range={Math.min(84, Math.max(48, 12 - p.thresholdDb))}
                    threshold={{
                        spec: SPECS.gateThresholdDb,
                        onChange: (thresholdDb) => setParams({ thresholdDb }),
                    }}
                />
                <ReductionMeter value={reduction} color={color} range={Math.max(12, p.rangeDb)} />
            </div>
            <div className="control-row">
                <ControlGroup title="Detection">
                    <Knob
                        spec={SPECS.gateThresholdDb}
                        value={p.thresholdDb}
                        onChange={(thresholdDb) => setParams({ thresholdDb })}
                        color={color}
                        size={64}
                    />
                    <Knob
                        spec={SPECS.hysteresisDb}
                        value={p.hysteresisDb}
                        onChange={(hysteresisDb) => setParams({ hysteresisDb })}
                        color={color}
                    />
                    <Knob
                        spec={SPECS.sidechainHpHz}
                        value={p.sidechainHpHz}
                        onChange={(sidechainHpHz) => setParams({ sidechainHpHz })}
                        color={color}
                    />
                </ControlGroup>
                <ControlGroup title="Envelope">
                    <Knob
                        spec={SPECS.gateAttackMs}
                        value={p.attackMs}
                        onChange={(attackMs) => setParams({ attackMs })}
                        color={color}
                    />
                    <Knob
                        spec={SPECS.holdMs}
                        value={p.holdMs}
                        onChange={(holdMs) => setParams({ holdMs })}
                        color={color}
                    />
                    <Knob
                        spec={SPECS.gateReleaseMs}
                        value={p.releaseMs}
                        onChange={(releaseMs) => setParams({ releaseMs })}
                        color={color}
                    />
                </ControlGroup>
                <ControlGroup title="Closed">
                    <Knob
                        spec={SPECS.gateRangeDb}
                        value={p.rangeDb}
                        onChange={(rangeDb) => setParams({ rangeDb })}
                        color={color}
                        size={64}
                    />
                </ControlGroup>
                <div className="control-note">
                    The gate opens when the level reaches the threshold and closes{' '}
                    {p.hysteresisDb.toFixed(1)} dB below it, after the hold time. The sidechain
                    filter keeps rumble from opening it.
                </div>
            </div>
        </div>
    );
}
