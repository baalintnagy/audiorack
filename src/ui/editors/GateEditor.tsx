import { GATE_FIELDS } from '../../dsp/kernels/gate';
import { SPECS } from '../../shared/effects';
import type { Telemetry } from '../../shared/messages';
import { ControlGroup } from '../components/Controls';
import { Knob } from '../components/Knob';
import { DynamicsHistory, ReductionMeter } from '../components/Meters';
import { LINE_GRAB, specValue, useCanvasDrag, wheelStep, type DragHandle } from '../canvasDrag';
import { RING_RADIUS, css, drawGuide, drawNode, ringTurn, withAlpha } from '../graph';
import { useCanvas } from '../useCanvas';
import type { EditorProps } from './types';

/** Input and output range of the transfer curve, in dB. */
const CURVE_MIN = -84;

/**
 * Static curve of the gate: unity above the threshold, lowered by the range below it, with the
 * hysteresis loop between the opening and closing levels. Its node sets three settings: drag it
 * sideways for the threshold and down for more range; the wheel turns its ring for hysteresis.
 */
function GateCurve({
    thresholdDb,
    rangeDb,
    hysteresisDb,
    color,
    onChange,
}: {
    thresholdDb: number;
    rangeDb: number;
    hysteresisDb: number;
    color: string;
    onChange: (patch: { thresholdDb?: number; rangeDb?: number; hysteresisDb?: number }) => void;
}) {
    const ref = useCanvas(
        ({ ctx, width, height }) => {
            const toX = (db: number) => ((db - CURVE_MIN) / -CURVE_MIN) * width;
            const toY = (db: number) =>
                height - ((Math.max(CURVE_MIN, db) - CURVE_MIN) / -CURVE_MIN) * height;
            ctx.strokeStyle = css('--grid');
            ctx.fillStyle = css('--grid-label');
            ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
            ctx.lineWidth = 1;
            for (let db = -72; db < 0; db += 12) {
                ctx.beginPath();
                ctx.moveTo(Math.round(toX(db)) + 0.5, 0);
                ctx.lineTo(Math.round(toX(db)) + 0.5, height);
                ctx.moveTo(0, Math.round(toY(db)) + 0.5);
                ctx.lineTo(width, Math.round(toY(db)) + 0.5);
                ctx.stroke();
                ctx.fillText(`${db}`, toX(db) + 2, height - 4);
            }
            ctx.strokeStyle = css('--grid-strong');
            ctx.setLineDash([3, 4]);
            ctx.beginPath();
            ctx.moveTo(0, height);
            ctx.lineTo(width, 0);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.strokeStyle = css('--threshold');
            ctx.beginPath();
            ctx.moveTo(Math.round(toX(thresholdDb)) + 0.5, 0);
            ctx.lineTo(Math.round(toX(thresholdDb)) + 0.5, height);
            ctx.stroke();
            const close = thresholdDb - hysteresisDb;
            // Closed: lowered by the range up to the opening level.
            ctx.strokeStyle = withAlpha(color, 0.55);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(toX(CURVE_MIN), toY(CURVE_MIN - rangeDb));
            ctx.lineTo(toX(thresholdDb), toY(thresholdDb - rangeDb));
            ctx.stroke();
            // The jumps: the range from the node up to unity where it opens, and back down where
            // it closes.
            drawGuide(
                ctx,
                [toX(thresholdDb), toY(thresholdDb - rangeDb) - RING_RADIUS - 2],
                [toX(thresholdDb), toY(thresholdDb)],
                color,
            );
            drawGuide(
                ctx,
                [toX(close), toY(close)],
                [toX(close), toY(close - rangeDb)],
                color,
                0.4,
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
            drawNode(
                ctx,
                toX(thresholdDb),
                toY(thresholdDb - rangeDb),
                color,
                ringTurn(SPECS.hysteresisDb, hysteresisDb),
            );
            ctx.fillStyle = css('--grid-label');
            ctx.fillText(
                `${thresholdDb.toFixed(1)} dB · range ${rangeDb.toFixed(1)} · hyst ${hysteresisDb.toFixed(1)}`,
                6,
                14,
            );
        },
        [thresholdDb, rangeDb, hysteresisDb, color],
    );
    const pointer = useCanvasDrag(({ x, y, width, height }) => {
        const toX = (db: number) => ((db - CURVE_MIN) / -CURVE_MIN) * width;
        const xToDb = (px: number) => CURVE_MIN + (px / width) * -CURVE_MIN;
        const nodeY =
            height -
            ((Math.max(CURVE_MIN, thresholdDb - rangeDb) - CURVE_MIN) / -CURVE_MIN) * height;
        const hysteresis: DragHandle['wheel'] = (direction, fine) =>
            onChange({
                hysteresisDb: wheelStep(SPECS.hysteresisDb, hysteresisDb, direction, fine),
            });
        const thresholdX = toX(thresholdDb);
        if (Math.hypot(x - thresholdX, y - nodeY) <= RING_RADIUS + 3) {
            const offsetX = thresholdX - x;
            const dbPerPixel = -CURVE_MIN / height;
            return {
                cursor: 'move',
                // Across for the threshold; the range follows the vertical movement, since the
                // node may sit clipped at the bottom when the range is deep.
                drag: (point) =>
                    onChange({
                        thresholdDb: specValue(SPECS.gateThresholdDb, xToDb(point.x + offsetX)),
                        rangeDb: specValue(SPECS.gateRangeDb, rangeDb + (point.y - y) * dbPerPixel),
                    }),
                reset: () =>
                    onChange({
                        thresholdDb: SPECS.gateThresholdDb.default,
                        rangeDb: SPECS.gateRangeDb.default,
                        hysteresisDb: SPECS.hysteresisDb.default,
                    }),
                wheel: hysteresis,
            };
        }
        if (Math.abs(x - thresholdX) < LINE_GRAB) {
            return {
                cursor: 'ew-resize',
                drag: (point) =>
                    onChange({ thresholdDb: specValue(SPECS.gateThresholdDb, xToDb(point.x)) }),
                reset: () => onChange({ thresholdDb: SPECS.gateThresholdDb.default }),
                wheel: hysteresis,
            };
        }
        return { cursor: '', wheel: hysteresis };
    });
    return (
        <canvas
            ref={ref}
            className="transfer-canvas"
            title="Drag the node sideways for the threshold, down for more range · wheel for hysteresis"
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
