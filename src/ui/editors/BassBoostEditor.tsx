import { bassShelfCoefficients } from '../../dsp/kernels/bassboost';
import { SPECS } from '../../shared/effects';
import { ControlGroup, Toggle } from '../components/Controls';
import { Knob } from '../components/Knob';
import { ResponseGraph } from '../components/ResponseGraph';
import { dbToY, frequencyToX, withAlpha } from '../graph';
import type { EditorProps } from './types';

export function BassBoostEditor({ effect, setParams, color }: EditorProps<'bassboost'>) {
    const p = effect.params;
    return (
        <div className="editor bass-editor">
            <div className="display">
                <ResponseGraph
                    color={color}
                    range={24}
                    deps={[p]}
                    title="Drag the handle for frequency and boost · wheel for harmonics"
                    sections={(sampleRate) => bassShelfCoefficients(p, sampleRate)}
                    overlay={({ ctx, width, height }) => {
                        if (p.harmonics <= 0) {
                            return;
                        }
                        // Indicate where the synthesized harmonics land.
                        const strength = p.harmonics / 100;
                        [2, 3, 4, 5].forEach((harmonic, index) => {
                            const x = frequencyToX(p.frequency * harmonic, width);
                            const top = dbToY(
                                p.boostDb * strength * (0.7 - index * 0.15),
                                height,
                                24,
                            );
                            ctx.fillStyle = withAlpha(color, 0.25 + 0.4 * strength);
                            ctx.fillRect(x - 2, top, 4, dbToY(0, height, 24) - top);
                        });
                    }}
                    node={{
                        frequency: p.frequency,
                        db: p.boostDb / 2,
                        onDrag: (frequency, db) =>
                            setParams({
                                frequency: Math.round(
                                    Math.min(
                                        SPECS.bassFrequency.max,
                                        Math.max(SPECS.bassFrequency.min, frequency),
                                    ),
                                ),
                                boostDb:
                                    Math.round(
                                        Math.min(SPECS.boostDb.max, Math.max(0, db * 2)) * 10,
                                    ) / 10,
                            }),
                        guides: { frequency: true },
                        ring: {
                            spec: SPECS.harmonics,
                            value: p.harmonics,
                            onChange: (harmonics) => setParams({ harmonics }),
                        },
                        onReset: () =>
                            setParams({
                                frequency: SPECS.bassFrequency.default,
                                boostDb: SPECS.boostDb.default,
                                harmonics: SPECS.harmonics.default,
                            }),
                    }}
                />
            </div>
            <div className="control-row">
                <ControlGroup title="Boost">
                    <Knob
                        spec={SPECS.boostDb}
                        value={p.boostDb}
                        onChange={(boostDb) => setParams({ boostDb })}
                        color={color}
                        size={68}
                    />
                    <Knob
                        spec={SPECS.bassFrequency}
                        value={p.frequency}
                        onChange={(frequency) => setParams({ frequency })}
                        color={color}
                    />
                </ControlGroup>
                <ControlGroup title="Enhance">
                    <Knob
                        spec={SPECS.harmonics}
                        value={p.harmonics}
                        onChange={(harmonics) => setParams({ harmonics })}
                        color={color}
                    />
                    <div className="stack">
                        <Toggle
                            active={p.tighten}
                            onChange={(tighten) => setParams({ tighten })}
                            color={color}
                            title="Remove inaudible rumble below 25 Hz"
                        >
                            Tighten
                        </Toggle>
                        <Toggle
                            active={p.monoBass}
                            onChange={(monoBass) => setParams({ monoBass })}
                            color={color}
                            title="Sum the low end to mono"
                        >
                            Mono Bass
                        </Toggle>
                    </div>
                </ControlGroup>
                <ControlGroup title="Output">
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
