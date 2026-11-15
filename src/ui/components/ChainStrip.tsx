import { useRef, useState, type DragEvent } from 'react';
import type { BranchRef, ChainPosition } from '../../shared/chain';
import {
    EFFECT_INFO,
    PARALLEL_INFO,
    isParallelGroup,
    type ChainItem,
    type Effect,
    type ParallelGroup,
} from '../../shared/effects';
import { MAX_CHAIN_LENGTH } from '../../shared/normalize';
import { BAND_COLORS } from '../editors/types';
import { branchName } from '../format';
import { css } from '../graph';
import { useCanvas } from '../useCanvas';
import { AddMenu, type AddKind } from './AddMenu';
import { PowerIcon } from './Controls';

const DRAG_TYPE = 'application/x-audiorack-item';

export interface ChainHandlers {
    onSelect: (id: string) => void;
    onToggle: (id: string) => void;
    onRemove: (id: string) => void;
    onMove: (id: string, position: ChainPosition) => void;
    /** Adds an effect or group; at the selection when `position` is omitted. */
    onAdd: (kind: AddKind, position?: ChainPosition) => void;
}

interface DragState {
    id: string;
    group: boolean;
}

/** Drag and drop of chain items between the main chain and parallel branches. */
function useChainDrag(onMove: ChainHandlers['onMove']) {
    const dragged = useRef<DragState | undefined>(undefined);
    const [drop, setDrop] = useState<ChainPosition>();

    const samePosition = (position: ChainPosition) =>
        drop !== undefined &&
        drop.index === position.index &&
        drop.branch?.groupId === position.branch?.groupId &&
        drop.branch?.branchId === position.branch?.branchId;

    return {
        start(event: DragEvent<HTMLElement>, id: string, group: boolean) {
            event.stopPropagation();
            dragged.current = { id, group };
            event.dataTransfer.setData(DRAG_TYPE, id);
            event.dataTransfer.effectAllowed = 'move';
        },
        end() {
            dragged.current = undefined;
            setDrop(undefined);
        },
        /** Offers `position` as a drop target; groups only land in the main chain. */
        over(event: DragEvent<HTMLElement>, position: ChainPosition) {
            const state = dragged.current;
            if (!state || (state.group && position.branch)) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            setDrop(position);
        },
        drop(event: DragEvent<HTMLElement>) {
            event.preventDefault();
            event.stopPropagation();
            const state = dragged.current;
            if (state && drop) {
                onMove(state.id, drop);
            }
            dragged.current = undefined;
            setDrop(undefined);
        },
        /** `drop-before`/`drop-after` classes for the item at `position`. */
        markers(position: ChainPosition, last: boolean): string {
            const before = samePosition(position) ? 'drop-before' : '';
            const after =
                last && samePosition({ ...position, index: position.index + 1 })
                    ? 'drop-after'
                    : '';
            return `${before} ${after}`;
        },
        isTarget: samePosition,
    };
}

type ChainDrag = ReturnType<typeof useChainDrag>;

/** Returns the insertion index before or after the hovered element. */
function sideOf(event: DragEvent<HTMLElement>, index: number): number {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX - rect.left > rect.width / 2 ? index + 1 : index;
}

/** Small activity indicator: gain reduction for dynamics, otherwise nothing. */
function SlotActivity({ effect }: { effect: Effect }) {
    const shown = useRef(0);
    const ref = useCanvas(
        ({ ctx, width, height, telemetry, live }) => {
            const readings = telemetry?.meters.effects[effect.id] ?? [];
            // Only dynamics report gain reduction; the filter and analyzers report other data.
            const reportsReduction =
                EFFECT_INFO[effect.type].category === 'effect' && effect.type !== 'filter';
            const reduction = reportsReduction ? Math.max(0, ...readings) : 0;
            if (live) {
                shown.current = reduction > shown.current ? reduction : shown.current * 0.8;
            }
            ctx.fillStyle = css('--meter-bg');
            ctx.fillRect(0, 0, width, height);
            const fraction = Math.min(1, shown.current / 18);
            ctx.fillStyle = EFFECT_INFO[effect.type].color;
            ctx.fillRect(0, 0, width * fraction, height);
        },
        [effect.id, effect.type],
    );
    return <canvas ref={ref} className="slot-activity" />;
}

function PowerButton({
    item,
    label,
    onToggle,
}: {
    item: ChainItem;
    label: string;
    onToggle: (id: string) => void;
}) {
    return (
        <button
            type="button"
            className={`slot-power ${item.bypass ? '' : 'on'}`}
            aria-label={item.bypass ? `Enable ${label}` : `Bypass ${label}`}
            aria-pressed={!item.bypass}
            onClick={(event) => {
                event.stopPropagation();
                onToggle(item.id);
            }}
        >
            <PowerIcon />
        </button>
    );
}

function RemoveButton({
    item,
    label,
    onRemove,
}: {
    item: ChainItem;
    label: string;
    onRemove: (id: string) => void;
}) {
    return (
        <button
            type="button"
            className="slot-remove"
            aria-label={`Remove ${label}`}
            onClick={(event) => {
                event.stopPropagation();
                onRemove(item.id);
            }}
        >
            ×
        </button>
    );
}

function EffectSlot({
    effect,
    position,
    last,
    selected,
    handlers,
    drag,
}: {
    effect: Effect;
    position: ChainPosition;
    last: boolean;
    selected: boolean;
    handlers: ChainHandlers;
    drag: ChainDrag;
}) {
    const info = EFFECT_INFO[effect.type];
    const compact = position.branch !== undefined;
    return (
        <div
            role="listitem"
            className={[
                'slot',
                compact ? 'compact' : '',
                info.category === 'analyzer' ? 'analyzer' : '',
                selected ? 'selected' : '',
                effect.bypass ? 'bypassed' : '',
                drag.markers(position, last),
            ].join(' ')}
            style={{ ['--slot-color' as string]: info.color }}
            draggable
            onDragStart={(event) => drag.start(event, effect.id, false)}
            onDragEnd={drag.end}
            onDragOver={(event) =>
                drag.over(event, { ...position, index: sideOf(event, position.index) })
            }
            onDrop={drag.drop}
            onClick={(event) => {
                event.stopPropagation();
                handlers.onSelect(effect.id);
            }}
            title={`${info.label} — drag to reorder or into a parallel branch`}
        >
            {compact ? (
                <>
                    <PowerButton item={effect} label={info.label} onToggle={handlers.onToggle} />
                    <span className="slot-name">{info.short}</span>
                    <RemoveButton item={effect} label={info.label} onRemove={handlers.onRemove} />
                </>
            ) : (
                <>
                    <div className="slot-top">
                        <PowerButton
                            item={effect}
                            label={info.label}
                            onToggle={handlers.onToggle}
                        />
                        <span className="slot-index">{position.index + 1}</span>
                        <RemoveButton
                            item={effect}
                            label={info.label}
                            onRemove={handlers.onRemove}
                        />
                    </div>
                    <span className="slot-name">{info.short}</span>
                    <span className="slot-label">{info.label}</span>
                </>
            )}
            <SlotActivity effect={effect} />
        </div>
    );
}

function BranchLane({
    group,
    index,
    selectedId,
    full,
    handlers,
    drag,
}: {
    group: ParallelGroup;
    index: number;
    selectedId: string | undefined;
    full: boolean;
    handlers: ChainHandlers;
    drag: ChainDrag;
}) {
    const branch = group.branches[index];
    const ref: BranchRef = { groupId: group.id, branchId: branch.id };
    const end: ChainPosition = { branch: ref, index: branch.effects.length };
    return (
        <div
            className={[
                'lane',
                branch.mute ? 'muted' : '',
                branch.effects.length === 0 && drag.isTarget(end) ? 'drop-into' : '',
            ].join(' ')}
            style={{ ['--lane-color' as string]: BAND_COLORS[index] }}
            role="list"
            aria-label={`Branch ${branchName(index)}`}
            onDragOver={(event) => drag.over(event, end)}
            onDrop={drag.drop}
        >
            <span className="lane-label" title={branch.mute ? 'Muted' : undefined}>
                {branchName(index)}
            </span>
            {branch.effects.map((effect, effectIndex) => (
                <EffectSlot
                    key={effect.id}
                    effect={effect}
                    position={{ branch: ref, index: effectIndex }}
                    last={effectIndex === branch.effects.length - 1}
                    selected={effect.id === selectedId}
                    handlers={handlers}
                    drag={drag}
                />
            ))}
            {branch.effects.length === 0 && <span className="lane-dry">Dry</span>}
            <AddMenu
                variant="lane"
                disabled={full}
                disabledReason={`The rack holds up to ${MAX_CHAIN_LENGTH} effects`}
                onAdd={(kind) => handlers.onAdd(kind, end)}
            />
        </div>
    );
}

function GroupBlock({
    group,
    index,
    last,
    selectedId,
    full,
    handlers,
    drag,
}: {
    group: ParallelGroup;
    index: number;
    last: boolean;
    selectedId: string | undefined;
    full: boolean;
    handlers: ChainHandlers;
    drag: ChainDrag;
}) {
    return (
        <div
            role="listitem"
            className={[
                'group',
                group.id === selectedId ? 'selected' : '',
                group.bypass ? 'bypassed' : '',
                drag.markers({ index }, last),
            ].join(' ')}
            style={{ ['--slot-color' as string]: PARALLEL_INFO.color }}
            draggable
            onDragStart={(event) => drag.start(event, group.id, true)}
            onDragEnd={drag.end}
            onDragOver={(event) => drag.over(event, { index: sideOf(event, index) })}
            onDrop={drag.drop}
            onClick={() => handlers.onSelect(group.id)}
            title="Parallel group — drag effects into its branches"
        >
            <div className="group-head">
                <PowerButton
                    item={group}
                    label={PARALLEL_INFO.label}
                    onToggle={handlers.onToggle}
                />
                <span className="group-name">{PARALLEL_INFO.short}</span>
            </div>
            <div className="group-lanes">
                {group.branches.map((branch, branchIndex) => (
                    <BranchLane
                        key={branch.id}
                        group={group}
                        index={branchIndex}
                        selectedId={selectedId}
                        full={full}
                        handlers={handlers}
                        drag={drag}
                    />
                ))}
            </div>
            <RemoveButton item={group} label={PARALLEL_INFO.label} onRemove={handlers.onRemove} />
        </div>
    );
}

export function ChainStrip({
    chain,
    selectedId,
    full,
    handlers,
}: {
    chain: ChainItem[];
    selectedId: string | undefined;
    /** Whether the rack already holds the maximum number of effects. */
    full: boolean;
    handlers: ChainHandlers;
}) {
    const drag = useChainDrag(handlers.onMove);
    return (
        <div
            className="chain"
            role="list"
            aria-label="Effect chain"
            onWheel={(event) => {
                // Let a regular mouse wheel scroll the horizontal chain.
                if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
                    event.currentTarget.scrollLeft += event.deltaY;
                }
            }}
        >
            <div className="chain-io">IN</div>
            {chain.map((item, index) =>
                isParallelGroup(item) ? (
                    <GroupBlock
                        key={item.id}
                        group={item}
                        index={index}
                        last={index === chain.length - 1}
                        selectedId={selectedId}
                        full={full}
                        handlers={handlers}
                        drag={drag}
                    />
                ) : (
                    <EffectSlot
                        key={item.id}
                        effect={item}
                        position={{ index }}
                        last={index === chain.length - 1}
                        selected={item.id === selectedId}
                        handlers={handlers}
                        drag={drag}
                    />
                ),
            )}
            <AddMenu
                variant="slot"
                disabled={full}
                disabledReason={`The rack holds up to ${MAX_CHAIN_LENGTH} effects`}
                onAdd={(kind) => handlers.onAdd(kind)}
            />
            <div className="chain-io">OUT</div>
        </div>
    );
}
