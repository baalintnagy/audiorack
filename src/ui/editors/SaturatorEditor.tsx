import { useRef, useState, type PointerEvent } from 'react';
import { saturate } from '../../dsp/kernels/saturator';
import {
    OVERSAMPLING_FACTORS,
    SATURATION_STYLES,
    SPECS,
    defaultSaturatorBand,
    type SaturationStyle,
    type SaturatorBand,
    type SaturatorParams,
} from '../../shared/effects';
import { ControlGroup, Segmented, Toggle } from '../components/Controls';
import { Knob } from '../components/Knob';
import { formatFrequency } from '../format';
import { css, drawGrid, drawSpectrum, frequencyToX, withAlpha, xToFrequency } from '../graph';
import { useCanvas } from '../useCanvas';
import { BAND_COLORS, type EditorProps } from './types';

const STYLE_LABELS: Record<SaturationStyle, string> = {
    tube: 'Tube',
    tape: 'Tape',
    soft: 'Soft',
    hard: 'Hard',
    fold: 'Fold',
    rectify: 'Rect',
};

const STYLE_TITLES: Record<SaturationStyle, string> = {
    tube: 'Asymmetric soft clipping: warm, even harmonics',
    tape: 'Gentle symmetric compression of peaks',
    soft: 'Smooth symmetric clipping',
    hard: 'Flat-topped clipping: bright, odd harmonics',
    fold: 'Wavefolding: peaks fold back down, metallic overtones',
    rectify: 'Full-wave rectifier: octave up, use with the mix',
};

/** Level into the curve, in dB, that fills the heat bar; 0 dB is where clipping starts. */
const HEAT_FLOOR = -24;
const HEAT_CEILING = 12;
const MIN_GAP = 1.25;

const CROSSOVER_PRESETS: Record<number, number[]> = {
    1: [],
    2: [300],
    3: [200, 3000],
    4: [150, 1500, 6000],
};

function bandLabel(index: number, count: number) {
    if (count === 1) {
        return 'Full';
    }
    if (count === 2) {
        return ['Low', 'High'][index];
    }
    if (count === 3) {
        return ['Low', 'Mid', 'High'][index];
    }
    return ['Low', 'Low Mid', 'High Mid', 'High'][index];
}

function bandColor(index: number) {
    return BAND_COLORS[(index + 1) % BAND_COLORS.length];
}

/** Changes the number of bands while keeping existing band settings where possible. */
export function withSaturatorBandCount(params: SaturatorParams, count: number): SaturatorParams {
    const bands = Array.from(
        { length: count },
        (_, index) => params.bands[index] ?? defaultSaturatorBand(),
    );
    return { ...params, crossovers: CROSSOVER_PRESETS[count], bands };
}

export function SaturatorEditor({ effect, setParams, color }: EditorProps<'saturator'>) {
    const p = effect.params;
    const [selected, setSelected] = useState(0);
    const shown = useRef<number[]>([]);
    const drag = useRef<number | undefined>(undefined);
    const width = useRef(1);
    const count = p.crossovers.length + 1;
    const bandIndex = Math.min(selected, count - 1);
    const band = p.bands[bandIndex];
    const tint = bandColor(bandIndex);

    const updateBand = (index: number, patch: Partial<SaturatorBand>) =>
        setParams({
            bands: p.bands.map((item, i) => (i === index ? { ...item, ...patch } : item)),
        });

    const ref = useCanvas(
        ({ ctx, width: w, height, telemetry, live }) => {
            width.current = w;
            const edges = [20, ...p.crossovers, 20000].map((frequency) =>
                frequencyToX(frequency, w),
            );
            p.bands.forEach((_, index) => {
                ctx.fillStyle = withAlpha(bandColor(index), index === bandIndex ? 0.07 : 0.025);
                ctx.fillRect(edges[index], 0, edges[index + 1] - edges[index], height);
            });
            drawGrid(ctx, w, height);
            drawSpectrum(
                ctx,
                telemetry?.post,
                w,
                height,
                css('--spectrum-post'),
                css('--spectrum-post-line'),
            );
            const readings = (telemetry?.meters.effects[effect.id] ?? []).slice(0, count);
            p.bands.forEach((item, index) => {
                const reading = readings[index] ?? HEAT_FLOOR;
                const previous = shown.current[index] ?? HEAT_FLOOR;
                shown.current[index] = live
                    ? reading > previous
                        ? reading
                        : previous - Math.min(1.5, previous - reading)
                    : previous;
                const x = edges[index];
                const bandWidth = edges[index + 1] - edges[index];
                const heat = Math.min(
                    1,
                    Math.max(0, (shown.current[index] - HEAT_FLOOR) / (HEAT_CEILING - HEAT_FLOOR)),
                );
                const barHeight = heat * height * 0.6;
                ctx.fillStyle = withAlpha(bandColor(index), 0.2 + 0.4 * heat);
                ctx.fillRect(x + bandWidth * 0.3, height - barHeight, bandWidth * 0.4, barHeight);
                ctx.fillStyle = css('--text');
                ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
                ctx.textAlign = 'center';
                const drive = bandWidth > 100 ? ` +${item.driveDb.toFixed(1)} dB` : '';
                const label = item.mute
                    ? 'MUTED'
                    : item.bypass
                      ? 'BYPASS'
                      : `${STYLE_LABELS[item.style]}${drive}`;
                // Below the crossover frequency labels.
                ctx.fillText(label, x + bandWidth / 2, 46);
                ctx.fillStyle = css('--grid-label');
                ctx.fillText(bandLabel(index, count), x + bandWidth / 2, height - 18);
                ctx.textAlign = 'start';
            });
            p.crossovers.forEach((frequency, index) => {
                const x = Math.round(frequencyToX(frequency, w)) + 0.5;
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
                ctx.stroke();
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(x, height / 2, 6, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = css('--text');
                ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
                ctx.fillText(formatFrequency(frequency), x + 6, 14 + (index % 2) * 12);
            });
        },
        [p, bandIndex, color, count],
    );

    const curveRef = useCanvas(
        ({ ctx, width: w, height }) => {
            const size = Math.min(w, height);
            const left = (w - size) / 2;
            ctx.strokeStyle = css('--grid');
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(left, height / 2);
            ctx.lineTo(left + size, height / 2);
            ctx.moveTo(left + size / 2, 0);
            ctx.lineTo(left + size / 2, height);
            ctx.stroke();
            // Input from -1 to 1 against the output before makeup gain, also -1 to 1.
            const drive = Math.pow(10, band.driveDb / 20);
            const toY = (value: number) => height / 2 - (value * size) / 2.2;
            ctx.strokeStyle = band.bypass ? css('--text-dim') : tint;
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (let px = 0; px <= size; px++) {
                const input = (px / size) * 2 - 1;
                const y = toY(saturate(band.style, input * drive));
                if (px === 0) {
                    ctx.moveTo(left + px, y);
                } else {
                    ctx.lineTo(left + px, y);
                }
            }
            ctx.stroke();
        },
        [band.style, band.driveDb, band.bypass, tint],
    );

    const position = (event: PointerEvent<HTMLCanvasElement>) =>
        event.clientX - event.currentTarget.getBoundingClientRect().left;

    const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
        const x = position(event);
        const handle = p.crossovers.findIndex(
            (frequency) => Math.abs(frequencyToX(frequency, width.current) - x) < 8,
        );
        if (handle >= 0) {
            drag.current = handle;
            event.currentTarget.setPointerCapture(event.pointerId);
            return;
        }
        const frequency = xToFrequency(x, width.current);
        setSelected(p.crossovers.filter((crossover) => crossover < frequency).length);
    };

    const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
        const handle = drag.current;
        if (handle === undefined) {
            return;
        }
        const lower = handle > 0 ? p.crossovers[handle - 1] * MIN_GAP : SPECS.crossover.min;
        const upper =
            handle < p.crossovers.length - 1
                ? p.crossovers[handle + 1] / MIN_GAP
                : SPECS.crossover.max;
        const frequency = Math.min(
            upper,
            Math.max(lower, xToFrequency(position(event), width.current)),
        );
        setParams({
            crossovers: p.crossovers.map((value, index) =>
                index === handle ? Math.round(frequency) : value,
            ),
        });
    };

    return (
        <div className="editor saturator-editor">
            <div className="display">
                <canvas
                    ref={ref}
                    className="display-canvas interactive"
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={() => (drag.current = undefined)}
                    onPointerCancel={() => (drag.current = undefined)}
                    title="Drag crossover handles · click a band to edit it"
                />
            </div>
            <div className="band-strip">
                {p.bands.map((item, index) => (
                    <button
                        type="button"
                        key={index}
                        className={`band-chip ${index === bandIndex ? 'on' : ''}`}
                        style={{ ['--chip-color' as string]: bandColor(index) }}
                        onClick={() => setSelected(index)}
                    >
                        <span>{bandLabel(index, count)}</span>
                        {item.solo && <span className="badge">S</span>}
                        {item.mute && <span className="badge">M</span>}
                        {item.bypass && <span className="badge">B</span>}
                    </button>
                ))}
                <div className="band-strip-end">
                    <Segmented
                        label="Bands"
                        value={count}
                        options={[1, 2, 3, 4].map((value) => ({ value, label: `${value}` }))}
                        onChange={(value) => {
                            setParams(withSaturatorBandCount(p, value));
                            setSelected((current) => Math.min(current, value - 1));
                        }}
                        color={color}
                    />
                </div>
            </div>
            <div className="control-row">
                <ControlGroup title={bandLabel(bandIndex, count)}>
                    <div className="stack saturator-styles">
                        <Segmented
                            label="Curve"
                            value={band.style}
                            options={SATURATION_STYLES.map((value) => ({
                                value,
                                label: STYLE_LABELS[value],
                                title: STYLE_TITLES[value],
                            }))}
                            onChange={(style) => updateBand(bandIndex, { style })}
                            color={tint}
                        />
                    </div>
                    <Knob
                        spec={SPECS.satDriveDb}
                        value={band.driveDb}
                        onChange={(driveDb) => updateBand(bandIndex, { driveDb })}
                        color={tint}
                    />
                    <Knob
                        spec={SPECS.satDynamics}
                        value={band.dynamics}
                        onChange={(dynamics) => updateBand(bandIndex, { dynamics })}
                        color={tint}
                    />
                    <Knob
                        spec={SPECS.satTone}
                        value={band.tone}
                        onChange={(tone) => updateBand(bandIndex, { tone })}
                        color={tint}
                    />
                    <canvas
                        ref={curveRef}
                        className="saturator-curve"
                        title="Curve of the selected band at its drive"
                    />
                    <ControlGroup title="Blend" className="subpanel saturator-blend">
                        <div className="saturator-pair">
                            <Knob
                                spec={SPECS.mix}
                                value={band.mix}
                                onChange={(mix) => updateBand(bandIndex, { mix })}
                                color={tint}
                            />
                            <Knob
                                spec={SPECS.outputDb}
                                label="Level"
                                value={band.levelDb}
                                onChange={(levelDb) => updateBand(bandIndex, { levelDb })}
                                color={tint}
                            />
                        </div>
                        <div className="saturator-toggles">
                            <Toggle
                                active={band.solo}
                                onChange={(solo) => updateBand(bandIndex, { solo })}
                                color="#ffd84f"
                            >
                                Solo
                            </Toggle>
                            <Toggle
                                active={band.mute}
                                onChange={(mute) => updateBand(bandIndex, { mute })}
                                color="#ff5e7a"
                            >
                                Mute
                            </Toggle>
                            <Toggle
                                active={band.bypass}
                                onChange={(bypass) => updateBand(bandIndex, { bypass })}
                                color="#8a94a6"
                            >
                                Bypass
                            </Toggle>
                        </div>
                    </ControlGroup>
                </ControlGroup>
                <ControlGroup title="Global" className="saturator-global">
                    <div className="stack">
                        <Segmented
                            label="Oversampling"
                            value={p.oversampling}
                            options={OVERSAMPLING_FACTORS.map((value) => ({
                                value,
                                label: `${value}×`,
                                title:
                                    value === 1
                                        ? 'Off: lightest on the CPU, most aliasing'
                                        : `${value}× the sample rate against aliasing`,
                            }))}
                            onChange={(oversampling) => setParams({ oversampling })}
                            color={color}
                        />
                    </div>
                    <div className="saturator-pair">
                        <Knob
                            spec={SPECS.mix}
                            value={p.mix}
                            onChange={(mix) => setParams({ mix })}
                            color={color}
                        />
                        <Knob
                            spec={SPECS.outputDb}
                            value={p.outputDb}
                            onChange={(outputDb) => setParams({ outputDb })}
                            color={color}
                        />
                    </div>
                </ControlGroup>
            </div>
        </div>
    );
}
