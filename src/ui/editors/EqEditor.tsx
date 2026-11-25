import { useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { eqResponseDb } from '../../dsp/eq';
import {
    EQ_BAND_TYPES,
    MAX_EQ_BANDS,
    SLOPES,
    SPECS,
    defaultEqBand,
    type EqBand,
    type EqBandType,
} from '../../shared/effects';
import { ControlGroup, Segmented, Toggle } from '../components/Controls';
import { Knob } from '../components/Knob';
import { nodePart, specValue, wheelEditsDisplays, wheelStep } from '../canvasDrag';
import { formatFrequency, fromNormalized, toNormalized } from '../format';
import {
    css,
    dbToY,
    drawGrid,
    drawGuide,
    drawRing,
    drawSpectrum,
    frequencyToX,
    pixelFrequencies,
    ringTurn,
    strokeCurve,
    withAlpha,
    xToFrequency,
    yToDb,
} from '../graph';
import { useTelemetryStore } from '../telemetry';
import { useCanvas } from '../useCanvas';
import { BAND_COLORS, type EditorProps } from './types';

const RANGES = [6, 12, 18, 30];
const NODE_RADIUS = 7;
/** Radius of the Q ring around each band's point. */
const RING_RADIUS = NODE_RADIUS + 7;
/** Pointer travel, in pixels, that turns the Q ring through its whole range. */
const RING_DRAG_PIXELS = 160;
/** Share of the pointer movement applied while Shift is held. */
const FINE_SCALE = 0.2;

const TYPE_LABELS: Record<EqBandType, string> = {
    bell: 'Bell',
    lowshelf: 'Low Shelf',
    highshelf: 'High Shelf',
    lowcut: 'Low Cut',
    highcut: 'High Cut',
    notch: 'Notch',
    bandpass: 'Band Pass',
};

function hasGain(type: EqBandType) {
    return type === 'bell' || type === 'lowshelf' || type === 'highshelf';
}

function bandColor(bands: EqBand[], band: EqBand) {
    return BAND_COLORS[bands.indexOf(band) % BAND_COLORS.length];
}

export function EqEditor({ effect, setParams, color }: EditorProps<'eq'>) {
    const { bands, outputDb } = effect.params;
    const [selectedId, setSelectedId] = useState<string | undefined>(bands[0]?.id);
    const [range, setRange] = useState(18);
    const [showPre, setShowPre] = useState(true);
    const store = useTelemetryStore();
    const drag = useRef<
        | {
              id: string;
              pointerId: number;
              /** Set while the ring is turned: Q along the knob's scale, and the last pointer y. */
              ring?: { position: number; lastY: number };
          }
        | undefined
    >(undefined);
    // The band whose ring is under the pointer, to highlight it.
    const [hotRing, setHotRing] = useState<string>();
    const size = useRef({ width: 1, height: 1 });
    const selected = bands.find((band) => band.id === selectedId);

    const updateBand = (id: string, patch: Partial<EqBand>) =>
        setParams({ bands: bands.map((band) => (band.id === id ? { ...band, ...patch } : band)) });

    const removeBand = (id: string) => {
        setParams({ bands: bands.filter((band) => band.id !== id) });
        if (selectedId === id) {
            setSelectedId(undefined);
        }
    };

    const frequenciesFor = useMemo(() => {
        let cache: { width: number; values: Float32Array } | undefined;
        return (width: number) => {
            if (!cache || cache.width !== width) {
                cache = { width, values: pixelFrequencies(width) };
            }
            return cache.values;
        };
    }, []);

    const ref = useCanvas(
        ({ ctx, width, height, telemetry }) => {
            size.current = { width, height };
            const sampleRate = telemetry?.sampleRate ?? store.sampleRate;
            const frequencies = frequenciesFor(width);
            const toY = (db: number) => dbToY(db, height, range);
            drawGrid(ctx, width, height, { dbRange: range, dbStep: range <= 6 ? 2 : range / 3 });
            if (showPre) {
                drawSpectrum(ctx, telemetry?.pre, width, height, css('--spectrum-pre'));
            }
            drawSpectrum(
                ctx,
                telemetry?.post,
                width,
                height,
                css('--spectrum-post'),
                css('--spectrum-post-line'),
            );
            bands.forEach((band) => {
                if (!band.enabled) {
                    return;
                }
                const response = eqResponseDb([band], frequencies, sampleRate);
                const tint = bandColor(bands, band);
                const isSelected = band.id === selectedId;
                strokeCurve(ctx, frequencies, response, width, toY, {
                    stroke: withAlpha(tint, isSelected ? 0.9 : 0.35),
                    lineWidth: 1,
                    fill: withAlpha(tint, isSelected ? 0.22 : 0.08),
                    baseline: toY(0),
                });
            });
            const total = eqResponseDb(bands, frequencies, sampleRate);
            strokeCurve(ctx, frequencies, total, width, toY, {
                stroke: css('--curve'),
                lineWidth: 2.2,
                glow: true,
            });
            bands.forEach((band) => {
                const x = frequencyToX(band.frequency, width);
                const y = toY(hasGain(band.type) ? band.gainDb : 0);
                const tint = bandColor(bands, band);
                if (band.id === selectedId) {
                    const gap = NODE_RADIUS + 7;
                    drawGuide(ctx, [x, 0], [x, y - gap], tint);
                    drawGuide(ctx, [x, y + gap], [x, height], tint);
                    if (hasGain(band.type)) {
                        drawGuide(ctx, [0, y], [x - gap, y], tint);
                        drawGuide(ctx, [x + gap, y], [width, y], tint);
                    }
                }
                // The ring shows Q, which the wheel sets.
                drawRing(
                    ctx,
                    x,
                    y,
                    RING_RADIUS,
                    band.enabled ? tint : css('--node-disabled'),
                    ringTurn(SPECS.q, band.q),
                    hotRing === band.id,
                );
                ctx.beginPath();
                ctx.arc(x, y, NODE_RADIUS, 0, Math.PI * 2);
                ctx.fillStyle = band.enabled ? tint : css('--node-disabled');
                ctx.globalAlpha = band.id === selectedId ? 1 : 0.8;
                ctx.fill();
                ctx.globalAlpha = 1;
                ctx.lineWidth = band.id === selectedId ? 2.5 : 1;
                ctx.strokeStyle = band.id === selectedId ? '#ffffff' : 'rgb(0 0 0 / 50%)';
                ctx.stroke();
                ctx.fillStyle = '#0b0d10';
                ctx.font = 'bold 9px ui-sans-serif, system-ui, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(String(bands.indexOf(band) + 1), x, y + 3);
                ctx.textAlign = 'start';
            });
        },
        [bands, selectedId, range, showPre, hotRing],
    );

    const hit = (event: PointerEvent<HTMLCanvasElement> | WheelEvent<HTMLCanvasElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const { width, height } = size.current;
        // The point's center moves it, its ring sets Q; centers win over overlapping rings.
        const partOf = (candidate: EqBand) =>
            nodePart(
                { x, y },
                frequencyToX(candidate.frequency, width),
                dbToY(hasGain(candidate.type) ? candidate.gainDb : 0, height, range),
                RING_RADIUS,
            );
        const reversed = [...bands].reverse();
        const band =
            reversed.find((candidate) => partOf(candidate) === 'center') ??
            reversed.find((candidate) => partOf(candidate) === 'ring');
        return { x, y, band, part: band && partOf(band), width, height };
    };

    const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
        const { band, part, x, y, width, height } = hit(event);
        if (band && part === 'ring' && event.button === 0 && !event.altKey) {
            setSelectedId(band.id);
            drag.current = {
                id: band.id,
                pointerId: event.pointerId,
                ring: { position: toNormalized(SPECS.q, band.q), lastY: y },
            };
            event.currentTarget.setPointerCapture(event.pointerId);
            return;
        }
        if (band) {
            if (event.button === 2 || event.altKey) {
                if (event.altKey) {
                    updateBand(band.id, { enabled: !band.enabled });
                }
                return;
            }
            setSelectedId(band.id);
            drag.current = { id: band.id, pointerId: event.pointerId };
            event.currentTarget.setPointerCapture(event.pointerId);
            return;
        }
        if (event.detail >= 2 && bands.length < MAX_EQ_BANDS) {
            const created = defaultEqBand({
                frequency: Math.round(xToFrequency(x, width)),
                gainDb: Math.round(yToDb(y, height, range) * 10) / 10,
            });
            setParams({ bands: [...bands, created] });
            setSelectedId(created.id);
        }
    };

    const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
        if (!drag.current) {
            const { band, part } = hit(event);
            event.currentTarget.style.cursor =
                part === 'ring' ? 'ns-resize' : part === 'center' ? 'move' : '';
            const hot = part === 'ring' ? band?.id : undefined;
            if (hot !== hotRing) {
                setHotRing(hot);
            }
            return;
        }
        const band = bands.find((candidate) => candidate.id === drag.current?.id);
        if (!band) {
            return;
        }
        const { x, y, width, height } = hit(event);
        const ring = drag.current.ring;
        if (ring) {
            // Up raises Q like a knob; Shift for fine steps.
            const scale = event.shiftKey ? FINE_SCALE : 1;
            ring.position += ((ring.lastY - y) / RING_DRAG_PIXELS) * scale;
            ring.lastY = y;
            updateBand(band.id, { q: specValue(SPECS.q, fromNormalized(SPECS.q, ring.position)) });
            return;
        }
        const frequency = Math.min(20000, Math.max(20, xToFrequency(x, width)));
        const patch: Partial<EqBand> = { frequency: Math.round(frequency * 10) / 10 };
        if (hasGain(band.type) && !event.shiftKey) {
            const gain = Math.min(
                SPECS.gainDb.max,
                Math.max(SPECS.gainDb.min, yToDb(y, height, range)),
            );
            patch.gainDb = Math.round(gain * 10) / 10;
        }
        updateBand(band.id, patch);
    };

    const onWheel = (event: WheelEvent<HTMLCanvasElement>) => {
        const { band } = hit(event);
        const target = band ?? selected;
        if (!target || !wheelEditsDisplays()) {
            return;
        }
        const direction = event.deltaY < 0 ? 1 : -1;
        updateBand(target.id, { q: wheelStep(SPECS.q, target.q, direction, event.shiftKey) });
    };

    return (
        <div className="editor eq-editor">
            <div className="display">
                <canvas
                    ref={ref}
                    className="display-canvas interactive"
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={() => (drag.current = undefined)}
                    onPointerCancel={() => (drag.current = undefined)}
                    onPointerLeave={() => !drag.current && hotRing && setHotRing(undefined)}
                    onWheel={onWheel}
                    onContextMenu={(event) => {
                        event.preventDefault();
                        const { band } = hit(event as unknown as PointerEvent<HTMLCanvasElement>);
                        if (band) {
                            removeBand(band.id);
                        }
                    }}
                    title="Double-click to add a band · drag a point to move it, its ring for Q · right-click to delete · Alt-click to toggle"
                />
                <div className="display-overlay top-right">
                    <Segmented
                        value={range}
                        options={RANGES.map((value) => ({ value, label: `±${value}` }))}
                        onChange={setRange}
                        color={color}
                    />
                    <Toggle active={showPre} onChange={setShowPre} title="Show input spectrum">
                        Pre
                    </Toggle>
                </div>
                {bands.length === 0 && (
                    <div className="display-hint">Double-click anywhere to add a band</div>
                )}
            </div>
            <div className="band-strip">
                {bands.map((band, index) => (
                    <button
                        type="button"
                        key={band.id}
                        className={`band-chip ${band.id === selectedId ? 'on' : ''} ${band.enabled ? '' : 'off'}`}
                        style={{ ['--chip-color' as string]: bandColor(bands, band) }}
                        onClick={() => setSelectedId(band.id)}
                    >
                        <span className="band-chip-index">{index + 1}</span>
                        <span>{TYPE_LABELS[band.type]}</span>
                        <span className="band-chip-frequency">
                            {formatFrequency(band.frequency)}
                        </span>
                    </button>
                ))}
                <button
                    type="button"
                    className="band-chip add"
                    disabled={bands.length >= MAX_EQ_BANDS}
                    onClick={() => {
                        const created = defaultEqBand({ frequency: 1000 });
                        setParams({ bands: [...bands, created] });
                        setSelectedId(created.id);
                    }}
                >
                    + Band
                </button>
            </div>
            <div className="control-row">
                {selected ? (
                    <ControlGroup title={`Band ${bands.indexOf(selected) + 1}`}>
                        <label className="select-field">
                            <span>Type</span>
                            <select
                                value={selected.type}
                                onChange={(event) =>
                                    updateBand(selected.id, {
                                        type: event.target.value as EqBandType,
                                    })
                                }
                            >
                                {EQ_BAND_TYPES.map((type) => (
                                    <option key={type} value={type}>
                                        {TYPE_LABELS[type]}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <Knob
                            spec={SPECS.frequency}
                            value={selected.frequency}
                            onChange={(frequency) => updateBand(selected.id, { frequency })}
                            color={bandColor(bands, selected)}
                        />
                        <Knob
                            spec={SPECS.gainDb}
                            value={selected.gainDb}
                            disabled={!hasGain(selected.type)}
                            onChange={(gainDb) => updateBand(selected.id, { gainDb })}
                            color={bandColor(bands, selected)}
                        />
                        <Knob
                            spec={SPECS.q}
                            value={selected.q}
                            defaultValue={
                                hasGain(selected.type) && selected.type === 'bell' ? 1 : 0.71
                            }
                            onChange={(q) => updateBand(selected.id, { q })}
                            color={bandColor(bands, selected)}
                        />
                        {(selected.type === 'lowcut' || selected.type === 'highcut') && (
                            <Segmented
                                label="Slope"
                                value={selected.slope}
                                options={SLOPES.map((value) => ({ value, label: `${value}` }))}
                                onChange={(slope) => updateBand(selected.id, { slope })}
                                color={bandColor(bands, selected)}
                            />
                        )}
                        <div className="stack">
                            <Toggle
                                active={selected.enabled}
                                onChange={(enabled) => updateBand(selected.id, { enabled })}
                                color={bandColor(bands, selected)}
                            >
                                On
                            </Toggle>
                            <button
                                type="button"
                                className="ghost danger"
                                onClick={() => removeBand(selected.id)}
                            >
                                Delete
                            </button>
                        </div>
                    </ControlGroup>
                ) : (
                    <div className="control-placeholder">Select a band to edit it</div>
                )}
                <ControlGroup title="Output">
                    <Knob
                        spec={SPECS.outputDb}
                        value={outputDb}
                        onChange={(value) => setParams({ outputDb: value })}
                        color={color}
                    />
                </ControlGroup>
            </div>
        </div>
    );
}
