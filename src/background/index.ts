import {
    isRuntimeMessage,
    type BackgroundMessage,
    type CaptureStatus,
    type OffscreenMessage,
} from '../shared/messages';
import { SESSIONS_KEY, forgetTab, resolveTabRack } from '../shared/storage';

const OFFSCREEN_URL = 'offscreen.html';

let creatingOffscreen: Promise<void> | undefined;

async function hasOffscreenDocument(): Promise<boolean> {
    const contexts = await chrome.runtime.getContexts({
        contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
        documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
    });
    return contexts.length > 0;
}

async function ensureOffscreenDocument() {
    if (await hasOffscreenDocument()) {
        return;
    }
    creatingOffscreen ??= chrome.offscreen
        .createDocument({
            url: OFFSCREEN_URL,
            reasons: [chrome.offscreen.Reason.USER_MEDIA],
            justification: 'Processes captured tab audio through the effect rack.',
        })
        .finally(() => {
            creatingOffscreen = undefined;
        });
    await creatingOffscreen;
}

async function getSessions(): Promise<number[]> {
    if (!(await hasOffscreenDocument())) {
        return [];
    }
    const result = await chrome.storage.session.get(SESSIONS_KEY);
    const sessions: unknown = result[SESSIONS_KEY];
    return Array.isArray(sessions) ? sessions.filter((id) => typeof id === 'number') : [];
}

async function setSessions(sessions: number[]) {
    await chrome.storage.session.set({ [SESSIONS_KEY]: sessions });
}

async function sendToOffscreen(message: OffscreenMessage): Promise<unknown> {
    const response = (await chrome.runtime.sendMessage(message)) as
        { ok: true; result: unknown } | { ok: false; error: string } | undefined;
    if (!response?.ok) {
        throw new Error(response?.error ?? 'The audio engine did not respond.');
    }
    return response.result;
}

async function updateBadge(tabId: number, active: boolean) {
    try {
        await chrome.action.setBadgeText({ tabId, text: active ? 'ON' : '' });
        await chrome.action.setBadgeBackgroundColor({ tabId, color: '#ff8a3d' });
    } catch {
        /* The tab may already be closed. */
    }
}

async function status(): Promise<CaptureStatus> {
    const sessions = await getSessions();
    return { capturing: sessions.length > 0, sessions };
}

async function startCapture(tabId: number): Promise<CaptureStatus> {
    const sessions = await getSessions();
    if (sessions.includes(tabId)) {
        return status();
    }
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    await ensureOffscreenDocument();
    const { rack, scope } = await resolveTabRack(tabId);
    try {
        await sendToOffscreen({ target: 'offscreen', type: 'start', tabId, streamId, rack, scope });
    } catch (error) {
        if (sessions.length === 0) {
            await chrome.offscreen.closeDocument().catch(() => undefined);
        }
        throw error;
    }
    await setSessions([...sessions, tabId]);
    await updateBadge(tabId, true);
    return status();
}

async function removeSession(tabId: number) {
    const remaining = (await getSessions()).filter((id) => id !== tabId);
    await setSessions(remaining);
    await updateBadge(tabId, false);
    if (remaining.length === 0 && (await hasOffscreenDocument())) {
        await chrome.offscreen.closeDocument();
    }
}

async function stopCapture(tabId: number): Promise<CaptureStatus> {
    if (await hasOffscreenDocument()) {
        await sendToOffscreen({ target: 'offscreen', type: 'stop', tabId }).catch(() => undefined);
    }
    await removeSession(tabId);
    return status();
}

async function handle(message: BackgroundMessage): Promise<CaptureStatus> {
    switch (message.type) {
        case 'start-capture':
            return startCapture(message.tabId);
        case 'stop-capture':
            return stopCapture(message.tabId);
        case 'get-status':
            return status();
        case 'session-ended':
            await removeSession(message.tabId);
            return status();
    }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isRuntimeMessage(message) || message.target !== 'background') {
        return false;
    }
    handle(message).then(sendResponse, (error: unknown) =>
        sendResponse({
            capturing: false,
            sessions: [],
            error: error instanceof Error ? error.message : String(error),
        } satisfies CaptureStatus),
    );
    return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
    void forgetTab(tabId);
    void getSessions().then((sessions) =>
        sessions.includes(tabId) ? stopCapture(tabId) : undefined,
    );
});
