import { useEffect } from 'react';
import { findItem } from '../shared/chain';
import { itemInfo } from '../shared/effects';
import type { Backend } from './backend';
import { ItemPanel } from './components/ItemPanel';
import { TelemetryContext } from './telemetry';
import { useEngine } from './useEngine';
import { useRack } from './useRack';

const TITLE = 'AudioRack';

/**
 * One effect or parallel group of the rack in a window of its own, so several can be watched
 * side by side. It edits the same rack as the main window and follows its changes.
 */
export function ItemWindow({ backend, itemId }: { backend: Backend; itemId: string }) {
    const { status, store } = useEngine(backend);
    const { rack, actions } = useRack(backend);
    const item = rack && findItem(rack.chain, itemId);
    const label = item && itemInfo(item).label;

    useEffect(() => {
        document.documentElement.classList.add('item-window');
    }, []);

    useEffect(() => {
        document.title = label ? `${label} · ${TITLE}` : TITLE;
    }, [label]);

    if (!rack) {
        return <div className="loading">Loading rack…</div>;
    }

    return (
        <TelemetryContext.Provider value={store}>
            <div className={`app ${rack.bypass ? 'rack-bypassed' : ''}`}>
                {item ? (
                    <ItemPanel
                        item={item}
                        placement={{ kind: 'window' }}
                        actions={actions}
                        hint={
                            status.active
                                ? undefined
                                : 'Press “Process tab” in the rack to route this tab through it'
                        }
                    />
                ) : (
                    <section className="panel">
                        <div className="empty">
                            <p>This item is no longer in the rack.</p>
                        </div>
                    </section>
                )}
            </div>
        </TelemetryContext.Provider>
    );
}
