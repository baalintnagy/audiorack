import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Chain from '../shared/chain';
import type { ChainPosition } from '../shared/chain';
import type {
    ChainItem,
    Effect,
    EffectParamsMap,
    EffectType,
    ParallelGroup,
    RackState,
} from '../shared/effects';
import { normalizeRack } from '../shared/normalize';
import {
    loadSharedRack,
    resolveTabRack,
    setTabScope,
    sharedRackStore,
    tabRackStore,
    type RackScope,
    type RackStore,
} from '../shared/storage';
import type { Backend } from './backend';

const PUSH_INTERVAL_MS = 30;
const SAVE_DELAY_MS = 300;

export interface RackActions {
    setRack: (rack: RackState) => void;
    update: (updater: (rack: RackState) => RackState) => void;
    updateEffect: (id: string, updater: (effect: Effect) => Effect) => void;
    setParams: <T extends EffectType>(id: string, patch: Partial<EffectParamsMap[T]>) => void;
    updateGroup: (id: string, updater: (group: ParallelGroup) => ParallelGroup) => void;
    /** Inserts at `position` (default: end of the main chain); false when over the limits. */
    addItem: (item: ChainItem, position?: ChainPosition) => boolean;
    removeItem: (id: string) => void;
    moveItem: (id: string, position: ChainPosition) => void;
    ungroup: (id: string) => void;
    /** Switches between the shared rack and a rack of this tab's own. */
    setScope: (scope: RackScope) => Promise<void>;
}

export interface RackModel {
    rack: RackState | undefined;
    scope: RackScope;
    /** Whether this page knows its tab, so the rack can be scoped to it. */
    canScopeToTab: boolean;
    actions: RackActions;
}

export function useRack(backend: Backend | undefined): RackModel {
    const [rack, setRackState] = useState<RackState>();
    const [scope, setScopeState] = useState<RackScope>('shared');
    const lastSaved = useRef('');
    const pushTimer = useRef<number | undefined>(undefined);
    const lastPush = useRef(0);
    const tabId = backend?.tabId !== undefined && backend.tabId >= 0 ? backend.tabId : undefined;
    const tabStore = useMemo(
        () => (tabId === undefined ? undefined : tabRackStore(tabId)),
        [tabId],
    );
    const store: RackStore = scope === 'tab' && tabStore ? tabStore : sharedRackStore;

    const show = useCallback((next: RackState, nextScope: RackScope) => {
        lastSaved.current = JSON.stringify(next);
        setScopeState(nextScope);
        setRackState(next);
    }, []);

    useEffect(() => {
        if (!backend) {
            return;
        }
        let cancelled = false;
        void (async () => {
            const loaded =
                tabId === undefined
                    ? { rack: await loadSharedRack(), scope: 'shared' as const }
                    : await resolveTabRack(tabId);
            if (!cancelled) {
                show(loaded.rack, loaded.scope);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [backend, tabId, show]);

    // Follow edits made in another window showing the same rack.
    useEffect(
        () =>
            store.subscribe((changed) => {
                if (!changed) {
                    // Another window returned this tab to the shared rack.
                    void loadSharedRack().then((shared) => show(shared, 'shared'));
                    return;
                }
                const serialized = JSON.stringify(changed);
                if (serialized !== lastSaved.current) {
                    lastSaved.current = serialized;
                    setRackState(changed);
                }
            }),
        [store, show],
    );

    // Push to the engine at a bounded rate, always delivering the final state.
    useEffect(() => {
        if (!rack || !backend) {
            return;
        }
        const push = () => {
            lastPush.current = performance.now();
            pushTimer.current = undefined;
            backend.pushRack(rack, scope);
        };
        window.clearTimeout(pushTimer.current);
        const wait = PUSH_INTERVAL_MS - (performance.now() - lastPush.current);
        if (wait <= 0) {
            push();
        } else {
            pushTimer.current = window.setTimeout(push, wait);
        }
    }, [rack, scope, backend]);

    useEffect(() => {
        if (!rack) {
            return;
        }
        const timer = window.setTimeout(() => {
            const serialized = JSON.stringify(rack);
            if (serialized !== lastSaved.current) {
                lastSaved.current = serialized;
                void store.save(rack);
            }
        }, SAVE_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [rack, store]);

    const update = useCallback((updater: (rack: RackState) => RackState) => {
        setRackState((previous) => (previous ? updater(previous) : previous));
    }, []);

    const updateChain = useCallback(
        (edit: (chain: ChainItem[]) => ChainItem[]) =>
            update((previous) => ({ ...previous, chain: edit(previous.chain) })),
        [update],
    );

    const updateEffect = useCallback(
        (id: string, updater: (effect: Effect) => Effect) =>
            updateChain((chain) => Chain.mapEffect(chain, id, updater)),
        [updateChain],
    );

    const setParams = useCallback(
        <T extends EffectType>(id: string, patch: Partial<EffectParamsMap[T]>) =>
            updateEffect(
                id,
                (effect) => ({ ...effect, params: { ...effect.params, ...patch } }) as Effect,
            ),
        [updateEffect],
    );

    const updateGroup = useCallback(
        (id: string, updater: (group: ParallelGroup) => ParallelGroup) =>
            updateChain((chain) => Chain.mapGroup(chain, id, updater)),
        [updateChain],
    );

    const addItem = useCallback(
        (item: ChainItem, position?: ChainPosition) => {
            if (!rack || !Chain.canInsert(rack.chain, item)) {
                return false;
            }
            updateChain((chain) =>
                Chain.insertItem(chain, item, position ?? { index: chain.length }),
            );
            return true;
        },
        [updateChain, rack],
    );

    const removeItem = useCallback(
        (id: string) => updateChain((chain) => Chain.removeItem(chain, id)),
        [updateChain],
    );

    const moveItem = useCallback(
        (id: string, position: ChainPosition) =>
            updateChain((chain) => Chain.moveItem(chain, id, position)),
        [updateChain],
    );

    const ungroup = useCallback(
        (id: string) => updateChain((chain) => Chain.ungroup(chain, id)),
        [updateChain],
    );

    const setScope = useCallback(
        async (next: RackScope) => {
            if (!rack || tabId === undefined || next === scope) {
                return;
            }
            if (next === 'tab') {
                // Keep the shared rack as it is now, then give the tab a copy of it.
                if (JSON.stringify(rack) !== lastSaved.current) {
                    await store.save(rack);
                }
                show(rack, 'tab');
                await setTabScope(tabId, 'tab', rack);
                return;
            }
            const shared = await loadSharedRack();
            show(shared, 'shared');
            await setTabScope(tabId, 'shared', shared);
        },
        [rack, scope, store, tabId, show],
    );

    const setRack = useCallback((next: RackState) => setRackState(normalizeRack(next)), []);

    return {
        rack,
        scope,
        canScopeToTab: tabId !== undefined,
        actions: {
            setRack,
            update,
            updateEffect,
            setParams,
            updateGroup,
            addItem,
            removeItem,
            moveItem,
            ungroup,
            setScope,
        },
    };
}
