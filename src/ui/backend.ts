import { RackGraph } from '../engine/graph';
import type { RackState } from '../shared/effects';
import {
    TELEMETRY_PORT_PREFIX,
    type BackgroundMessage,
    type CaptureStatus,
    type OffscreenMessage,
} from '../shared/messages';
import { SESSIONS_KEY, type RackScope } from '../shared/storage';
import { DEMO_TRACK_LABEL, demoTrack } from './demo-signal';
import { pagePath, pageParams } from './page';
import type { TelemetryStore } from './telemetry';

export interface BackendStatus {
    active: boolean;
    label: string;
    error?: string;
}

export interface Backend {
    readonly kind: 'extension' | 'local';
    /** The browser tab being processed; racks can only be scoped to a tab when it is known. */
    readonly tabId?: number;
    status(): Promise<BackendStatus>;
    start(): Promise<BackendStatus>;
    stop(): Promise<BackendStatus>;
    /** Reports status changes made elsewhere, such as processing started in another window. */
    watchStatus(listener: (status: BackendStatus) => void): () => void;
    pushRack(rack: RackState, scope: RackScope): void;
    /** Streams telemetry into the store while the engine runs. */
    connect(store: TelemetryStore): () => void;
    /** Moves the whole rack into a larger window. */
    popOut?(): void;
    /** Opens one effect or parallel group in a window of its own, or focuses the open one. */
    popOutItem?(itemId: string): Promise<void>;
    loadFile?(file: File): Promise<BackendStatus>;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

class ExtensionBackend implements Backend {
    readonly kind = 'extension';

    private constructor(
        readonly tabId: number,
        private readonly tabTitle: string,
    ) {}

    static async create(): Promise<ExtensionBackend> {
        const { tabId } = pageParams();
        if (tabId !== undefined) {
            const tab = await chrome.tabs.get(tabId).catch(() => undefined);
            return new ExtensionBackend(tabId, tab?.title ?? `Tab ${tabId}`);
        }
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return new ExtensionBackend(tab?.id ?? -1, tab?.title ?? 'Current tab');
    }

    private async send(type: BackgroundMessage['type']): Promise<BackendStatus> {
        const message = { target: 'background', type, tabId: this.tabId } as BackgroundMessage;
        try {
            const result = (await chrome.runtime.sendMessage(message)) as CaptureStatus;
            return {
                active: result.sessions.includes(this.tabId),
                label: this.tabTitle,
                error: result.error,
            };
        } catch (error) {
            return { active: false, label: this.tabTitle, error: errorMessage(error) };
        }
    }

    status() {
        return this.send('get-status');
    }

    start() {
        return this.send('start-capture');
    }

    stop() {
        return this.send('stop-capture');
    }

    watchStatus(listener: (status: BackendStatus) => void) {
        const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
            if (area === 'session' && SESSIONS_KEY in changes) {
                void this.status().then(listener);
            }
        };
        chrome.storage.onChanged.addListener(handler);
        return () => chrome.storage.onChanged.removeListener(handler);
    }

    pushRack(rack: RackState, scope: RackScope) {
        const message: OffscreenMessage = {
            target: 'offscreen',
            type: 'rack',
            tabId: this.tabId,
            rack,
            scope,
        };
        // The offscreen document only exists while a tab is being processed.
        chrome.runtime.sendMessage(message).catch(() => undefined);
    }

    connect(store: TelemetryStore) {
        const port = chrome.runtime.connect({ name: `${TELEMETRY_PORT_PREFIX}${this.tabId}` });
        port.onMessage.addListener((message) => store.publish(message));
        return () => {
            port.disconnect();
            store.clear();
        };
    }

    popOut() {
        void chrome.windows.create({
            url: chrome.runtime.getURL(pagePath({ tabId: this.tabId })),
            type: 'popup',
            width: 1180,
            height: 760,
        });
        window.close();
    }

    async popOutItem(itemId: string) {
        const url = chrome.runtime.getURL(pagePath({ tabId: this.tabId, itemId }));
        const [open] = await chrome.runtime.getContexts({
            contextTypes: [chrome.runtime.ContextType.TAB],
            documentUrls: [url],
        });
        if (open) {
            await chrome.windows.update(open.windowId, { focused: true });
            return;
        }
        await chrome.windows.create({ url, type: 'popup', width: 760, height: 520 });
    }
}

/** Runs the rack in the page itself, for development and trying effects on local files. */
class LocalBackend implements Backend {
    readonly kind = 'local';

    constructor() {
        // Render the demo track in the background so Play starts immediately.
        void demoTrack().catch(() => undefined);
    }
    private context?: AudioContext;
    private graph?: RackGraph;
    private source?: AudioNode & { stop?: () => void };
    private media?: HTMLAudioElement;
    private rack?: RackState;
    private label = DEMO_TRACK_LABEL;
    private file?: File;
    private listeners = new Set<() => void>();

    async status(): Promise<BackendStatus> {
        return { active: this.graph !== undefined, label: this.label };
    }

    private async createSource(context: AudioContext): Promise<AudioNode> {
        if (this.file) {
            const media = new Audio(URL.createObjectURL(this.file));
            media.loop = true;
            this.media = media;
            await media.play();
            return context.createMediaElementSource(media);
        }
        const source = context.createBufferSource();
        source.buffer = await demoTrack();
        source.loop = true;
        source.start();
        return source;
    }

    async start(): Promise<BackendStatus> {
        if (this.graph || !this.rack) {
            return this.status();
        }
        try {
            this.context ??= new AudioContext({ latencyHint: 'interactive' });
            await this.context.resume();
            const source = await this.createSource(this.context);
            this.source = source;
            this.graph = await RackGraph.create(this.context, source, this.rack);
            this.listeners.forEach((attach) => attach());
            return this.status();
        } catch (error) {
            return { active: false, label: this.label, error: errorMessage(error) };
        }
    }

    async stop(): Promise<BackendStatus> {
        this.graph?.dispose();
        this.graph = undefined;
        this.source?.stop?.();
        this.source = undefined;
        if (this.media) {
            this.media.pause();
            URL.revokeObjectURL(this.media.src);
            this.media = undefined;
        }
        return this.status();
    }

    async loadFile(file: File): Promise<BackendStatus> {
        const running = this.graph !== undefined;
        await this.stop();
        this.file = file;
        this.label = file.name;
        return running ? this.start() : this.status();
    }

    watchStatus() {
        // Only this page starts and stops the in-page engine.
        return () => {};
    }

    pushRack(rack: RackState) {
        this.rack = rack;
        this.graph?.setRack(rack);
    }

    connect(store: TelemetryStore) {
        let unsubscribe: (() => void) | undefined;
        const attach = () => {
            unsubscribe?.();
            unsubscribe = this.graph?.subscribe((telemetry) => store.publish(telemetry));
        };
        attach();
        this.listeners.add(attach);
        return () => {
            this.listeners.delete(attach);
            unsubscribe?.();
            store.clear();
        };
    }
}

export function isExtensionPage(): boolean {
    return typeof chrome !== 'undefined' && chrome.runtime?.id !== undefined && !!chrome.tabs;
}

export async function createBackend(): Promise<Backend> {
    return isExtensionPage() ? ExtensionBackend.create() : new LocalBackend();
}
