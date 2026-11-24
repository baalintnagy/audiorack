import { GATE_FIELDS } from '../../dsp/kernels/gate';
import { SPECS } from '../../shared/effects';
import type { Telemetry } from '../../shared/messages';
import { ControlGroup } from '../components/Controls';
import { Knob } from '../components/Knob';
import { DynamicsHistory, ReductionMeter } from '../components/Meters';
import type { EditorProps } from './types';

export function GateEditor({ effect, setParams, color }: EditorProps<'gate'>) {
    const p = effect.params;
    const readings = (telemetry: Telemetry) => telemetry.meters.effects[effect.id];
    const reduction = (telemetry: Telemetry) => readings(telemetry)?.[GATE_FIELDS.reduction] ?? 0;
    const level = (telemetry: Telemetry) => readings(telemetry)?.[GATE_FIELDS.level] ?? 0;
    return (
        <div className="editor dynamics-editor">
            <div className="display split">
                <DynamicsHistory
                    reduction={reduction}
                    level={level}
                    color={color}
                    thresholdDb={p.thresholdDb}
                    range={Math.min(84, Math.max(48, 12 - p.thresholdDb))}
                />
                <ReductionMeter value={reduction} color={color} range={Math.max(12, p.rangeDb)} />
            </div>
            <div className="control-row">
                <ControlGroup title="Detection">
                    <Knob
                        spec={SPECS.gateThresholdDb}
                        value={p.thresholdDb}
                        onChange={(thresholdDb) => setParams({ thresholdDb })}
                        color={color}
                        size={64}
                    />
                    <Knob
                        spec={SPECS.hysteresisDb}
                        value={p.hysteresisDb}
                        onChange={(hysteresisDb) => setParams({ hysteresisDb })}
                        color={color}
                    />
                    <Knob
                        spec={SPECS.sidechainHpHz}
                        value={p.sidechainHpHz}
                        onChange={(sidechainHpHz) => setParams({ sidechainHpHz })}
                        color={color}
                    />
                </ControlGroup>
                <ControlGroup title="Envelope">
                    <Knob
                        spec={SPECS.gateAttackMs}
                        value={p.attackMs}
                        onChange={(attackMs) => setParams({ attackMs })}
                        color={color}
                    />
                    <Knob
                        spec={SPECS.holdMs}
                        value={p.holdMs}
                        onChange={(holdMs) => setParams({ holdMs })}
                        color={color}
                    />
                    <Knob
                        spec={SPECS.gateReleaseMs}
                        value={p.releaseMs}
                        onChange={(releaseMs) => setParams({ releaseMs })}
                        color={color}
                    />
                </ControlGroup>
                <ControlGroup title="Closed">
                    <Knob
                        spec={SPECS.gateRangeDb}
                        value={p.rangeDb}
                        onChange={(rangeDb) => setParams({ rangeDb })}
                        color={color}
                        size={64}
                    />
                </ControlGroup>
                <div className="control-note">
                    The gate opens when the level reaches the threshold and closes{' '}
                    {p.hysteresisDb.toFixed(1)} dB below it, after the hold time. The sidechain
                    filter keeps rumble from opening it.
                </div>
            </div>
        </div>
    );
}
