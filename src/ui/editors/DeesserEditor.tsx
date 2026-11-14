import { biquadCoefficients } from '../../dsp/biquad';
import { SPECS } from '../../shared/effects';
import type { Telemetry } from '../../shared/messages';
import { ControlGroup, Segmented, Toggle } from '../components/Controls';
import { Knob } from '../components/Knob';
import { DynamicsHistory, ReductionMeter } from '../components/Meters';
import { ResponseGraph } from '../components/ResponseGraph';
import { css, frequencyToX } from '../graph';
import type { EditorProps } from './types';

export function DeesserEditor({ effect, setParams, color }: EditorProps<'deesser'>) {
    const p = effect.params;
    const reduction = (telemetry: Telemetry) => telemetry.meters.effects[effect.id]?.[0] ?? 0;
    return (
        <div className="editor dynamics-editor">
            <div className="display split">
                <ResponseGraph
                    color={color}
                    range={24}
                    deps={[p]}
                    title="Drag to set the detection frequency"
                    sections={(sampleRate) => [
                        biquadCoefficients('bandpass', p.frequency, 1.2, 0, sampleRate),
                    ]}
                    overlay={({ ctx, width, height }) => {
                        if (p.mode === 'split') {
                            const x = frequencyToX(p.frequency * 0.7, width);
                            ctx.fillStyle = css('--overlay-band');
                            ctx.fillRect(x, 0, width - x, height);
                            ctx.fillStyle = css('--grid-label');
                            ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
                            ctx.fillText('processed band', x + 6, 14);
                        }
                    }}
                    node={{
                        frequency: p.frequency,
                        db: 0,
                        onDrag: (frequency) =>
                            setParams({
                                frequency: Math.round(
                                    Math.min(
                                        SPECS.deessFrequency.max,
                                        Math.max(SPECS.deessFrequency.min, frequency),
                                    ),
                                ),
                            }),
                    }}
                />
                <DynamicsHistory reduction={reduction} color={color} range={24} />
                <ReductionMeter value={reduction} color={color} range={24} />
            </div>
            <div className="control-row">
                <ControlGroup title="Detection">
                    <Knob
                        spec={SPECS.deessFrequency}
                        value={p.frequency}
                        onChange={(frequency) => setParams({ frequency })}
                        color={color}
                    />
                    <Knob
                        spec={SPECS.deessThresholdDb}
                        value={p.thresholdDb}
                        onChange={(thresholdDb) => setParams({ thresholdDb })}
                        color={color}
                    />
                    <Knob
                        spec={SPECS.rangeDb}
                        value={p.rangeDb}
                        onChange={(rangeDb) => setParams({ rangeDb })}
                        color={color}
                    />
                    <Knob
                        spec={SPECS.deessReleaseMs}
                        value={p.releaseMs}
                        onChange={(releaseMs) => setParams({ releaseMs })}
                        color={color}
                    />
                </ControlGroup>
                <ControlGroup title="Mode">
                    <div className="stack">
                        <Segmented
                            value={p.mode}
                            options={[
                                { value: 'split', label: 'Split' },
                                { value: 'wide', label: 'Wide' },
                            ]}
                            onChange={(mode) => setParams({ mode })}
                            color={color}
                        />
                        <Toggle
                            active={p.listen}
                            onChange={(listen) => setParams({ listen })}
                            color={color}
                            title="Hear only the detected sibilance"
                        >
                            Listen
                        </Toggle>
                    </div>
                </ControlGroup>
            </div>
        </div>
    );
}
