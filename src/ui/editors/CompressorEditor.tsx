import { useRef } from 'react';
import { autoMakeupDb, gainComputerDb, gainReductionDb } from '../../dsp/dynamics';
import { SPECS } from '../../shared/effects';
import type { Telemetry } from '../../shared/messages';
import { ControlGroup, Segmented, Toggle } from '../components/Controls';
import { Knob } from '../components/Knob';
import { DynamicsHistory, ReductionMeter } from '../components/Meters';
import { LINE_GRAB, specValue, useCanvasDrag, wheelStep, type DragHandle } from '../canvasDrag';
import { fromNormalized, toNormalized } from '../format';
import { RING_RADIUS, css, drawGuide, drawNode, ringTurn } from '../graph';
import { useCanvas } from '../useCanvas';
import type { EditorProps } from './types';

const CURVE_MIN = -60;
/** Share of the ratio knob's range covered by dragging the knee node the full display height. */
const RATIO_DRAG = 1.2;

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

export function TransferCurve({
    thresholdDb,
    ratio,
    kneeDb,
    makeupDb,
    color,
    reduction,
    onChange,
}: {
    thresholdDb: number;
    ratio: number;
    kneeDb: number;
    makeupDb: number;
    color: string;
    reduction: (telemetry: Telemetry) => number;
    /** Makes the curve editable: drag the knee for the threshold, the slope for the ratio. */
    onChange?: (patch: { thresholdDb?: number; ratio?: number; kneeDb?: number }) => void;
}) {
    const dot = useRef(CURVE_MIN);
    const ref = useCanvas(
        ({ ctx, width, height, telemetry, live }) => {
            const toX = (db: number) => ((db - CURVE_MIN) / -CURVE_MIN) * width;
            const toY = (db: number) => height - ((db - CURVE_MIN) / -CURVE_MIN) * height;
            ctx.strokeStyle = css('--grid');
            ctx.fillStyle = css('--grid-label');
            ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
            for (let db = -48; db < 0; db += 12) {
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
            ctx.beginPath();
            for (let x = 0; x <= width; x += 2) {
                const input = CURVE_MIN + (x / width) * -CURVE_MIN;
                const y = toY(gainComputerDb(input, thresholdDb, ratio, kneeDb) + makeupDb);
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
                // The knee node: threshold across, ratio up and down, the knee on its ring.
                const nodeX = toX(thresholdDb);
                const nodeY = toY(thresholdDb + makeupDb);
                drawGuide(ctx, [nodeX, nodeY + RING_RADIUS + 2], [nodeX, height], color);
                drawNode(ctx, nodeX, nodeY, color, ringTurn(SPECS.kneeDb, kneeDb));
                ctx.fillStyle = css('--grid-label');
                ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
                ctx.fillText(
                    `${thresholdDb.toFixed(1)} dB · ${ratio >= SPECS.ratio.max ? '∞' : ratio.toFixed(1)}:1 · knee ${kneeDb.toFixed(1)}`,
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
                const output = gainComputerDb(input, thresholdDb, ratio, kneeDb) + makeupDb;
                ctx.beginPath();
                ctx.arc(toX(input), toY(output), 5, 0, Math.PI * 2);
                ctx.fillStyle = '#ffffff';
                ctx.shadowColor = color;
                ctx.shadowBlur = 12;
                ctx.fill();
                ctx.shadowBlur = 0;
            }
        },
        [thresholdDb, ratio, kneeDb, makeupDb, color, onChange !== undefined],
    );
    const pointer = useCanvasDrag(({ x, y, width, height }) => {
        if (!onChange) {
            return undefined;
        }
        const toX = (db: number) => ((db - CURVE_MIN) / -CURVE_MIN) * width;
        const toY = (db: number) => height - ((db - CURVE_MIN) / -CURVE_MIN) * height;
        const xToDb = (px: number) => CURVE_MIN + (px / width) * -CURVE_MIN;
        const yToDb = (py: number) => (py / height) * CURVE_MIN;
        const knee: DragHandle['wheel'] = (direction, fine) =>
            onChange({ kneeDb: wheelStep(SPECS.kneeDb, kneeDb, direction, fine) });
        const thresholdX = toX(thresholdDb);
        const kneeY = toY(thresholdDb + makeupDb);
        if (Math.hypot(x - thresholdX, y - kneeY) <= RING_RADIUS + 3) {
            // Across for the threshold, from where the node was grabbed; up and down for the
            // ratio along its knob scale: down compresses harder.
            const offsetX = thresholdX - x;
            const ratioPosition = toNormalized(SPECS.ratio, ratio);
            return {
                cursor: 'move',
                drag: (point) =>
                    onChange({
                        thresholdDb: specValue(SPECS.thresholdDb, xToDb(point.x + offsetX)),
                        ratio: specValue(
                            SPECS.ratio,
                            fromNormalized(
                                SPECS.ratio,
                                ratioPosition + ((point.y - y) / height) * RATIO_DRAG,
                            ),
                        ),
                    }),
                reset: () =>
                    onChange({
                        thresholdDb: SPECS.thresholdDb.default,
                        ratio: SPECS.ratio.default,
                        kneeDb: SPECS.kneeDb.default,
                    }),
                wheel: knee,
            };
        }
        if (Math.abs(x - thresholdX) < LINE_GRAB) {
            return {
                cursor: 'ew-resize',
                drag: (point) =>
                    onChange({ thresholdDb: specValue(SPECS.thresholdDb, xToDb(point.x)) }),
                reset: () => onChange({ thresholdDb: SPECS.thresholdDb.default }),
                wheel: knee,
            };
        }
        const input = xToDb(x);
        const curveY = toY(gainComputerDb(input, thresholdDb, ratio, kneeDb) + makeupDb);
        if (x > thresholdX && Math.abs(y - curveY) < 10) {
            return {
                cursor: 'ns-resize',
                // The input level stays where the curve was grabbed; the output follows the
                // pointer, which sets the slope above the threshold.
                drag: (point) => {
                    const output = yToDb(point.y) - makeupDb;
                    const above = input - thresholdDb;
                    const ratioValue =
                        output <= thresholdDb ? SPECS.ratio.max : above / (output - thresholdDb);
                    onChange({ ratio: specValue(SPECS.ratio, ratioValue) });
                },
                reset: () => onChange({ ratio: SPECS.ratio.default }),
                wheel: knee,
            };
        }
        return { cursor: '', wheel: knee };
    });
    return (
        <canvas
            ref={ref}
            className="transfer-canvas"
            title={
                onChange
                    ? 'Drag the node sideways for the threshold, up and down for the ratio · wheel for the knee · the curve above the threshold drags the ratio too'
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
