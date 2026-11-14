import { RackGraph } from '../engine/graph';
import type { RackState } from '../shared/effects';
import {
    TELEMETRY_PORT_PREFIX,
    isRuntimeMessage,
    type BackgroundMessage,
    type OffscreenMessage,
} from '../shared/messages';
import { normalizeRack } from '../shared/normalize';

interface Session {
    stream: MediaStream;
    context: AudioContext;
    graph: RackGraph;
}

const sessions = new Map<number, Session>();
const pending = new Map<number, ((graph: RackGraph) => void)[]>();
let rack: RackState | undefined;

function notifyEnded(tabId: number) {
    const message: BackgroundMessage = { target: 'background', type: 'session-ended', tabId };
    void chrome.runtime.sendMessage(message).catch(() => undefined);
}

async function start(tabId: number, streamId: string, initial: RackState) {
    if (sessions.has(tabId)) {
        return;
    }
    rack ??= normalizeRack(initial);
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
            mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId },
        },
        video: false,
    } as MediaStreamConstraints);
    const context = new AudioContext({ latencyHint: 'interactive' });
    const source = context.createMediaStreamSource(stream);
    const graph = await RackGraph.create(context, source, rack);
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
            return start(message.tabId, message.streamId, message.rack);
        case 'stop':
            stop(message.tabId);
            return undefined;
        case 'rack':
            rack = normalizeRack(message.rack);
            sessions.forEach((session) => session.graph.setRack(rack!));
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
