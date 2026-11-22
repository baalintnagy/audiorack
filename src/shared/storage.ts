import { defaultRack, type RackState } from './effects';
import { normalizeRack } from './normalize';
import { MAX_PRESET_NAME } from './presets';

export const RACK_KEY = 'rack';
export const TAB_RACK_PREFIX = 'tabRack:';
export const TAB_SCOPE_PREFIX = 'tabScope:';
export const PRESETS_KEY = 'userPresets';
/** The tabs being processed, kept in `chrome.storage.session` by the background worker. */
export const SESSIONS_KEY = 'sessions';

/**
 * Which rack a tab follows: a rack of its own that lives until the tab is closed (the default,
 * started from a copy of the shared rack), or the shared rack used by every tab that opts in.
 */
export type RackScope = 'shared' | 'tab';

export interface UserPreset {
    name: string;
    rack: RackState;
}

/** `local` persists across browser restarts; `session` is cleared when the browser closes. */
type AreaName = 'local' | 'session';

function extensionArea(area: AreaName): chrome.storage.StorageArea | undefined {
    return typeof chrome === 'undefined' ? undefined : chrome.storage?.[area];
}

function webStorage(area: AreaName): Storage {
    return area === 'local' ? localStorage : sessionStorage;
}

async function read(area: AreaName, key: string): Promise<unknown> {
    const storage = extensionArea(area);
    if (storage) {
        const result = await storage.get(key);
        return result[key];
    }
    try {
        const value = webStorage(area).getItem(`audiorack:${key}`);
        return value === null ? undefined : JSON.parse(value);
    } catch {
        return undefined;
    }
}

async function write(area: AreaName, key: string, value: unknown): Promise<void> {
    const storage = extensionArea(area);
    if (storage) {
        await storage.set({ [key]: value });
        return;
    }
    try {
        webStorage(area).setItem(`audiorack:${key}`, JSON.stringify(value));
    } catch {
        /* Storage is optional outside the extension. */
    }
}

async function remove(area: AreaName, key: string): Promise<void> {
    const storage = extensionArea(area);
    if (storage) {
        await storage.remove(key);
        return;
    }
    try {
        webStorage(area).removeItem(`audiorack:${key}`);
    } catch {
        /* Storage is optional outside the extension. */
    }
}

/** Persists one rack and reports changes made by other extension pages. */
export class RackStore {
    constructor(
        private readonly area: AreaName,
        private readonly key: string,
    ) {}

    async load(): Promise<RackState | undefined> {
        const raw = await read(this.area, this.key);
        return raw === undefined ? undefined : normalizeRack(raw);
    }

    save(rack: RackState): Promise<void> {
        return write(this.area, this.key, rack);
    }

    clear(): Promise<void> {
        return remove(this.area, this.key);
    }

    /** `listener` receives `undefined` when the rack is removed. */
    subscribe(listener: (rack: RackState | undefined) => void): () => void {
        if (!extensionArea(this.area)) {
            return () => {};
        }
        const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
            const change = changes[this.key];
            if (area === this.area && change) {
                listener(
                    change.newValue === undefined ? undefined : normalizeRack(change.newValue),
                );
            }
        };
        chrome.storage.onChanged.addListener(handler);
        return () => chrome.storage.onChanged.removeListener(handler);
    }
}

export const sharedRackStore = new RackStore('local', RACK_KEY);

export function tabRackStore(tabId: number): RackStore {
    return new RackStore('session', `${TAB_RACK_PREFIX}${tabId}`);
}

export async function loadSharedRack(): Promise<RackState> {
    return (await sharedRackStore.load()) ?? defaultRack();
}

function tabScopeKey(tabId: number): string {
    return `${TAB_SCOPE_PREFIX}${tabId}`;
}

/**
 * The rack a tab plays through. Tabs get their own rack by default: the first time a tab is
 * resolved, it receives a copy of the shared rack, unless it was switched to the shared rack.
 */
export async function resolveTabRack(
    tabId: number,
): Promise<{ rack: RackState; scope: RackScope }> {
    const store = tabRackStore(tabId);
    const own = await store.load();
    if (own) {
        return { rack: own, scope: 'tab' };
    }
    const shared = await loadSharedRack();
    if ((await read('session', tabScopeKey(tabId))) === 'shared') {
        return { rack: shared, scope: 'shared' };
    }
    await store.save(shared);
    return { rack: shared, scope: 'tab' };
}

/** Records the tab's scope; `rack` becomes the tab's own rack when switching to `tab`. */
export async function setTabScope(tabId: number, scope: RackScope, rack: RackState) {
    if (scope === 'tab') {
        await tabRackStore(tabId).save(rack);
        await remove('session', tabScopeKey(tabId));
        return;
    }
    await write('session', tabScopeKey(tabId), 'shared');
    await tabRackStore(tabId).clear();
}

/** Drops everything stored for a closed tab. */
export async function forgetTab(tabId: number) {
    await tabRackStore(tabId).clear();
    await remove('session', tabScopeKey(tabId));
}

export async function loadUserPresets(): Promise<UserPreset[]> {
    const raw = await read('local', PRESETS_KEY);
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw
        .filter(
            (item): item is { name: string; rack: unknown } =>
                typeof item === 'object' &&
                item !== null &&
                typeof (item as { name?: unknown }).name === 'string',
        )
        .map((item) => ({
            name: item.name.slice(0, MAX_PRESET_NAME),
            rack: normalizeRack(item.rack),
        }));
}

export function saveUserPresets(presets: UserPreset[]): Promise<void> {
    return write('local', PRESETS_KEY, presets);
}
