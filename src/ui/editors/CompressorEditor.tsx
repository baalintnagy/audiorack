import { useRef } from 'react';
import { autoMakeupDb, gainComputerDb, gainReductionDb } from '../../dsp/dynamics';
import { SPECS } from '../../shared/effects';
import type { Telemetry } from '../../shared/messages';
import { ControlGroup, Segmented, Toggle } from '../components/Controls';
import { Knob } from '../components/Knob';
import { DynamicsHistory, ReductionMeter } from '../components/Meters';
import { css } from '../graph';
import { useCanvas } from '../useCanvas';
import type { EditorProps } from './types';

const CURVE_MIN = -60;

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
}: {
    thresholdDb: number;
    ratio: number;
    kneeDb: number;
    makeupDb: number;
    color: string;
    reduction: (telemetry: Telemetry) => number;
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
        [thresholdDb, ratio, kneeDb, makeupDb, color],
    );
    return <canvas ref={ref} className="transfer-canvas" />;
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
                />
                <DynamicsHistory reduction={reduction} color={color} thresholdDb={p.thresholdDb} />
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
