import { useRef } from 'react';
import { LOUDNESS_FIELDS } from '../../dsp/kernels/loudness';
import { SPECS } from '../../shared/effects';
import { ControlGroup, Segmented } from '../components/Controls';
import { Knob } from '../components/Knob';
import { formatLoudness } from '../components/Meters';
import { drawHandleLine } from '../display/draw';
import { LINE_GRAB, settingHandle } from '../display/handles';
import { useCanvasDrag } from '../display/pointer';
import { css, withAlpha } from '../graph';
import { useTelemetry } from '../telemetry';
import { useCanvas } from '../useCanvas';
import type { EditorProps } from './types';

/** One minute of history at the 30 fps telemetry rate. */
const HISTORY_LENGTH = 1800;
const HISTORY_MIN = -54;
const HISTORY_MAX = 0;
/** Integrated loudness within this distance of the target counts as on target. */
const TOLERANCE_LU = 1;
/** The usual true-peak limit for streaming and broadcast delivery. */
const TRUE_PEAK_LIMIT = -1;

const TARGETS = [
    { value: -14, label: '-14', title: 'Music streaming services' },
    { value: -16, label: '-16', title: 'Podcasts and spoken word' },
    { value: -23, label: '-23', title: 'EBU R128 broadcast' },
    { value: -24, label: '-24', title: 'ATSC A/85 broadcast (US)' },
];

type Readings = number[];

function formatDuration(seconds: number): string {
    const whole = Math.floor(seconds);
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const rest = String(whole % 60).padStart(2, '0');
    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
        : `${minutes}:${rest}`;
}

/** Momentary and short-term loudness over the last minute, against the target. */
function LoudnessHistory({
    history,
    target,
    color,
    latest,
    onTarget,
}: {
    history: { momentary: Float32Array; shortTerm: Float32Array; position: number };
    target: number;
    color: string;
    latest: () => Readings | undefined;
    /** Makes the target line draggable. */
    onTarget: (targetLufs: number) => void;
}) {
    const { handlers: pointer, hot } = useCanvasDrag(({ y, height }) => {
        const targetY = ((HISTORY_MAX - target) / (HISTORY_MAX - HISTORY_MIN)) * height;
        if (Math.abs(y - targetY) > LINE_GRAB) {
            return undefined;
        }
        return settingHandle({
            id: 'line',
            cursor: 'ns-resize',
            spec: SPECS.targetLufs,
            value: target,
            toValue: (to) => HISTORY_MAX - (to.y / height) * (HISTORY_MAX - HISTORY_MIN),
            onChange: onTarget,
        });
    });

    const ref = useCanvas(
        ({ ctx, width, height }) => {
            const toY = (lufs: number) =>
                ((HISTORY_MAX - Math.max(HISTORY_MIN, Math.min(HISTORY_MAX, lufs))) /
                    (HISTORY_MAX - HISTORY_MIN)) *
                height;
            ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
            ctx.lineWidth = 1;
            for (let lufs = HISTORY_MAX - 6; lufs > HISTORY_MIN; lufs -= 6) {
                const y = Math.round(toY(lufs)) + 0.5;
                ctx.strokeStyle = css('--grid');
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                ctx.stroke();
                ctx.fillStyle = css('--grid-label');
                ctx.fillText(`${lufs}`, 4, y - 2);
            }
            // Target with its tolerance band.
            ctx.fillStyle = withAlpha(color, 0.1);
            const bandTop = toY(target + TOLERANCE_LU);
            ctx.fillRect(0, bandTop, width, toY(target - TOLERANCE_LU) - bandTop);
            const targetY = Math.round(toY(target)) + 0.5;
            drawHandleLine(
                ctx,
                [
                    [0, targetY],
                    [width, targetY],
                ],
                { color, base: withAlpha(color, 0.8), hot: hot === 'line' },
            );
            ctx.fillStyle = color;
            ctx.textAlign = 'right';
            ctx.fillText(`target ${target.toFixed(1)}`, width - 6, toY(target) - 4);
            ctx.textAlign = 'start';
            const step = width / (HISTORY_LENGTH - 1);
            const at = (index: number) => (history.position + index) % HISTORY_LENGTH;
            const trace = (values: Float32Array) => {
                ctx.beginPath();
                let drawing = false;
                for (let index = 0; index < HISTORY_LENGTH; index++) {
                    const value = values[at(index)];
                    if (value <= HISTORY_MIN) {
                        drawing = false;
                        continue;
                    }
                    const x = index * step;
                    if (drawing) {
                        ctx.lineTo(x, toY(value));
                    } else {
                        ctx.moveTo(x, toY(value));
                        drawing = true;
                    }
                }
                ctx.stroke();
            };
            ctx.strokeStyle = css('--history-level-top');
            ctx.lineWidth = 1;
            trace(history.momentary);
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.shadowColor = color;
            ctx.shadowBlur = 6;
            trace(history.shortTerm);
            ctx.shadowBlur = 0;
            const integrated = latest()?.[LOUDNESS_FIELDS.integrated];
            if (integrated !== undefined && integrated > HISTORY_MIN) {
                const y = Math.round(toY(integrated)) + 0.5;
                ctx.strokeStyle = css('--text');
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(width - 40, y);
                ctx.lineTo(width, y);
                ctx.stroke();
                ctx.fillStyle = css('--text');
                ctx.textAlign = 'right';
                ctx.fillText('I', width - 44, y + 3);
                ctx.textAlign = 'start';
            }
            ctx.fillStyle = css('--grid-label');
            ctx.fillText('short-term (bold), momentary · last minute', 30, height - 6);
        },
        [color, target, hot],
    );
    return (
        <canvas
            ref={ref}
            className="history-canvas"
            title="Drag the target line to change the target"
            {...pointer}
        />
    );
}

/** The numeric readings, with the integrated loudness largest. */
function LoudnessReadouts({
    target,
    color,
    latest,
}: {
    target: number;
    color: string;
    latest: () => Readings | undefined;
}) {
    const ref = useCanvas(
        ({ ctx, width }) => {
            const r = latest();
            const value = (field: number) => r?.[field] ?? -120;
            const padding = 14;
            const integrated = value(LOUDNESS_FIELDS.integrated);
            const measured = integrated > -99;
            const offTarget = integrated - target;
            ctx.fillStyle = css('--text-dim');
            ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
            ctx.fillText('INTEGRATED', padding, 20);
            ctx.textAlign = 'right';
            ctx.fillText(formatDuration(r?.[LOUDNESS_FIELDS.seconds] ?? 0), width - padding, 20);
            ctx.textAlign = 'start';
            ctx.fillStyle = !measured
                ? css('--text-dim')
                : Math.abs(offTarget) <= TOLERANCE_LU
                  ? css('--meter-low')
                  : css('--meter-high');
            ctx.font = '600 34px ui-sans-serif, system-ui, sans-serif';
            ctx.fillText(formatLoudness(integrated), padding, 56);
            ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
            ctx.fillStyle = css('--text-dim');
            ctx.fillText(
                measured
                    ? `LUFS · ${offTarget >= 0 ? '+' : ''}${offTarget.toFixed(1)} LU from target`
                    : 'LUFS · waiting for audio',
                padding,
                74,
            );
            const rows: [string, string, string, boolean][] = [
                ['Short-term', formatLoudness(value(LOUDNESS_FIELDS.shortTerm)), 'LUFS', false],
                ['Momentary', formatLoudness(value(LOUDNESS_FIELDS.momentary)), 'LUFS', false],
                // A spread, not a level: without readings there is no range to show at all.
                ['Range', r ? r[LOUDNESS_FIELDS.range].toFixed(1) : '—', 'LU', false],
                [
                    'True peak max',
                    formatLoudness(value(LOUDNESS_FIELDS.maxTruePeak)),
                    'dBTP',
                    value(LOUDNESS_FIELDS.maxTruePeak) > TRUE_PEAK_LIMIT,
                ],
                [
                    'Short-term max',
                    formatLoudness(value(LOUDNESS_FIELDS.maxShortTerm)),
                    'LUFS',
                    false,
                ],
                [
                    'Momentary max',
                    formatLoudness(value(LOUDNESS_FIELDS.maxMomentary)),
                    'LUFS',
                    false,
                ],
            ];
            rows.forEach(([label, text, unit, warn], index) => {
                const y = 104 + index * 22;
                ctx.fillStyle = css('--text-dim');
                ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
                ctx.fillText(label, padding, y);
                ctx.textAlign = 'right';
                ctx.fillStyle = css('--text-faint');
                ctx.fillText(unit, width - padding, y);
                ctx.fillStyle = warn ? css('--meter-clip') : css('--text');
                ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif';
                ctx.fillText(text, width - padding - 36, y);
                ctx.textAlign = 'start';
            });
            ctx.fillStyle = color;
            ctx.fillRect(padding, 84, 28, 2);
        },
        [color, target],
    );
    return <canvas ref={ref} className="loudness-readouts" />;
}

export function LoudnessEditor({ effect, setParams, color }: EditorProps<'loudness'>) {
    const p = effect.params;
    const latest = useRef<Readings | undefined>(undefined);
    const history = useRef({
        momentary: new Float32Array(HISTORY_LENGTH).fill(-120),
        shortTerm: new Float32Array(HISTORY_LENGTH).fill(-120),
        position: 0,
    });
    useTelemetry((telemetry) => {
        const data = telemetry.meters.effects[effect.id];
        const h = history.current;
        if (!data || data.length <= LOUDNESS_FIELDS.seconds) {
            // Without readings, as while bypassed, nothing is measured: the readouts clear and
            // the history runs on in silence.
            latest.current = undefined;
            h.momentary[h.position] = -120;
            h.shortTerm[h.position] = -120;
            h.position = (h.position + 1) % HISTORY_LENGTH;
            return;
        }
        const previous = latest.current?.[LOUDNESS_FIELDS.seconds] ?? 0;
        if (data[LOUDNESS_FIELDS.seconds] < previous) {
            // The measurement was reset; start the history over too.
            h.momentary.fill(-120);
            h.shortTerm.fill(-120);
        }
        latest.current = data;
        h.momentary[h.position] = data[LOUDNESS_FIELDS.momentary];
        h.shortTerm[h.position] = data[LOUDNESS_FIELDS.shortTerm];
        h.position = (h.position + 1) % HISTORY_LENGTH;
    });
    const read = () => latest.current;
    return (
        <div className="editor analyzer-editor loudness-editor">
            <div className="display split">
                <LoudnessHistory
                    history={history.current}
                    target={p.targetLufs}
                    color={color}
                    latest={read}
                    onTarget={(targetLufs) => setParams({ targetLufs })}
                />
                <LoudnessReadouts target={p.targetLufs} color={color} latest={read} />
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
                        spec={SPECS.targetLufs}
                        value={p.targetLufs}
                        onChange={(targetLufs) => setParams({ targetLufs })}
                        color={color}
                    />
                </ControlGroup>
                <ControlGroup title="Measurement">
                    <button
                        type="button"
                        className="ghost"
                        title="Start the integrated loudness, range and maximum readings over"
                        onClick={() => setParams({ resets: p.resets + 1 })}
                    >
                        Reset
                    </button>
                </ControlGroup>
                <div className="control-note">
                    EBU R128 / ITU-R BS.1770 metering. Integrated loudness and range cover
                    everything played through the rack since the last reset, with the standard
                    gating; true peak is measured with 4× oversampling and turns red above{' '}
                    {TRUE_PEAK_LIMIT} dBTP.
                </div>
            </div>
        </div>
    );
}
