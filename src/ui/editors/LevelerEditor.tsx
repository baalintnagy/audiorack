import { useRef } from 'react';
import { LEVELER_FIELDS } from '../../dsp/kernels/leveler';
import { SPECS } from '../../shared/effects';
import { ControlGroup, Segmented } from '../components/Controls';
import { Knob } from '../components/Knob';
import { drawHandleLine } from '../display/draw';
import { LINE_GRAB, settingHandle } from '../display/handles';
import { drawLevelGrid, strokeHistory } from '../display/history';
import { useCanvasDrag } from '../display/pointer';
import { formatValue } from '../format';
import { css, withAlpha } from '../graph';
import { useTelemetry } from '../telemetry';
import { useCanvas } from '../useCanvas';
import type { EditorProps } from './types';

/** One minute of history at the 30 fps telemetry rate. */
const HISTORY_LENGTH = 1800;
const LEVEL_MIN = -60;
const LEVEL_MAX = 0;
/** A reading for silence, below the history's range. */
const SILENT = -120;

const TARGETS = [
    { value: -14, label: '-14', title: 'Music, as streaming services play it' },
    { value: -16, label: '-16', title: 'Podcasts' },
    { value: -18, label: '-18', title: 'Speech and video' },
    { value: -23, label: '-23', title: 'EBU R128 broadcast' },
];

interface LevelerHistory {
    input: Float32Array;
    output: Float32Array;
    position: number;
}

type Readings = number[];

/**
 * Input and output loudness over the last minute, with the target and the gate as lines that
 * can be dragged.
 */
function HistoryView({
    history,
    latest,
    targetLufs,
    gateLufs,
    color,
    onChange,
}: {
    history: LevelerHistory;
    latest: () => Readings | undefined;
    targetLufs: number;
    gateLufs: number;
    color: string;
    onChange: (patch: { targetLufs?: number; gateLufs?: number }) => void;
}) {
    const toY = (lufs: number, height: number) =>
        ((LEVEL_MAX - Math.max(LEVEL_MIN, Math.min(LEVEL_MAX, lufs))) / (LEVEL_MAX - LEVEL_MIN)) *
        height;
    const fromY = (y: number, height: number) => LEVEL_MAX - (y / height) * (LEVEL_MAX - LEVEL_MIN);

    const { handlers: pointer, hot } = useCanvasDrag(({ y, height }) => {
        const line = (
            [
                ['target', SPECS.levelerTargetLufs, targetLufs],
                ['gate', SPECS.levelerGateLufs, gateLufs],
            ] as const
        ).find(([, , value]) => Math.abs(y - toY(value, height)) <= LINE_GRAB);
        if (!line) {
            return undefined;
        }
        const [id, spec, value] = line;
        return settingHandle({
            id,
            cursor: 'ns-resize',
            spec,
            value,
            toValue: (to) => fromY(to.y, height),
            onChange: (next) =>
                onChange(id === 'target' ? { targetLufs: next } : { gateLufs: next }),
        });
    });

    const ref = useCanvas(
        ({ ctx, width, height }) => {
            const y = (lufs: number) => toY(lufs, height);
            drawLevelGrid(ctx, width, y, { min: LEVEL_MIN, max: LEVEL_MAX, step: 6 });
            ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
            const lineAt = (lufs: number) => {
                const at = Math.round(y(lufs)) + 0.5;
                return [
                    [0, at],
                    [width, at],
                ] as [number, number][];
            };
            // Nothing is lifted below the gate.
            ctx.fillStyle = 'rgb(0 0 0 / 22%)';
            ctx.fillRect(0, y(gateLufs), width, height - y(gateLufs));
            drawHandleLine(ctx, lineAt(gateLufs), {
                color,
                base: css('--grid-strong'),
                hot: hot === 'gate',
            });
            drawHandleLine(ctx, lineAt(targetLufs), {
                color,
                base: withAlpha(color, 0.8),
                hot: hot === 'target',
            });
            ctx.textAlign = 'right';
            ctx.fillStyle = color;
            ctx.fillText(`target ${targetLufs.toFixed(1)}`, width - 6, y(targetLufs) - 4);
            ctx.fillStyle = css('--grid-label');
            ctx.fillText(`gate ${gateLufs.toFixed(0)}`, width - 6, y(gateLufs) - 4);
            ctx.textAlign = 'start';

            ctx.strokeStyle = css('--history-level-top');
            ctx.lineWidth = 1;
            strokeHistory(ctx, history.input, history.position, width, y, LEVEL_MIN);
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.shadowColor = color;
            ctx.shadowBlur = 6;
            strokeHistory(ctx, history.output, history.position, width, y, LEVEL_MIN);
            ctx.shadowBlur = 0;

            const readings = latest();
            const level = (field: number) =>
                readings && readings[field] > SILENT ? readings[field].toFixed(1) : '—';
            ctx.fillStyle = css('--grid-label');
            ctx.fillText(
                `in ${level(LEVELER_FIELDS.input)} · out ${level(LEVELER_FIELDS.output)} LUFS`,
                30,
                14,
            );
            ctx.fillText('input (thin), output (bold) · last minute', 30, height - 6);
        },
        [color, targetLufs, gateLufs, hot],
    );
    return (
        <canvas
            ref={ref}
            className="history-canvas"
            title="Drag the target or the gate line"
            {...pointer}
        />
    );
}

/**
 * The gain the leveler applies, as a bar from zero: up for a boost, down for a cut, with the
 * largest boost and cut marked.
 */
function GainMeter({
    latest,
    maxBoostDb,
    maxCutDb,
    color,
}: {
    latest: () => Readings | undefined;
    maxBoostDb: number;
    maxCutDb: number;
    color: string;
}) {
    const range = SPECS.maxBoostDb.max;
    const ref = useCanvas(
        ({ ctx, width, height }) => {
            const top = 26;
            const bottom = height - 10;
            const toY = (db: number) => top + ((range - db) / (2 * range)) * (bottom - top);
            const left = width / 2 - 8;
            ctx.fillStyle = css('--meter-bg');
            ctx.fillRect(left, top, 16, bottom - top);
            const gain = latest()?.[LEVELER_FIELDS.gain] ?? 0;
            const zero = toY(0);
            ctx.fillStyle = gain >= 0 ? color : css('--meter-high');
            ctx.fillRect(left, Math.min(zero, toY(gain)), 16, Math.abs(toY(gain) - zero));
            ctx.strokeStyle = css('--grid-strong');
            ctx.beginPath();
            ctx.moveTo(left - 4, Math.round(zero) + 0.5);
            ctx.lineTo(left + 20, Math.round(zero) + 0.5);
            ctx.stroke();
            ctx.setLineDash([2, 2]);
            ctx.strokeStyle = css('--grid-label');
            [maxBoostDb, -maxCutDb].forEach((limit) => {
                const y = Math.round(toY(limit)) + 0.5;
                ctx.beginPath();
                ctx.moveTo(left - 4, y);
                ctx.lineTo(left + 20, y);
                ctx.stroke();
            });
            ctx.setLineDash([]);
            ctx.fillStyle = css('--text');
            ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(formatValue(SPECS.utilityGainDb, gain), width / 2, 16);
            ctx.textAlign = 'start';
        },
        [color, maxBoostDb, maxCutDb],
    );
    return <canvas ref={ref} className="leveler-gain" title="The gain applied now" />;
}

export function LevelerEditor({ effect, setParams, color }: EditorProps<'leveler'>) {
    const p = effect.params;
    const history = useRef<LevelerHistory>({
        input: new Float32Array(HISTORY_LENGTH).fill(SILENT),
        output: new Float32Array(HISTORY_LENGTH).fill(SILENT),
        position: 0,
    });
    const latest = useRef<Readings | undefined>(undefined);
    useTelemetry((telemetry) => {
        const data = telemetry.meters.effects[effect.id];
        // Without readings, as while bypassed, nothing is levelled: the history runs on in
        // silence and the gain reads zero.
        latest.current = data && data.length > LEVELER_FIELDS.output ? data : undefined;
        const h = history.current;
        h.input[h.position] = latest.current?.[LEVELER_FIELDS.input] ?? SILENT;
        h.output[h.position] = latest.current?.[LEVELER_FIELDS.output] ?? SILENT;
        h.position = (h.position + 1) % HISTORY_LENGTH;
    });
    const read = () => latest.current;
    return (
        <div className="editor leveler-editor">
            <div className="display split">
                <HistoryView
                    history={history.current}
                    latest={read}
                    targetLufs={p.targetLufs}
                    gateLufs={p.gateLufs}
                    color={color}
                    onChange={setParams}
                />
                <GainMeter
                    latest={read}
                    maxBoostDb={p.maxBoostDb}
                    maxCutDb={p.maxCutDb}
                    color={color}
                />
            </div>
            <div className="control-row">
                <ControlGroup title="Target">
                    <div className="stack">
                        <Segmented
                            value={TARGETS.find((item) => item.value === p.targetLufs)?.value ?? 0}
                            options={TARGETS}
                            onChange={(targetLufs) => setParams({ targetLufs })}
                            color={color}
                        />
                    </div>
                    <Knob
                        spec={SPECS.levelerTargetLufs}
                        value={p.targetLufs}
                        onChange={(targetLufs) => setParams({ targetLufs })}
                        color={color}
                    />
                </ControlGroup>
                <ControlGroup title="Speed">
                    <div className="stack">
                        <Segmented
                            value={p.fast ? 'fast' : 'slow'}
                            options={[
                                {
                                    value: 'slow',
                                    label: 'Slow',
                                    title: 'Rides the level over seconds, keeping the dynamics',
                                },
                                {
                                    value: 'fast',
                                    label: 'Fast',
                                    title: 'Reacts within milliseconds, like a compressor that also lifts',
                                },
                            ]}
                            onChange={(mode) => setParams({ fast: mode === 'fast' })}
                            color={color}
                            vertical
                        />
                    </div>
                    {p.fast ? (
                        <Knob
                            spec={SPECS.levelerFastResponse}
                            value={p.fastResponseMs}
                            onChange={(fastResponseMs) => setParams({ fastResponseMs })}
                            color={color}
                        />
                    ) : (
                        <Knob
                            spec={SPECS.levelerResponse}
                            value={p.responseS}
                            onChange={(responseS) => setParams({ responseS })}
                            color={color}
                        />
                    )}
                </ControlGroup>
                <ControlGroup title="Limits">
                    <Knob
                        spec={SPECS.maxBoostDb}
                        value={p.maxBoostDb}
                        onChange={(maxBoostDb) => setParams({ maxBoostDb })}
                        color={color}
                    />
                    <Knob
                        spec={SPECS.maxCutDb}
                        value={p.maxCutDb}
                        onChange={(maxCutDb) => setParams({ maxCutDb })}
                        color={color}
                    />
                </ControlGroup>
                <ControlGroup title="Gate">
                    <Knob
                        spec={SPECS.levelerGateLufs}
                        value={p.gateLufs}
                        onChange={(gateLufs) => setParams({ gateLufs })}
                        color={color}
                    />
                </ControlGroup>
                <div className="control-note">Add a limiter after it to catch peaks.</div>
            </div>
        </div>
    );
}
