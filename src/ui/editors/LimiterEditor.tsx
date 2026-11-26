import { SPECS } from '../../shared/effects';
import type { Telemetry } from '../../shared/messages';
import { ControlGroup } from '../components/Controls';
import { Knob } from '../components/Knob';
import { DynamicsHistory, ReductionMeter } from '../components/Meters';
import type { EditorProps } from './types';
import { outputPeak } from '../telemetry';

export function LimiterEditor({ effect, setParams, color }: EditorProps<'limiter'>) {
    const p = effect.params;
    const reduction = (telemetry: Telemetry) => telemetry.meters.effects[effect.id]?.[0] ?? 0;
    return (
        <div className="editor dynamics-editor">
            <div className="display split">
                <DynamicsHistory
                    reduction={reduction}
                    level={(telemetry) => outputPeak(telemetry, effect.id)}
                    color={color}
                    thresholdDb={p.ceilingDb}
                    range={30}
                    threshold={{
                        spec: SPECS.ceilingDb,
                        onChange: (ceilingDb) => setParams({ ceilingDb }),
                    }}
                />
                <ReductionMeter value={reduction} color={color} range={12} />
            </div>
            <div className="control-row">
                <ControlGroup title="Drive">
                    <Knob
                        spec={SPECS.inputDb}
                        value={p.inputDb}
                        onChange={(inputDb) => setParams({ inputDb })}
                        color={color}
                        size={64}
                    />
                </ControlGroup>
                <ControlGroup title="Ceiling">
                    <Knob
                        spec={SPECS.ceilingDb}
                        value={p.ceilingDb}
                        onChange={(ceilingDb) => setParams({ ceilingDb })}
                        color={color}
                        size={64}
                    />
                </ControlGroup>
                <ControlGroup title="Character">
                    <Knob
                        spec={SPECS.limiterReleaseMs}
                        value={p.releaseMs}
                        onChange={(releaseMs) => setParams({ releaseMs })}
                        color={color}
                    />
                    <Knob
                        spec={SPECS.lookaheadMs}
                        value={p.lookaheadMs}
                        onChange={(lookaheadMs) => setParams({ lookaheadMs })}
                        color={color}
                    />
                </ControlGroup>
                <div className="control-note">
                    Lookahead delays the audio by {p.lookaheadMs.toFixed(1)} ms so peaks are caught
                    before they pass. The output never exceeds the ceiling.
                </div>
            </div>
        </div>
    );
}
