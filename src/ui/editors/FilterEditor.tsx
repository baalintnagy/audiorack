import { useRef } from 'react';
import { filterCoefficients } from '../../dsp/kernels/filter';
import { FILTER_MODES, SLOPES, SPECS, type FilterMode } from '../../shared/effects';
import { ControlGroup, Segmented } from '../components/Controls';
import { Knob } from '../components/Knob';
import { ResponseGraph } from '../components/ResponseGraph';
import { frequencyToX, withAlpha } from '../graph';
import type { EditorProps } from './types';

const MODE_LABELS: Record<FilterMode, string> = {
    lowpass: 'LP',
    highpass: 'HP',
    bandpass: 'BP',
    notch: 'Notch',
};

/** Maps resonance to the handle's vertical position on the graph. */
function qToDb(q: number) {
    return 20 * Math.log10(q / 0.71);
}

export function FilterEditor({ effect, setParams, color }: EditorProps<'filter'>) {
    const p = effect.params;
    const live = useRef(p.cutoff);
    return (
        <div className="editor filter-editor">
            <div className="display">
                <ResponseGraph
                    effectId={effect.id}
                    color={color}
                    range={30}
                    sections={(sampleRate) => filterCoefficients(p, live.current, sampleRate)}
                    deps={[p]}
                    title="Drag the handle sideways for cutoff, up and down for resonance · wheel for drive"
                    overlay={({ ctx, width, height, telemetry }) => {
                        const modulated = telemetry?.meters.effects[effect.id]?.[0];
                        live.current = p.lfoDepth > 0 && modulated ? modulated : p.cutoff;
                        if (p.lfoDepth > 0) {
                            const low = frequencyToX(p.cutoff / Math.pow(2, p.lfoDepth), width);
                            const high = frequencyToX(p.cutoff * Math.pow(2, p.lfoDepth), width);
                            ctx.fillStyle = withAlpha(color, 0.08);
                            ctx.fillRect(low, 0, high - low, height);
                            const x = frequencyToX(live.current, width);
                            ctx.strokeStyle = withAlpha(color, 0.8);
                            ctx.setLineDash([2, 3]);
                            ctx.beginPath();
                            ctx.moveTo(x, 0);
                            ctx.lineTo(x, height);
                            ctx.stroke();
                            ctx.setLineDash([]);
                        }
                    }}
                    node={{
                        frequency: p.cutoff,
                        db: Math.min(28, qToDb(p.q)),
                        onDrag: (frequency, db) =>
                            setParams({
                                cutoff: Math.round(frequency),
                                q:
                                    Math.round(
                                        Math.min(
                                            SPECS.filterQ.max,
                                            Math.max(
                                                SPECS.filterQ.min,
                                                0.71 * Math.pow(10, db / 20),
                                            ),
                                        ) * 100,
                                    ) / 100,
                            }),
                        guides: { frequency: true },
                        ring: {
                            spec: SPECS.driveDb,
                            value: p.driveDb,
                            onChange: (driveDb) => setParams({ driveDb }),
                        },
                        onReset: () =>
                            setParams({
                                cutoff: SPECS.cutoff.default,
                                q: SPECS.filterQ.default,
                                driveDb: SPECS.driveDb.default,
                            }),
                    }}
                />
            </div>
            <div className="control-row">
                <ControlGroup title="Filter">
                    <div className="stack">
                        <Segmented
                            value={p.mode}
                            label="Mode"
                            options={FILTER_MODES.map((value) => ({
                                value,
                                label: MODE_LABELS[value],
                            }))}
                            onChange={(mode) => setParams({ mode })}
                            color={color}
                        />
                        <Segmented
                            label="Slope"
                            value={p.slope}
                            options={SLOPES.map((value) => ({ value, label: `${value}` }))}
                            onChange={(slope) => setParams({ slope })}
                            color={color}
                        />
                    </div>
                    <Knob
                        spec={SPECS.cutoff}
                        value={p.cutoff}
                        onChange={(cutoff) => setParams({ cutoff })}
                        color={color}
                    />
                    <Knob
                        spec={SPECS.filterQ}
                        value={p.q}
                        onChange={(q) => setParams({ q })}
                        color={color}
                    />
                    <Knob
                        spec={SPECS.driveDb}
                        value={p.driveDb}
                        onChange={(driveDb) => setParams({ driveDb })}
                        color={color}
                    />
                </ControlGroup>
                <ControlGroup title="LFO">
                    <Knob
                        spec={SPECS.lfoRate}
                        value={p.lfoRate}
                        onChange={(lfoRate) => setParams({ lfoRate })}
                        color={color}
                    />
                    <Knob
                        spec={SPECS.lfoDepth}
                        value={p.lfoDepth}
                        onChange={(lfoDepth) => setParams({ lfoDepth })}
                        color={color}
                    />
                    <div className="stack">
                        <Segmented
                            value={p.lfoShape}
                            options={[
                                { value: 'sine', label: 'Sine' },
                                { value: 'triangle', label: 'Tri' },
                            ]}
                            onChange={(lfoShape) => setParams({ lfoShape })}
                            color={color}
                        />
                    </div>
                </ControlGroup>
                <ControlGroup title="Mix">
                    <Knob
                        spec={SPECS.mix}
                        value={p.mix}
                        onChange={(mix) => setParams({ mix })}
                        color={color}
                    />
                </ControlGroup>
            </div>
        </div>
    );
}
