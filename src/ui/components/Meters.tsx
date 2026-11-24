import { useRef } from 'react';
import type { Telemetry } from '../../shared/messages';
import { css } from '../graph';
import { gainToDbValue } from '../format';
import { useTelemetry } from '../telemetry';
import { useCanvas } from '../useCanvas';

const METER_MIN = -60;
const METER_MAX = 6;
const HOLD_FRAMES = 45;

function meterY(db: number, height: number) {
    const clamped = Math.min(METER_MAX, Math.max(METER_MIN, db));
    return height - ((clamped - METER_MIN) / (METER_MAX - METER_MIN)) * height;
}

interface Hold {
    value: number;
    age: number;
}

/** Stereo peak/RMS meter with peak hold. */
export function LevelMeter({
    label,
    source,
}: {
    label: string;
    source: (telemetry: Telemetry) => { peak: [number, number]; rms: [number, number] };
}) {
    const holds = useRef<Hold[]>([
        { value: -120, age: 0 },
        { value: -120, age: 0 },
    ]);
    const smoothed = useRef<[number, number]>([-120, -120]);
    const readout = useRef<HTMLSpanElement>(null);
    const ref = useCanvas(({ ctx, width, height, telemetry, live, ticks }) => {
        const barWidth = (width - 3) / 2;
        const levels = telemetry ? source(telemetry) : { peak: [0, 0], rms: [0, 0] };
        const gradient = ctx.createLinearGradient(0, height, 0, 0);
        gradient.addColorStop(0, css('--meter-low'));
        gradient.addColorStop(0.72, css('--meter-mid'));
        gradient.addColorStop(0.88, css('--meter-high'));
        gradient.addColorStop(0.91, css('--meter-clip'));
        gradient.addColorStop(1, css('--meter-clip'));
        ctx.fillStyle = css('--meter-bg');
        ctx.fillRect(0, 0, width, height);
        [0, 1].forEach((channel) => {
            const x = channel * (barWidth + 3);
            const peakDb = gainToDbValue(levels.peak[channel]);
            const rmsDb = gainToDbValue(levels.rms[channel]);
            // Fast attack, slower visual decay.
            const previous = smoothed.current[channel];
            const shown = live ? Math.max(peakDb, previous - 1.2 * ticks) : previous;
            smoothed.current[channel] = shown;
            const hold = holds.current[channel];
            if (live) {
                hold.age += ticks;
                if (peakDb >= hold.value || hold.age > HOLD_FRAMES) {
                    hold.value = peakDb;
                    hold.age = 0;
                }
            }
            ctx.globalAlpha = 0.45;
            ctx.fillStyle = gradient;
            const peakY = meterY(shown, height);
            ctx.fillRect(x, peakY, barWidth, height - peakY);
            ctx.globalAlpha = 1;
            const rmsY = meterY(rmsDb, height);
            ctx.fillRect(x, rmsY, barWidth, height - rmsY);
            if (hold.value > METER_MIN) {
                ctx.fillStyle = hold.value > 0 ? css('--meter-clip') : css('--text');
                ctx.fillRect(x, meterY(hold.value, height) - 1, barWidth, 2);
            }
        });
        ctx.fillStyle = css('--meter-tick');
        [0, -6, -12, -18, -24, -36, -48].forEach((db) => {
            ctx.fillRect(0, Math.round(meterY(db, height)), width, 1);
        });
        if (readout.current) {
            const max = Math.max(holds.current[0].value, holds.current[1].value);
            readout.current.textContent = max <= -99 ? '-∞' : max.toFixed(1);
            readout.current.classList.toggle('clip', max > 0);
        }
    }, []);
    return (
        <div className="level-meter">
            <span className="meter-label">{label}</span>
            <canvas ref={ref} className="meter-canvas" />
            <span className="meter-readout" ref={readout}>
                -∞
            </span>
        </div>
    );
}

/** Vertical gain reduction bar growing downwards. */
export function ReductionMeter({
    value,
    label = 'GR',
    range = 24,
    color,
}: {
    value: (telemetry: Telemetry) => number;
    label?: string;
    range?: number;
    color?: string;
}) {
    const readout = useRef<HTMLSpanElement>(null);
    const shown = useRef(0);
    const ref = useCanvas(
        ({ ctx, width, height, telemetry, live, ticks }) => {
            const reduction = telemetry ? value(telemetry) : 0;
            if (live) {
                const keep = Math.pow(0.85, ticks);
                shown.current = Math.max(reduction, shown.current * keep + reduction * (1 - keep));
            }
            ctx.fillStyle = css('--meter-bg');
            ctx.fillRect(0, 0, width, height);
            const barHeight = (Math.min(range, shown.current) / range) * height;
            ctx.fillStyle = color ?? css('--reduction');
            ctx.fillRect(0, 0, width, barHeight);
            ctx.fillStyle = css('--meter-tick');
            for (let db = 3; db < range; db += 3) {
                ctx.fillRect(0, Math.round((db / range) * height), width, 1);
            }
            if (readout.current) {
                readout.current.textContent =
                    shown.current < 0.05 ? '0.0' : `-${shown.current.toFixed(1)}`;
            }
        },
        [range, color],
    );
    return (
        <div className="reduction-meter">
            <span className="meter-label">{label}</span>
            <canvas ref={ref} className="meter-canvas" />
            <span className="meter-readout" ref={readout}>
                0.0
            </span>
        </div>
    );
}

const HISTORY_LENGTH = 240;

/**
 * Scrolling history of the rack output level and an effect's gain reduction, similar to
 * the level displays of hardware dynamics processors.
 */
export function DynamicsHistory({
    reduction,
    color,
    thresholdDb,
    range = 48,
    level = (telemetry) => Math.max(...telemetry.meters.outputPeak),
}: {
    reduction: (telemetry: Telemetry) => number;
    color: string;
    thresholdDb?: number;
    range?: number;
    level?: (telemetry: Telemetry) => number;
}) {
    const history = useRef({
        levels: new Float32Array(HISTORY_LENGTH).fill(-120),
        reductions: new Float32Array(HISTORY_LENGTH),
        position: 0,
    });
    // Record every reading, even when several arrive between animation frames.
    useTelemetry((telemetry) => {
        const h = history.current;
        h.levels[h.position] = gainToDbValue(level(telemetry));
        h.reductions[h.position] = reduction(telemetry);
        h.position = (h.position + 1) % HISTORY_LENGTH;
    });
    const ref = useCanvas(
        ({ ctx, width, height }) => {
            const h = history.current;
            const toY = (db: number) => (-Math.max(-range, Math.min(0, db)) / range) * height;
            ctx.strokeStyle = css('--grid');
            ctx.fillStyle = css('--grid-label');
            ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
            for (let db = -6; db > -range; db -= 6) {
                const y = Math.round(toY(db)) + 0.5;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                ctx.stroke();
                ctx.fillText(`${db}`, 4, y - 2);
            }
            const step = width / (HISTORY_LENGTH - 1);
            const at = (index: number) => (h.position + index) % HISTORY_LENGTH;
            ctx.beginPath();
            ctx.moveTo(0, height);
            for (let index = 0; index < HISTORY_LENGTH; index++) {
                ctx.lineTo(index * step, toY(h.levels[at(index)]));
            }
            ctx.lineTo(width, height);
            ctx.closePath();
            const levelGradient = ctx.createLinearGradient(0, 0, 0, height);
            levelGradient.addColorStop(0, css('--history-level-top'));
            levelGradient.addColorStop(1, css('--history-level-bottom'));
            ctx.fillStyle = levelGradient;
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(0, 0);
            for (let index = 0; index < HISTORY_LENGTH; index++) {
                ctx.lineTo(index * step, toY(-h.reductions[at(index)]));
            }
            ctx.lineTo(width, 0);
            ctx.closePath();
            ctx.fillStyle = `${color}33`;
            ctx.fill();
            ctx.beginPath();
            for (let index = 0; index < HISTORY_LENGTH; index++) {
                const y = toY(-h.reductions[at(index)]);
                if (index === 0) {
                    ctx.moveTo(0, y);
                } else {
                    ctx.lineTo(index * step, y);
                }
            }
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.shadowColor = color;
            ctx.shadowBlur = 6;
            ctx.stroke();
            ctx.shadowBlur = 0;
            if (thresholdDb !== undefined) {
                const y = Math.round(toY(thresholdDb)) + 0.5;
                ctx.setLineDash([4, 4]);
                ctx.strokeStyle = css('--threshold');
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        },
        [color, thresholdDb, range],
    );
    return <canvas ref={ref} className="history-canvas" />;
}

const LOUDNESS_MIN = -48;
const LOUDNESS_MAX = 0;

/** Formats a loudness reading, with silence as minus infinity. */
export function formatLoudness(lufs: number): string {
    return lufs <= -99 ? '-∞' : lufs.toFixed(1);
}

/**
 * Horizontal momentary loudness bar with a short-term marker, both in LUFS, and an optional
 * target tick.
 */
export function LoudnessBar({
    source,
    color,
    target,
}: {
    source: (telemetry: Telemetry) => { momentary: number; shortTerm: number } | undefined;
    color: string;
    target?: number;
}) {
    const readout = useRef<HTMLSpanElement>(null);
    const shown = useRef(LOUDNESS_MIN);
    const ref = useCanvas(
        ({ ctx, width, height, telemetry, live, ticks }) => {
            const reading = telemetry ? source(telemetry) : undefined;
            const momentary = reading?.momentary ?? -120;
            const shortTerm = reading?.shortTerm ?? -120;
            if (live) {
                shown.current = Math.max(momentary, shown.current - 0.6 * ticks);
            }
            const toX = (lufs: number) =>
                ((Math.max(LOUDNESS_MIN, Math.min(LOUDNESS_MAX, lufs)) - LOUDNESS_MIN) /
                    (LOUDNESS_MAX - LOUDNESS_MIN)) *
                width;
            ctx.fillStyle = css('--meter-bg');
            ctx.fillRect(0, 0, width, height);
            const gradient = ctx.createLinearGradient(0, 0, width, 0);
            gradient.addColorStop(0, `${color}55`);
            gradient.addColorStop(1, color);
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, toX(shown.current), height);
            ctx.fillStyle = css('--meter-tick');
            for (let lufs = LOUDNESS_MIN + 6; lufs < LOUDNESS_MAX; lufs += 6) {
                ctx.fillRect(Math.round(toX(lufs)), 0, 1, height);
            }
            if (target !== undefined) {
                ctx.fillStyle = css('--threshold');
                ctx.fillRect(Math.round(toX(target)) - 1, 0, 2, height);
            }
            if (shortTerm > LOUDNESS_MIN) {
                ctx.fillStyle = css('--text');
                ctx.fillRect(Math.round(toX(shortTerm)) - 1, 0, 2, height);
            }
            if (readout.current) {
                readout.current.textContent = `M ${formatLoudness(momentary)} · S ${formatLoudness(shortTerm)}`;
            }
        },
        [color, target],
    );
    return (
        <div className="loudness-bar">
            <canvas ref={ref} className="loudness-bar-canvas" />
            <span className="loudness-bar-readout" ref={readout}>
                M -∞ · S -∞
            </span>
        </div>
    );
}
