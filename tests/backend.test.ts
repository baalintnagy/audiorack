import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBackend, type BackendStatus } from '../src/ui/backend';

type TabListener = (tabId: number, change: { title?: string; status?: string }) => void;

/** Just enough of the extension API for a rack page of tab 7, which is being processed. */
function fakeChrome(title: string) {
    const tabListeners = new Set<TabListener>();
    const event = (listeners: Set<TabListener>) => ({
        addListener: (listener: TabListener) => listeners.add(listener),
        removeListener: (listener: TabListener) => listeners.delete(listener),
    });
    vi.stubGlobal('location', { search: '?tab=7' });
    vi.stubGlobal('chrome', {
        runtime: { id: 'audiorack', sendMessage: async () => ({ capturing: true, sessions: [7] }) },
        tabs: { get: async () => ({ id: 7, title }), onUpdated: event(tabListeners) },
        storage: { onChanged: event(new Set()) },
    });
    return {
        update: (tabId: number, change: { title?: string; status?: string }) =>
            tabListeners.forEach((listener) => listener(tabId, change)),
        listeners: () => tabListeners.size,
    };
}

/** Waits for the status reports queued by the backend. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('extension backend label', () => {
    it("follows the tab's title when the tab moves on to another page", async () => {
        const tab = fakeChrome('First video');
        const backend = await createBackend();
        expect((await backend.status()).label).toBe('First video');
        const reports: BackendStatus[] = [];
        const stop = backend.watchStatus((status) => reports.push(status));
        tab.update(7, { title: 'Second video' });
        await settle();
        expect(reports).toEqual([{ active: true, label: 'Second video', error: undefined }]);
        expect((await backend.status()).label).toBe('Second video');
        stop();
        expect(tab.listeners()).toBe(0);
    });

    it('ignores other tabs and updates without a title', async () => {
        const tab = fakeChrome('First video');
        const backend = await createBackend();
        const reports: BackendStatus[] = [];
        backend.watchStatus((status) => reports.push(status));
        tab.update(8, { title: 'Another tab' });
        tab.update(7, { status: 'loading' });
        await settle();
        expect(reports).toEqual([]);
        expect((await backend.status()).label).toBe('First video');
    });
});
