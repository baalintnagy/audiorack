import { useRef } from 'react';
import { DENOISER_FIELDS, DENOISER_POINTS } from '../../dsp/kernels/denoiser';
import { NOISE_PROFILE_BANDS, SPECS } from '../../shared/effects';
import type { Telemetry } from '../../shared/messages';
import { logFrequencies } from '../../shared/spectrum';
import { ControlGroup, Segmented, Toggle } from '../components/Controls';
import { Knob } from '../components/Knob';
import { ReductionMeter } from '../components/Meters';
import { LINE_GRAB, specValue, useCanvasDrag, wheelStep } from '../canvasDrag';
import { css, drawGrid, drawGrip, frequencyToX, withAlpha, xToFrequency } from '../graph';
import { useTelemetry } from '../telemetry';
import { useCanvas } from '../useCanvas';
import type { EditorProps } from './types';

const FREQUENCIES = logFrequencies(DENOISER_POINTS);
const FLOOR_DB = -120;
const CEILING_DB = -10;
/** The reduction curve hangs from the top and uses this share of the height at 40 dB. */
const REDUCTION_HEIGHT = 0.45;

interface Curves {
    input: Float32Array;
    noise: Float32Array;
    gain: Float32Array;
}

function toY(db: number, height: number) {
    return (
        height -
        ((Math.max(FLOOR_DB, Math.min(CEILING_DB, db)) - FLOOR_DB) / (CEILING_DB - FLOOR_DB)) *
            height
    );
}

/** Height of the reduction curve, hanging from the top, for a gain in dB. */
function reductionY(gainDb: number, height: number) {
    return (Math.min(40, -gainDb) / 40) * height * REDUCTION_HEIGHT;
}

/** The noise level at a horizontal position, from the nearest analysis point. */
function noiseAt(noise: Float32Array, x: number, width: number) {
    const frequency = xToFrequency(x, width);
    const index = FREQUENCIES.reduce(
        (best, value, i) =>
            Math.abs(Math.log(value / frequency)) <
            Math.abs(Math.log(FREQUENCIES[best] / frequency))
                ? i
                : best,
        0,
    );
    return noise[index];
}

/**
 * Input spectrum, noise floor (adaptive or profile) and the reduction at each frequency. The
 * line of the largest reduction and the pass curve (noise plus threshold) can be dragged.
 */
function NoiseDisplay({
    id,
    color,
    noiseLabel,
    learning,
    reductionDb,
    thresholdDb,
    onChange,
}: {
    id: string;
    color: string;
    noiseLabel: string;
    learning: boolean;
    reductionDb: number;
    thresholdDb: number;
    onChange: (patch: { reductionDb?: number; thresholdDb?: number }) => void;
}) {
    const curves = useRef<Curves>({
        input: new Float32Array(DENOISER_POINTS).fill(FLOOR_DB),
        noise: new Float32Array(DENOISER_POINTS).fill(FLOOR_DB),
        gain: new Float32Array(DENOISER_POINTS),
    });
    useTelemetry((telemetry) => {
        const data = telemetry.meters.effects[id];
        if (!data || data.length < DENOISER_FIELDS.gain + DENOISER_POINTS) {
            return;
        }
        const c = curves.current;
        for (let i = 0; i < DENOISER_POINTS; i++) {
            c.input[i] += (data[DENOISER_FIELDS.input + i] - c.input[i]) * 0.5;
            c.noise[i] = data[DENOISER_FIELDS.noise + i];
            c.gain[i] += (data[DENOISER_FIELDS.gain + i] - c.gain[i]) * 0.5;
        }
    });
    const ref = useCanvas(
        ({ ctx, width, height }) => {
            drawGrid(ctx, width, height);
            const c = curves.current;
            const y = (db: number) => toY(db, height);
            const xs = Array.from(FREQUENCIES, (frequency) => frequencyToX(frequency, width));
            // Input spectrum.
            ctx.beginPath();
            ctx.moveTo(0, height);
            xs.forEach((x, i) => ctx.lineTo(x, y(c.input[i])));
            ctx.lineTo(width, height);
            ctx.closePath();
            ctx.fillStyle = css('--spectrum-post');
            ctx.fill();
            // Noise floor.
            ctx.beginPath();
            xs.forEach((x, i) => {
                const py = y(c.noise[i]);
                if (i === 0) {
                    ctx.moveTo(x, py);
                } else {
                    ctx.lineTo(x, py);
                }
            });
            ctx.setLineDash([4, 3]);
            ctx.strokeStyle = css('--curve');
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.setLineDash([]);
            // Pass curve: bins this far above the noise are left alone.
            ctx.beginPath();
            xs.forEach((x, i) => {
                const py = y(c.noise[i] + thresholdDb);
                if (i === 0) {
                    ctx.moveTo(x, py);
                } else {
                    ctx.lineTo(x, py);
                }
            });
            ctx.strokeStyle = withAlpha(color, 0.6);
            ctx.lineWidth = 1;
            ctx.stroke();
            const passX = width * 0.9;
            drawGrip(ctx, passX, y(noiseAt(c.noise, passX, width) + thresholdDb), color);
            // Reduction, hanging from the top.
            const hang = (gainDb: number) => reductionY(gainDb, height);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            xs.forEach((x, i) => ctx.lineTo(x, hang(c.gain[i])));
            ctx.lineTo(width, 0);
            ctx.closePath();
            ctx.fillStyle = withAlpha(color, 0.25);
            ctx.fill();
            ctx.beginPath();
            xs.forEach((x, i) => {
                const py = hang(c.gain[i]);
                if (i === 0) {
                    ctx.moveTo(x, py);
                } else {
                    ctx.lineTo(x, py);
                }
            });
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.stroke();
            // The largest reduction allowed.
            const limitY = Math.round(hang(-reductionDb)) + 0.5;
            ctx.setLineDash([5, 4]);
            ctx.strokeStyle = css('--threshold');
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, limitY);
            ctx.lineTo(width, limitY);
            ctx.stroke();
            ctx.setLineDash([]);
            drawGrip(ctx, width - 14, limitY, color);
            ctx.fillStyle = css('--grid-label');
            ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(`max -${reductionDb.toFixed(1)} dB`, width - 26, limitY + 12);
            ctx.textAlign = 'start';
            ctx.fillText('reduction', 6, 14);
            ctx.fillText(`${noiseLabel} (dashed)`, 6, height - 18);
            if (learning) {
                ctx.fillStyle = color;
                ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('Learning the noise: play a stretch of noise only', width / 2, 40);
                ctx.textAlign = 'start';
            }
        },
        [color, noiseLabel, learning, reductionDb, thresholdDb],
    );
    const pointer = useCanvasDrag(({ x, y, width, height }) => {
        const setReduction = (value: number) =>
            onChange({ reductionDb: specValue(SPECS.denoiseReductionDb, value) });
        const setThreshold = (value: number) =>
            onChange({ thresholdDb: specValue(SPECS.denoiseThresholdDb, value) });
        if (Math.abs(y - reductionY(-reductionDb, height)) <= LINE_GRAB) {
            return {
                cursor: 'ns-resize',
                drag: (to) => setReduction((to.y / (height * REDUCTION_HEIGHT)) * 40),
                reset: () => setReduction(SPECS.denoiseReductionDb.default),
                wheel: (direction, fine) =>
                    setReduction(wheelStep(SPECS.denoiseReductionDb, reductionDb, direction, fine)),
            };
        }
        const passY = toY(noiseAt(curves.current.noise, x, width) + thresholdDb, height);
        if (Math.abs(y - passY) <= LINE_GRAB + 2) {
            const dbPerPixel = (CEILING_DB - FLOOR_DB) / height;
            return {
                cursor: 'ns-resize',
                // The noise moves on its own, so the drag is relative to where it started.
                drag: (to) => setThreshold(thresholdDb + (y - to.y) * dbPerPixel),
                reset: () => setThreshold(SPECS.denoiseThresholdDb.default),
                wheel: (direction, fine) =>
                    setThreshold(wheelStep(SPECS.denoiseThresholdDb, thresholdDb, direction, fine)),
            };
        }
        return undefined;
    });
    return (
        <canvas
            ref={ref}
            className="display-canvas"
            title="Drag the dashed line for the largest reduction, the pass curve above the noise for the threshold"
            {...pointer}
        />
    );
}

export function DenoiserEditor({ effect, setParams, color }: EditorProps<'denoiser'>) {
    const p = effect.params;
    const hasProfile = p.profile.length === NOISE_PROFILE_BANDS;
    const usesProfile = p.mode === 'profile' && hasProfile;
    // The profile being learned arrives with the readings; stopping saves the latest one.
    const learned = useRef<number[]>([]);
    const seconds = useRef<HTMLSpanElement>(null);
    useTelemetry((telemetry) => {
        const data = telemetry.meters.effects[effect.id];
        if (!data || data.length <= DENOISER_FIELDS.learnedSeconds) {
            return;
        }
        const profile = data.slice(DENOISER_FIELDS.profile);
        if (profile.length === NOISE_PROFILE_BANDS) {
            learned.current = profile;
        }
        if (seconds.current) {
            seconds.current.textContent = `${data[DENOISER_FIELDS.learnedSeconds].toFixed(1)} s`;
        }
    });
    const learn = (start: boolean) => {
        if (start) {
            learned.current = [];
            setParams({ learning: true });
        } else if (learned.current.length === NOISE_PROFILE_BANDS) {
            setParams({ learning: false, profile: learned.current, mode: 'profile' });
        } else {
            setParams({ learning: false });
        }
    };
    const reduction = (telemetry: Telemetry) =>
        telemetry.meters.effects[effect.id]?.[DENOISER_FIELDS.reduction] ?? 0;
    return (
        <div className="editor dynamics-editor">
            <div className="display split">
                <NoiseDisplay
                    id={effect.id}
                    color={color}
                    noiseLabel={usesProfile ? 'noise profile' : 'noise floor'}
                    learning={p.learning}
                    reductionDb={p.reductionDb}
                    thresholdDb={p.thresholdDb}
                    onChange={setParams}
                />
                <ReductionMeter value={reduction} color={color} range={24} />
            </div>
            <div className="control-row">
                <ControlGroup title="Reduction">
                    <Knob
                        spec={SPECS.denoiseReductionDb}
                        value={p.reductionDb}
                        onChange={(reductionDb) => setParams({ reductionDb })}
                        color={color}
                        size={64}
                    />
                    <Knob
                        spec={SPECS.denoiseThresholdDb}
                        value={p.thresholdDb}
                        onChange={(thresholdDb) => setParams({ thresholdDb })}
                        color={color}
                    />
                    <Knob
                        spec={SPECS.denoiseSmoothing}
                        value={p.smoothing}
                        onChange={(smoothing) => setParams({ smoothing })}
                        color={color}
                    />
                </ControlGroup>
                <ControlGroup title="Noise floor">
                    <div className="stack">
                        <Segmented
                            value={p.mode}
                            options={[
                                {
                                    value: 'adaptive',
                                    label: 'Adaptive',
                                    title: 'Follow the noise floor of the audio as it plays',
                                },
                                {
                                    value: 'profile',
                                    label: 'Profile',
                                    title: 'Remove the learned noise profile',
                                },
                            ]}
                            onChange={(mode) => setParams({ mode })}
                            color={color}
                        />
                        <div className="denoiser-learn">
                            <Toggle
                                active={p.learning}
                                onChange={learn}
                                color={color}
                                title={
                                    p.learning
                                        ? 'Stop and use what was learned as the noise profile'
                                        : 'Record the noise: start while only noise plays'
                                }
                            >
                                {p.learning ? 'Stop' : 'Learn noise'}
                                {p.learning && (
                                    <span className="denoiser-seconds" ref={seconds}>
                                        0.0 s
                                    </span>
                                )}
                            </Toggle>
                            {hasProfile && !p.learning && (
                                <button
                                    type="button"
                                    className="ghost small"
                                    title="Forget the learned noise profile"
                                    onClick={() => setParams({ profile: [], mode: 'adaptive' })}
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                    </div>
                </ControlGroup>
                <ControlGroup title="Monitor">
                    <div className="stack">
                        {!usesProfile && (
                            <Toggle
                                active={p.freeze}
                                onChange={(freeze) => setParams({ freeze })}
                                color={color}
                                title="Stop following the noise floor and keep the current one"
                            >
                                Freeze
                            </Toggle>
                        )}
                        <Toggle
                            active={p.listen}
                            onChange={(listen) => setParams({ listen })}
                            color={color}
                            title="Hear only what is removed"
                        >
                            Listen
                        </Toggle>
                    </div>
                </ControlGroup>
                <div className="control-note">
                    {usesProfile
                        ? 'Removes the learned noise profile. Learn a new one by pressing Learn noise while only the noise plays, then Stop.'
                        : p.mode === 'profile'
                          ? 'No profile yet: press Learn noise while only the noise plays, then Stop. Until then the noise floor adapts to the audio.'
                          : 'The noise floor follows the quietest moments of each frequency over the last two seconds. For steady noise under steady sounds, learn a profile instead.'}{' '}
                    Adds about 32 ms of latency.
                </div>
            </div>
        </div>
    );
}
