import { useState, type ReactNode } from 'react';
import {
    defaultParams,
    EFFECT_INFO,
    isParallelGroup,
    itemColor,
    itemInfo,
    type ChainItem,
    type Effect,
} from '../../shared/effects';
import { EffectEditor } from '../editors';
import { ParallelEditor } from '../editors/ParallelEditor';
import { TelemetryContext, useFreezableTelemetry } from '../telemetry';
import type { RackActions } from '../useRack';
import { ColorPicker } from './ColorPicker';
import { PinIcon, PopOutIcon, Toggle } from './Controls';

/**
 * Where the panel is shown: the rack window can pop the item out, a rack in the side panel can
 * also pin it open, and a window of the item's own replaces the chain strip's power button with
 * a bypass toggle.
 */
export type PanelPlacement =
    | { kind: 'rack'; onPopOut?: () => void; pin?: { pinned: boolean; onToggle: () => void } }
    | { kind: 'window' };

function WindowControls({
    item,
    placement,
    actions,
}: {
    item: ChainItem;
    placement: PanelPlacement;
    actions: RackActions;
}) {
    if (placement.kind === 'window') {
        return (
            <Toggle
                active={item.bypass}
                onChange={() => actions.toggleBypass(item.id)}
                color="#ff5e7a"
                title="Compare with the signal skipping this item"
            >
                Bypass
            </Toggle>
        );
    }
    const { pin, onPopOut } = placement;
    const pinLabel = pin?.pinned ? 'Unpin from the side panel' : 'Keep open in the side panel';
    return (
        <>
            {pin && (
                <button
                    type="button"
                    className={`ghost small icon pin-button ${pin.pinned ? 'on' : ''}`}
                    onClick={pin.onToggle}
                    title={pinLabel}
                    aria-label={pinLabel}
                    aria-pressed={pin.pinned}
                >
                    <PinIcon pinned={pin.pinned} />
                </button>
            )}
            {onPopOut && (
                <button
                    type="button"
                    className="ghost small icon"
                    onClick={onPopOut}
                    title="Open in a window of its own"
                    aria-label="Open in a window of its own"
                >
                    <PopOutIcon />
                </button>
            )}
        </>
    );
}

function PanelHeader({
    item,
    placement,
    actions,
    children,
}: {
    item: ChainItem;
    placement: PanelPlacement;
    actions: RackActions;
    children: ReactNode;
}) {
    const info = itemInfo(item);
    return (
        <div className="panel-header">
            <ColorPicker
                color={item.color}
                fallback={info.color}
                onChange={(color) => actions.setColor(item.id, color)}
            />
            <span className="panel-title">{info.label}</span>
            <span className="panel-description">{info.description}</span>
            {item.bypass && <span className="badge">Bypassed</span>}
            <div className="header-spacer" />
            {children}
            <WindowControls item={item} placement={placement} actions={actions} />
        </div>
    );
}

/**
 * An effect's header and editor. An analyzer can be frozen from its header: its editor then gets
 * a telemetry store that holds still, so everything it shows stops on the last readings while
 * the engine, and any measurement such as loudness, carries on.
 */
function EffectPanel({
    effect,
    placement,
    actions,
    frozen,
    onFreeze,
}: {
    effect: Effect;
    placement: PanelPlacement;
    actions: RackActions;
    frozen: boolean;
    onFreeze: (frozen: boolean) => void;
}) {
    const telemetry = useFreezableTelemetry(frozen);
    return (
        <>
            <PanelHeader item={effect} placement={placement} actions={actions}>
                {EFFECT_INFO[effect.type].category === 'analyzer' && (
                    <Toggle
                        active={frozen}
                        onChange={onFreeze}
                        color={itemColor(effect)}
                        title="Hold what the analyzer shows; it keeps measuring"
                        className="small"
                    >
                        Freeze
                    </Toggle>
                )}
                <button
                    type="button"
                    className="ghost small"
                    onClick={() =>
                        actions.updateEffect(
                            effect.id,
                            (previous) =>
                                ({ ...previous, params: defaultParams(previous.type) }) as Effect,
                        )
                    }
                >
                    Reset
                </button>
            </PanelHeader>
            <TelemetryContext.Provider value={telemetry}>
                <EffectEditor
                    key={effect.id}
                    effect={effect}
                    setParams={(patch) => actions.setParams(effect.id, patch)}
                />
            </TelemetryContext.Provider>
        </>
    );
}

/** The editor area for an effect or parallel group; `selected` marks it among several. */
export function ItemPanel({
    item,
    placement,
    actions,
    hint,
    selected = false,
}: {
    item: ChainItem | undefined;
    placement: PanelPlacement;
    actions: RackActions;
    hint?: string;
    selected?: boolean;
}) {
    // Which analyzer is frozen; kept by id, so a panel that shows another one starts live.
    const [frozenId, setFrozenId] = useState<string>();
    const frozen = item !== undefined && frozenId === item.id;
    return (
        <section
            className={`panel ${item?.bypass ? 'effect-bypassed' : ''} ${selected ? 'selected' : ''} ${frozen ? 'frozen' : ''}`}
            data-item-id={item?.id}
            style={item ? { ['--effect-color' as string]: itemColor(item) } : undefined}
        >
            {!item && (
                <div className="empty">
                    <p>The rack is empty.</p>
                    <p>Use “+ Add” to insert an effect, or pick a preset.</p>
                </div>
            )}
            {item && isParallelGroup(item) && (
                <>
                    <PanelHeader item={item} placement={placement} actions={actions}>
                        <button
                            type="button"
                            className="ghost small"
                            onClick={() => actions.ungroup(item.id)}
                            title="Replace the group with its effects in series"
                        >
                            Flatten
                        </button>
                    </PanelHeader>
                    <ParallelEditor
                        group={item}
                        update={(updater) => actions.updateGroup(item.id, updater)}
                    />
                </>
            )}
            {item && !isParallelGroup(item) && (
                <EffectPanel
                    effect={item}
                    placement={placement}
                    actions={actions}
                    frozen={frozen}
                    onFreeze={(next) => setFrozenId(next ? item.id : undefined)}
                />
            )}
            {hint && <div className="idle-hint">{hint}</div>}
        </section>
    );
}
