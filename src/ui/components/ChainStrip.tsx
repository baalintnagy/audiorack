import { useEffect, useRef, useState, type RefObject } from 'react';
import {
    displayOrder,
    stepSelection,
    type BranchRef,
    type ChainPosition,
} from '../../shared/chain';
import {
    EFFECT_INFO,
    PARALLEL_INFO,
    isParallelGroup,
    itemColor,
    type ChainItem,
    type Effect,
    type ParallelGroup,
} from '../../shared/effects';
import { MAX_CHAIN_LENGTH } from '../../shared/normalize';
import { BAND_COLORS } from '../editors/types';
import { branchName } from '../format';
import { css } from '../graph';
import { useCanvas } from '../useCanvas';
import { useChainDrag, type ChainDrag } from '../useChainDrag';
import { AddMenu, type AddKind } from './AddMenu';
import { ChevronIcon, PinIcon, PowerIcon } from './Controls';

export interface ChainHandlers {
    onSelect: (id: string) => void;
    onToggle: (id: string) => void;
    onRemove: (id: string) => void;
    onMove: (id: string, position: ChainPosition) => void;
    /** Adds an effect or group; at the selection when `position` is omitted. */
    onAdd: (kind: AddKind, position?: ChainPosition) => void;
}

/** Marks an item pinned open in the side panel. */
function PinBadge() {
    return (
        <span className="slot-pin" title="Pinned in the side panel">
            <PinIcon pinned />
        </span>
    );
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
            ctx.fillStyle = itemColor(effect);
            ctx.fillRect(0, 0, width * fraction, height);
        },
        [effect.id, effect.type, effect.color],
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
    pinned,
    handlers,
    drag,
}: {
    effect: Effect;
    position: ChainPosition;
    last: boolean;
    selected: boolean;
    pinned: boolean;
    handlers: ChainHandlers;
    drag: ChainDrag;
}) {
    const info = EFFECT_INFO[effect.type];
    const compact = position.branch !== undefined;
    return (
        <div
            role="listitem"
            data-item-id={effect.id}
            className={[
                'slot',
                compact ? 'compact' : '',
                info.category === 'analyzer' ? 'analyzer' : '',
                selected ? 'selected' : '',
                effect.bypass ? 'bypassed' : '',
                drag.markers(position, last),
            ].join(' ')}
            style={{ ['--slot-color' as string]: itemColor(effect) }}
            draggable
            onDragStart={(event) => drag.start(event, effect.id, false)}
            onDragEnd={drag.end}
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
                    {pinned && <PinBadge />}
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
                        {pinned && <PinBadge />}
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
    pinnedIds,
    full,
    handlers,
    drag,
}: {
    group: ParallelGroup;
    index: number;
    selectedId: string | undefined;
    pinnedIds: ReadonlySet<string>;
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
            onDragOver={(event) => drag.over(event, ref)}
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
                    pinned={pinnedIds.has(effect.id)}
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
    pinnedIds,
    full,
    handlers,
    drag,
}: {
    group: ParallelGroup;
    index: number;
    last: boolean;
    selectedId: string | undefined;
    pinnedIds: ReadonlySet<string>;
    full: boolean;
    handlers: ChainHandlers;
    drag: ChainDrag;
}) {
    return (
        <div
            role="listitem"
            data-item-id={group.id}
            className={[
                'group',
                group.id === selectedId ? 'selected' : '',
                group.bypass ? 'bypassed' : '',
                drag.markers({ index }, last),
            ].join(' ')}
            style={{ ['--slot-color' as string]: itemColor(group) }}
            draggable
            onDragStart={(event) => drag.start(event, group.id, true)}
            onDragEnd={drag.end}
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
                {pinnedIds.has(group.id) && <PinBadge />}
            </div>
            <div className="group-lanes">
                {group.branches.map((branch, branchIndex) => (
                    <BranchLane
                        key={branch.id}
                        group={group}
                        index={branchIndex}
                        selectedId={selectedId}
                        pinnedIds={pinnedIds}
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

/** Width kept clear at each scrolled edge for the scroll arrows. */
const EDGE = 32;

/** Selection steps for the keys the chain handles; Home and End go all the way. */
const SELECTION_KEYS: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    Home: -Infinity,
    End: Infinity,
};

/**
 * Whether the chain has more content past its left and right edges, and the height of its
 * horizontal scrollbar, which the scroll arrows leave uncovered. `layout` names the items in
 * display order: the chain is measured again when it changes, not on every parameter edit.
 */
function useOverflow(scroller: RefObject<HTMLDivElement | null>, layout: string) {
    const [overflow, setOverflow] = useState({ left: false, right: false, bar: 0 });
    const shown = useRef(overflow);
    useEffect(() => {
        const element = scroller.current;
        if (!element) {
            return;
        }
        const measure = () => {
            const left = element.scrollLeft > 1;
            const right = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
            // The offset height also holds the 1px top and bottom borders.
            const bar = Math.max(0, element.offsetHeight - element.clientHeight - 2);
            const previous = shown.current;
            // Only a real change sets state: an update queued on every edit, even one that
            // changes nothing, counts towards React's limit of nested updates while dragging.
            if (previous.left !== left || previous.right !== right || previous.bar !== bar) {
                shown.current = { left, right, bar };
                setOverflow(shown.current);
            }
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        element.addEventListener('scroll', measure, { passive: true });
        return () => {
            observer.disconnect();
            element.removeEventListener('scroll', measure);
        };
    }, [scroller, layout]);
    return overflow;
}

/**
 * Pages the chain left or right. Hovering it while dragging an item scrolls too, so items can
 * be dropped beyond the visible part of the chain.
 */
function ScrollArrow({
    right = false,
    onPage,
    scroller,
    bar,
}: {
    right?: boolean;
    onPage: () => void;
    scroller: RefObject<HTMLDivElement | null>;
    bar: number;
}) {
    const label = right ? 'Scroll chain right' : 'Scroll chain left';
    return (
        <button
            type="button"
            className={`chain-scroll ${right ? 'right' : 'left'}`}
            aria-label={label}
            title={label}
            tabIndex={-1}
            style={{ bottom: bar + 1 }}
            onClick={onPage}
            onDragOver={() => scroller.current?.scrollBy({ left: right ? 16 : -16 })}
        >
            <ChevronIcon right={right} />
        </button>
    );
}

const NO_PINS: ReadonlySet<string> = new Set();

export function ChainStrip({
    chain,
    selectedId,
    pinnedIds = NO_PINS,
    full,
    handlers,
}: {
    chain: ChainItem[];
    selectedId: string | undefined;
    /** Items pinned open in the side panel, marked with a pin. */
    pinnedIds?: ReadonlySet<string>;
    /** Whether the rack already holds the maximum number of effects. */
    full: boolean;
    handlers: ChainHandlers;
}) {
    const drag = useChainDrag(chain, handlers.onMove);
    const scroller = useRef<HTMLDivElement>(null);
    const layout = displayOrder(chain).join();
    const overflow = useOverflow(scroller, layout);

    // Bring the selection into view when it changes or the items around it move.
    useEffect(() => {
        const element = scroller.current;
        const item =
            selectedId === undefined
                ? null
                : element?.querySelector<HTMLElement>(`[data-item-id="${selectedId}"]`);
        if (!element || !item) {
            return;
        }
        const view = element.getBoundingClientRect();
        const box = item.getBoundingClientRect();
        // Keep the item clear of the scroll arrows.
        if (box.left < view.left + EDGE) {
            element.scrollBy({ left: box.left - view.left - EDGE, behavior: 'smooth' });
        } else if (box.right > view.right - EDGE) {
            element.scrollBy({ left: box.right - view.right + EDGE, behavior: 'smooth' });
        }
    }, [selectedId, layout]);

    const page = (direction: number) => {
        const element = scroller.current;
        element?.scrollBy({ left: direction * element.clientWidth * 0.75, behavior: 'smooth' });
    };

    return (
        <div className="chain-frame">
            <div
                ref={scroller}
                className="chain"
                role="list"
                aria-label="Effect chain"
                aria-keyshortcuts="ArrowLeft ArrowRight Home End"
                tabIndex={0}
                onDragOver={(event) => drag.over(event)}
                onDragLeave={drag.leave}
                onDrop={drag.drop}
                onWheel={(event) => {
                    // Let a regular mouse wheel scroll the horizontal chain.
                    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
                        event.currentTarget.scrollLeft += event.deltaY;
                    }
                }}
                onKeyDown={(event) => {
                    const step = SELECTION_KEYS[event.key];
                    if (step === undefined || event.altKey || event.ctrlKey || event.metaKey) {
                        return;
                    }
                    event.preventDefault();
                    const next = stepSelection(chain, selectedId, step);
                    if (next !== undefined) {
                        handlers.onSelect(next);
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
                            pinnedIds={pinnedIds}
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
                            pinned={pinnedIds.has(item.id)}
                            handlers={handlers}
                            drag={drag}
                        />
                    ),
                )}
                {chain.length === 0 && (
                    <div className="chain-empty">No effects yet — add one with + Add above</div>
                )}
                <div className="chain-io">OUT</div>
            </div>
            {overflow.left && (
                <ScrollArrow onPage={() => page(-1)} scroller={scroller} bar={overflow.bar} />
            )}
            {overflow.right && (
                <ScrollArrow right onPage={() => page(1)} scroller={scroller} bar={overflow.bar} />
            )}
        </div>
    );
}
