import { useRef, useState } from 'react';
import {
    SPECS,
    defaultMultibandBand,
    type MultibandBand,
    type MultibandParams,
} from '../../shared/effects';
import { ControlGroup, Segmented, Toggle } from '../components/Controls';
import { Knob } from '../components/Knob';
import { formatFrequency } from '../format';
import { useCanvasDrag } from '../canvasDrag';
import { css, drawGrid, drawSpectrum, frequencyToX, withAlpha } from '../graph';
import { useCanvas } from '../useCanvas';
import { bandEdges, bandHandle, drawBandNodes, type BandNode } from './bandDisplay';
import { BAND_COLORS, type EditorProps } from './types';

const GR_RANGE = 18;

function bandLabel(index: number, count: number) {
    if (count === 2) {
        return ['Low', 'High'][index];
    }
    if (count === 3) {
        return ['Low', 'Mid', 'High'][index];
    }
    return ['Low', 'Low Mid', 'High Mid', 'High'][index];
}

/** Changes the number of bands while keeping existing band settings where possible. */
export function withBandCount(params: MultibandParams, count: number): MultibandParams {
    const presets: Record<number, number[]> = {
        2: [400],
        3: [200, 2500],
        4: [150, 1500, 6000],
    };
    const crossovers = presets[count];
    const bands = Array.from(
        { length: count },
        (_, index) => params.bands[index] ?? defaultMultibandBand(),
    );
    return { ...params, crossovers, bands };
}

export function MultibandEditor({ effect, setParams, color }: EditorProps<'multiband'>) {
    const p = effect.params;
    const [selected, setSelected] = useState(1);
    const shown = useRef<number[]>([]);
    const count = p.crossovers.length + 1;
    // The node part under the pointer, to highlight a ring.
    const [hot, setHot] = useState<string>();
    const band = p.bands[Math.min(selected, count - 1)];
    const bandIndex = Math.min(selected, count - 1);

    const updateBand = (index: number, patch: Partial<MultibandBand>) =>
        setParams({
            bands: p.bands.map((item, i) => (i === index ? { ...item, ...patch } : item)),
        });

    // Each band's node: up for the threshold, across the band for the ratio, the wheel for
    // makeup gain.
    const nodes: BandNode = {
        specs: { x: SPECS.ratio, y: SPECS.thresholdDb, ring: SPECS.makeupDb },
        values: p.bands.map((item) => ({
            x: item.ratio,
            y: item.thresholdDb,
            ring: item.makeupDb,
        })),
        onChange: (index, { x, y, ring }) =>
            updateBand(index, {
                ...(x === undefined ? {} : { ratio: x }),
                ...(y === undefined ? {} : { thresholdDb: y }),
                ...(ring === undefined ? {} : { makeupDb: ring }),
            }),
        format: ({ x, y, ring }) =>
            `${y.toFixed(1)} dB · ${x >= SPECS.ratio.max ? '∞' : x.toFixed(1)}:1 · makeup ${ring > 0 ? '+' : ''}${ring.toFixed(1)}`,
    };
    const tint = (index: number) => BAND_COLORS[(index + 4) % BAND_COLORS.length];

    const ref = useCanvas(
        ({ ctx, width: w, height, telemetry, live }) => {
            const edges = bandEdges(p.crossovers, w);
            p.bands.forEach((_, index) => {
                const tint = BAND_COLORS[(index + 4) % BAND_COLORS.length];
                ctx.fillStyle = withAlpha(tint, index === bandIndex ? 0.16 : 0.06);
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
                const reading = readings[index] ?? 0;
                const previous = shown.current[index] ?? 0;
                shown.current[index] = live
                    ? reading > previous
                        ? reading
                        : previous * 0.85 + reading * 0.15
                    : previous;
                const tint = BAND_COLORS[(index + 4) % BAND_COLORS.length];
                const x = edges[index];
                const bandWidth = edges[index + 1] - edges[index];
                const barHeight =
                    (Math.min(GR_RANGE, shown.current[index]) / GR_RANGE) * height * 0.6;
                ctx.fillStyle = withAlpha(tint, 0.55);
                ctx.fillRect(x + bandWidth * 0.3, 0, bandWidth * 0.4, barHeight);
                ctx.fillStyle = css('--text');
                ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
                ctx.textAlign = 'center';
                const label = item.mute
                    ? 'MUTED'
                    : item.bypass
                      ? 'BYPASS'
                      : `-${shown.current[index].toFixed(1)} dB`;
                ctx.fillText(label, x + bandWidth / 2, barHeight + 16);
                ctx.fillStyle = css('--grid-label');
                ctx.fillText(bandLabel(index, count), x + bandWidth / 2, height - 18);
                ctx.textAlign = 'start';
            });
            drawBandNodes(ctx, nodes, edges, height, bandIndex, tint, hot);
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
        [p, bandIndex, color, count, hot],
    );

    const pointer = useCanvasDrag(
        (point) =>
            bandHandle({
                point,
                crossovers: p.crossovers,
                onCrossovers: (crossovers) => setParams({ crossovers }),
                select: setSelected,
                node: nodes,
            }),
        setHot,
    );

    const bandColor = BAND_COLORS[(bandIndex + 4) % BAND_COLORS.length];
    return (
        <div className="editor multiband-editor">
            <div className="display">
                <canvas
                    ref={ref}
                    className="display-canvas interactive"
                    {...pointer}
                    title="Drag crossover handles · drag a band's node up for the threshold, sideways for the ratio · wheel for makeup · click a band to edit it"
                />
            </div>
            <div className="band-strip">
                {p.bands.map((item, index) => (
                    <button
                        type="button"
                        key={index}
                        className={`band-chip ${index === bandIndex ? 'on' : ''}`}
                        style={{
                            ['--chip-color' as string]:
                                BAND_COLORS[(index + 4) % BAND_COLORS.length],
                        }}
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
                        options={[2, 3, 4].map((value) => ({ value, label: `${value}` }))}
                        onChange={(value) => {
                            setParams(withBandCount(p, value));
                            setSelected((current) => Math.min(current, value - 1));
                        }}
                        color={color}
                    />
                </div>
            </div>
            <div className="control-row">
                <ControlGroup title={bandLabel(bandIndex, count)}>
                    <Knob
                        spec={SPECS.thresholdDb}
                        value={band.thresholdDb}
                        onChange={(thresholdDb) => updateBand(bandIndex, { thresholdDb })}
                        color={bandColor}
                    />
                    <Knob
                        spec={SPECS.ratio}
                        value={band.ratio}
                        onChange={(ratio) => updateBand(bandIndex, { ratio })}
                        color={bandColor}
                    />
                    <Knob
                        spec={SPECS.attackMs}
                        value={band.attackMs}
                        onChange={(attackMs) => updateBand(bandIndex, { attackMs })}
                        color={bandColor}
                    />
                    <Knob
                        spec={SPECS.releaseMs}
                        value={band.releaseMs}
                        onChange={(releaseMs) => updateBand(bandIndex, { releaseMs })}
                        color={bandColor}
                    />
                    <Knob
                        spec={SPECS.makeupDb}
                        label="Gain"
                        value={band.makeupDb}
                        onChange={(makeupDb) => updateBand(bandIndex, { makeupDb })}
                        color={bandColor}
                    />
                    <div className="stack">
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
                <ControlGroup title="Global">
                    <Knob
                        spec={SPECS.kneeDb}
                        value={p.kneeDb}
                        onChange={(kneeDb) => setParams({ kneeDb })}
                        color={color}
                    />
                    <Knob
                        spec={SPECS.outputDb}
                        value={p.outputDb}
                        onChange={(outputDb) => setParams({ outputDb })}
                        color={color}
                    />
                </ControlGroup>
            </div>
        </div>
    );
}
