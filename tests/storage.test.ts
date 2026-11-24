// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createEffect, createParallelGroup, defaultRack, type Effect } from '../src/shared/effects';
import {
    forgetTab,
    loadPanelPins,
    loadUserPresets,
    presetPins,
    resolveTabRack,
    savePanelPins,
    saveUserPresets,
    setTabScope,
    sharedRackStore,
    tabRackStore,
} from '../src/shared/storage';

describe('rack storage', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    it('gives each tab its own copy of the shared rack by default', async () => {
        const shared = { ...defaultRack(), inputDb: 2 };
        await sharedRackStore.save(shared);
        expect(await resolveTabRack(7)).toEqual({ rack: shared, scope: 'tab' });

        // Later changes to the shared rack do not reach a tab that already has its copy.
        await sharedRackStore.save({ ...shared, inputDb: 5 });
        expect((await resolveTabRack(7)).rack.inputDb).toBe(2);
        expect((await resolveTabRack(8)).rack.inputDb).toBe(5);
    });

    it('lets a tab follow the shared rack and switch back to its own', async () => {
        const shared = { ...defaultRack(), inputDb: 2 };
        await sharedRackStore.save(shared);
        await setTabScope(7, 'shared', shared);
        expect(await resolveTabRack(7)).toEqual({ rack: shared, scope: 'shared' });
        expect(await tabRackStore(7).load()).toBeUndefined();

        const own = { ...defaultRack(), chain: [createParallelGroup()] };
        await setTabScope(7, 'tab', own);
        expect(await resolveTabRack(7)).toEqual({ rack: own, scope: 'tab' });

        await setTabScope(7, 'shared', shared);
        await forgetTab(7);
        expect((await resolveTabRack(7)).scope).toBe('tab');
    });

    it('validates stored racks', async () => {
        sessionStorage.setItem('audiorack:tabRack:3', JSON.stringify({ chain: [{ type: 'x' }] }));
        const { rack, scope } = await resolveTabRack(3);
        expect(scope).toBe('tab');
        expect(rack.chain).toEqual([]);
    });

    it('keeps side panel pins per tab and forgets them with the tab', async () => {
        await savePanelPins(4, ['fx-1', 'fx-2']);
        expect(await loadPanelPins(4)).toEqual(['fx-1', 'fx-2']);
        expect(await loadPanelPins(5)).toEqual([]);
        await forgetTab(4);
        expect(await loadPanelPins(4)).toEqual([]);
    });

    it('validates stored pins', async () => {
        sessionStorage.setItem('audiorack:panelPins:4', JSON.stringify(['a', 3, '', 'a', 'b']));
        expect(await loadPanelPins(4)).toEqual(['a', 'b']);
        sessionStorage.setItem('audiorack:panelPins:4', JSON.stringify({ a: 1 }));
        expect(await loadPanelPins(4)).toEqual([]);
    });

    it('keeps side panel pins with user presets, dropping stale ones', async () => {
        const eq = createEffect('eq') as Effect;
        const limiter = createEffect('limiter') as Effect;
        const rack = { ...defaultRack(), chain: [eq, limiter] };
        await saveUserPresets([
            { name: 'Pinned', rack, pins: [limiter.id, 'gone', eq.id, limiter.id] },
            { name: 'Plain', rack },
        ]);
        const [pinned, plain] = await loadUserPresets();
        expect(pinned.pins).toEqual([eq.id, limiter.id]);
        expect(plain.pins).toBeUndefined();
    });

    it('validates pins read from preset files', () => {
        const eq = createEffect('eq') as Effect;
        const rack = { ...defaultRack(), chain: [eq] };
        expect(presetPins(rack, [eq.id, 4, ''])).toEqual([eq.id]);
        expect(presetPins(rack, 'nope')).toEqual([]);
        expect(presetPins(rack, undefined)).toEqual([]);
    });
});
