import { BRANCH_METER_VALUES } from '../../dsp/parallel';
import {
    EFFECT_INFO,
    MAX_BRANCHES,
    MIN_BRANCHES,
    SPECS,
    createBranch,
    type ParallelBranch,
    type ParallelGroup,
} from '../../shared/effects';
import type { Telemetry } from '../../shared/messages';
import { Toggle } from '../components/Controls';
import { Fader } from '../components/Fader';
import { Knob } from '../components/Knob';
import { LevelMeter } from '../components/Meters';
import { branchName } from '../format';
import { BAND_COLORS } from './types';

const FADER_MARKS = [12, 6, 0, -6, -12, -24, -48];
const MUTE_COLOR = '#ff5e7a';
const SOLO_COLOR = '#ffd84f';

/** Stereo levels of meter slot `index` of a group: a branch, or the sum after the branches. */
function groupLevels(telemetry: Telemetry, groupId: string, index: number) {
    const readings = telemetry.meters.effects[groupId] ?? [];
    const at = (offset: number) => readings[index * BRANCH_METER_VALUES + offset] ?? 0;
    return {
        peak: [at(0), at(1)] as [number, number],
        rms: [at(2), at(3)] as [number, number],
    };
}

/** One mixer channel strip: polarity, pan, mute/solo and a fader with a post-fader meter. */
function ChannelStrip({
    group,
    index,
    onChange,
    onRemove,
}: {
    group: ParallelGroup;
    index: number;
    onChange: (patch: Partial<ParallelBranch>) => void;
    onRemove?: () => void;
}) {
    const branch = group.branches[index];
    const color = BAND_COLORS[index];
    const path = branch.effects.map((effect) => EFFECT_INFO[effect.type].short).join(' → ');
    const silenced = branch.mute || (!branch.solo && group.branches.some((other) => other.solo));
    return (
        <div
            className={`strip ${silenced ? 'silenced' : ''}`}
            style={{ ['--strip-color' as string]: color }}
        >
            <div className="strip-head">
                <strong>{branchName(index)}</strong>
                {onRemove && (
                    <button
                        type="button"
                        className="slot-remove"
                        aria-label={`Remove branch ${branchName(index)}`}
                        title={
                            branch.effects.length > 0
                                ? 'Remove this branch and its effects'
                                : 'Remove this branch'
                        }
                        onClick={onRemove}
                    >
                        ×
                    </button>
                )}
            </div>
            <small className="strip-path" title={path || undefined}>
                {path || 'Dry'}
            </small>
            <Toggle
                className="strip-invert"
                active={branch.invert}
                onChange={(invert) => onChange({ invert })}
                color={color}
                title="Invert polarity"
            >
                Ø
            </Toggle>
            <Knob
                spec={SPECS.pan}
                value={branch.pan}
                onChange={(pan) => onChange({ pan })}
                color={color}
                size={34}
            />
            <div className="strip-buttons">
                <Toggle
                    active={branch.mute}
                    onChange={(mute) => onChange({ mute })}
                    color={MUTE_COLOR}
                    title="Mute"
                >
                    M
                </Toggle>
                <Toggle
                    active={branch.solo}
                    onChange={(solo) => onChange({ solo })}
                    color={SOLO_COLOR}
                    title="Solo: hear only soloed branches"
                >
                    S
                </Toggle>
            </div>
            <div className="strip-fader">
                <Fader
                    spec={SPECS.branchGainDb}
                    value={branch.gainDb}
                    onChange={(gainDb) => onChange({ gainDb })}
                    marks={FADER_MARKS}
                    label={`Branch ${branchName(index)} level`}
                    color={color}
                />
                <LevelMeter
                    label=""
                    source={(telemetry) => groupLevels(telemetry, group.id, index)}
                />
            </div>
        </div>
    );
}

export function ParallelEditor({
    group,
    update,
}: {
    group: ParallelGroup;
    update: (updater: (group: ParallelGroup) => ParallelGroup) => void;
}) {
    const setBranch = (id: string, patch: Partial<ParallelBranch>) =>
        update((previous) => ({
            ...previous,
            branches: previous.branches.map((branch) =>
                branch.id === id ? { ...branch, ...patch } : branch,
            ),
        }));
    const removeBranch = (id: string) =>
        update((previous) => ({
            ...previous,
            branches: previous.branches.filter((branch) => branch.id !== id),
        }));
    const addBranch = () =>
        update((previous) => ({ ...previous, branches: [...previous.branches, createBranch()] }));
    const removable = group.branches.length > MIN_BRANCHES;
    return (
        <div className="editor parallel-editor">
            <div className="mixer">
                {group.branches.map((branch, index) => (
                    <ChannelStrip
                        key={branch.id}
                        group={group}
                        index={index}
                        onChange={(patch) => setBranch(branch.id, patch)}
                        onRemove={removable ? () => removeBranch(branch.id) : undefined}
                    />
                ))}
                {group.branches.length < MAX_BRANCHES && (
                    <button type="button" className="strip-add" onClick={addBranch}>
                        <span className="add-plus">+</span>
                        Branch
                    </button>
                )}
                <div className="strip sum">
                    <div className="strip-head">
                        <strong>Sum</strong>
                    </div>
                    <LevelMeter
                        label=""
                        source={(telemetry) =>
                            groupLevels(telemetry, group.id, group.branches.length)
                        }
                    />
                </div>
                <p className="control-note parallel-note">
                    Every branch receives the same input and the outputs are summed. An empty branch
                    carries the dry signal, so a compressor next to it gives parallel compression.
                    Drag effects into the branches in the chain above; branches are
                    delay-compensated for effects with lookahead.
                </p>
            </div>
        </div>
    );
}
