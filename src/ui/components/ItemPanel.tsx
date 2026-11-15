import type { ReactNode } from 'react';
import {
    defaultParams,
    isParallelGroup,
    itemInfo,
    type ChainItem,
    type Effect,
} from '../../shared/effects';
import { EffectEditor } from '../editors';
import { ParallelEditor } from '../editors/ParallelEditor';
import type { RackActions } from '../useRack';

function PanelHeader({ item, children }: { item: ChainItem; children: ReactNode }) {
    const info = itemInfo(item);
    return (
        <div className="panel-header">
            <span className="panel-title">{info.label}</span>
            <span className="panel-description">{info.description}</span>
            {item.bypass && <span className="badge">Bypassed</span>}
            <div className="header-spacer" />
            {children}
        </div>
    );
}

function EffectPanel({ effect, actions }: { effect: Effect; actions: RackActions }) {
    return (
        <>
            <PanelHeader item={effect}>
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
            <EffectEditor
                key={effect.id}
                effect={effect}
                setParams={(patch) => actions.setParams(effect.id, patch)}
            />
        </>
    );
}

/** The editor area for the selected effect or parallel group. */
export function ItemPanel({
    item,
    actions,
    hint,
}: {
    item: ChainItem | undefined;
    actions: RackActions;
    hint?: string;
}) {
    return (
        <section
            className={`panel ${item?.bypass ? 'effect-bypassed' : ''}`}
            style={item ? { ['--effect-color' as string]: itemInfo(item).color } : undefined}
        >
            {!item && (
                <div className="empty">
                    <p>The rack is empty.</p>
                    <p>Use “+ Add” to insert an effect, or pick a preset.</p>
                </div>
            )}
            {item && isParallelGroup(item) && (
                <>
                    <PanelHeader item={item}>
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
            {item && !isParallelGroup(item) && <EffectPanel effect={item} actions={actions} />}
            {hint && <div className="idle-hint">{hint}</div>}
        </section>
    );
}
