import { RackGraph } from '../engine/graph';
import {
    TELEMETRY_PORT_PREFIX,
    isRuntimeMessage,
    type BackgroundMessage,
    type OffscreenMessage,
} from '../shared/messages';
import { normalizeRack } from '../shared/normalize';
import type { RackScope } from '../shared/storage';
import { RackRouting } from './routing';

interface Session {
    stream: MediaStream;
    context: AudioContext;
    graph: RackGraph;
}

const sessions = new Map<number, Session>();
const pending = new Map<number, ((graph: RackGraph) => void)[]>();
const routing = new RackRouting();

function notifyEnded(tabId: number) {
    const message: BackgroundMessage = { target: 'background', type: 'session-ended', tabId };
    void chrome.runtime.sendMessage(message).catch(() => undefined);
}

function assignRack(tabId: number, raw: unknown, scope: RackScope) {
    routing
        .assign(tabId, normalizeRack(raw), scope, sessions.keys())
        .forEach((tab) => sessions.get(tab)?.graph.setRack(routing.rackFor(tab)));
}

async function start(tabId: number, streamId: string, rack: unknown, scope: RackScope) {
    if (sessions.has(tabId)) {
        return;
    }
    assignRack(tabId, rack, scope);
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
            mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId },
        },
        video: false,
    } as MediaStreamConstraints);
    const context = new AudioContext({ latencyHint: 'interactive' });
    const source = context.createMediaStreamSource(stream);
    const graph = await RackGraph.create(context, source, routing.rackFor(tabId));
    await context.resume();
    sessions.set(tabId, { stream, context, graph });
    stream.getAudioTracks().forEach((track) =>
        track.addEventListener('ended', () => {
            stop(tabId);
            notifyEnded(tabId);
        }),
    );
    pending.get(tabId)?.forEach((resolve) => resolve(graph));
    pending.delete(tabId);
}

function stop(tabId: number) {
    routing.forget(tabId);
    const session = sessions.get(tabId);
    if (!session) {
        return;
    }
    sessions.delete(tabId);
    session.graph.dispose();
    session.stream.getTracks().forEach((track) => track.stop());
    void session.context.close();
}

function handle(message: OffscreenMessage): Promise<unknown> | unknown {
    switch (message.type) {
        case 'start':
            return start(message.tabId, message.streamId, message.rack, message.scope);
        case 'stop':
            stop(message.tabId);
            return undefined;
        case 'rack':
            // A tab's own rack is sent again with `start`; only the shared one matters early.
            if (sessions.has(message.tabId) || message.scope === 'shared') {
                assignRack(message.tabId, message.rack, message.scope);
            }
            return undefined;
        case 'list':
            return [...sessions.keys()];
    }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isRuntimeMessage(message) || message.target !== 'offscreen') {
        return false;
    }
    Promise.resolve(handle(message)).then(
        (result) => sendResponse({ ok: true, result }),
        (error: unknown) =>
            sendResponse({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            }),
    );
    return true;
});

function graphFor(tabId: number): Promise<RackGraph> {
    const session = sessions.get(tabId);
    if (session) {
        return Promise.resolve(session.graph);
    }
    return new Promise((resolve) => pending.set(tabId, [...(pending.get(tabId) ?? []), resolve]));
}

chrome.runtime.onConnect.addListener((port) => {
    if (!port.name.startsWith(TELEMETRY_PORT_PREFIX)) {
        return;
    }
    const tabId = Number(port.name.slice(TELEMETRY_PORT_PREFIX.length));
    let unsubscribe: (() => void) | undefined;
    let disconnected = false;
    port.onDisconnect.addListener(() => {
        disconnected = true;
        unsubscribe?.();
    });
    void graphFor(tabId).then((graph) => {
        if (!disconnected) {
            unsubscribe = graph.subscribe((telemetry) => port.postMessage(telemetry));
        }
    });
});
