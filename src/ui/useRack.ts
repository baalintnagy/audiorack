import { useCallback, useEffect, useRef, useState } from 'react';
import {
    createEffect,
    type Effect,
    type EffectParamsMap,
    type EffectType,
    type RackState,
} from '../shared/effects';
import { MAX_CHAIN_LENGTH, normalizeRack } from '../shared/normalize';
import { loadRack, onRackChanged, saveRack } from '../shared/storage';
import type { Backend } from './backend';

const PUSH_INTERVAL_MS = 30;
const SAVE_DELAY_MS = 300;

export interface RackActions {
    setRack: (rack: RackState) => void;
    update: (updater: (rack: RackState) => RackState) => void;
    updateEffect: (id: string, updater: (effect: Effect) => Effect) => void;
    setParams: <T extends EffectType>(id: string, patch: Partial<EffectParamsMap[T]>) => void;
    addEffect: (type: EffectType, index?: number) => Effect | undefined;
    removeEffect: (id: string) => void;
    moveEffect: (id: string, toIndex: number) => void;
}

export function useRack(backend: Backend | undefined): [RackState | undefined, RackActions] {
    const [rack, setRackState] = useState<RackState>();
    const lastSaved = useRef('');
    const pushTimer = useRef<number | undefined>(undefined);
    const lastPush = useRef(0);

    useEffect(() => {
        if (!backend) {
            return;
        }
        let cancelled = false;
        void loadRack().then((loaded) => {
            if (!cancelled) {
                lastSaved.current = JSON.stringify(loaded);
                setRackState(loaded);
                backend.pushRack(loaded);
            }
        });
        const stop = onRackChanged((changed) => {
            const serialized = JSON.stringify(changed);
            if (serialized !== lastSaved.current) {
                lastSaved.current = serialized;
                setRackState(changed);
            }
        });
        return () => {
            cancelled = true;
            stop();
        };
    }, [backend]);

    // Push to the engine at a bounded rate, always delivering the final state.
    useEffect(() => {
        if (!rack || !backend) {
            return;
        }
        const push = () => {
            lastPush.current = performance.now();
            pushTimer.current = undefined;
            backend.pushRack(rack);
        };
        window.clearTimeout(pushTimer.current);
        const wait = PUSH_INTERVAL_MS - (performance.now() - lastPush.current);
        if (wait <= 0) {
            push();
        } else {
            pushTimer.current = window.setTimeout(push, wait);
        }
    }, [rack, backend]);

    useEffect(() => {
        if (!rack) {
            return;
        }
        const timer = window.setTimeout(() => {
            const serialized = JSON.stringify(rack);
            if (serialized !== lastSaved.current) {
                lastSaved.current = serialized;
                void saveRack(rack);
            }
        }, SAVE_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [rack]);

    const update = useCallback((updater: (rack: RackState) => RackState) => {
        setRackState((previous) => (previous ? updater(previous) : previous));
    }, []);

    const updateEffect = useCallback(
        (id: string, updater: (effect: Effect) => Effect) =>
            update((previous) => ({
                ...previous,
                chain: previous.chain.map((effect) =>
                    effect.id === id ? updater(effect) : effect,
                ),
            })),
        [update],
    );

    const setParams = useCallback(
        <T extends EffectType>(id: string, patch: Partial<EffectParamsMap[T]>) =>
            updateEffect(
                id,
                (effect) => ({ ...effect, params: { ...effect.params, ...patch } }) as Effect,
            ),
        [updateEffect],
    );

    const addEffect = useCallback(
        (type: EffectType, index?: number) => {
            if (!rack || rack.chain.length >= MAX_CHAIN_LENGTH) {
                return undefined;
            }
            const effect = createEffect(type) as Effect;
            update((previous) => {
                const chain = [...previous.chain];
                chain.splice(index ?? chain.length, 0, effect);
                return { ...previous, chain };
            });
            return effect;
        },
        [update, rack],
    );

    const removeEffect = useCallback(
        (id: string) =>
            update((previous) => ({
                ...previous,
                chain: previous.chain.filter((effect) => effect.id !== id),
            })),
        [update],
    );

    const moveEffect = useCallback(
        (id: string, toIndex: number) =>
            update((previous) => {
                const from = previous.chain.findIndex((effect) => effect.id === id);
                if (from < 0) {
                    return previous;
                }
                const chain = [...previous.chain];
                const [moved] = chain.splice(from, 1);
                chain.splice(Math.min(Math.max(toIndex, 0), chain.length), 0, moved);
                return { ...previous, chain };
            }),
        [update],
    );

    const setRack = useCallback((next: RackState) => setRackState(normalizeRack(next)), []);

    return [
        rack,
        { setRack, update, updateEffect, setParams, addEffect, removeEffect, moveEffect },
    ];
}
