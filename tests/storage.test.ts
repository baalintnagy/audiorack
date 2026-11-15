// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createParallelGroup, defaultRack } from '../src/shared/effects';
import {
    forgetTab,
    resolveTabRack,
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
});
