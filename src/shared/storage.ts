import { defaultRack, type RackState } from './effects';
import { normalizeRack } from './normalize';

export const RACK_KEY = 'rack';
export const PRESETS_KEY = 'userPresets';

export interface UserPreset {
    name: string;
    rack: RackState;
}

function hasExtensionStorage(): boolean {
    return typeof chrome !== 'undefined' && chrome.storage?.local !== undefined;
}

async function read(key: string): Promise<unknown> {
    if (hasExtensionStorage()) {
        const result = await chrome.storage.local.get(key);
        return result[key];
    }
    try {
        const value = localStorage.getItem(`audiorack:${key}`);
        return value === null ? undefined : JSON.parse(value);
    } catch {
        return undefined;
    }
}

async function write(key: string, value: unknown): Promise<void> {
    if (hasExtensionStorage()) {
        await chrome.storage.local.set({ [key]: value });
        return;
    }
    try {
        localStorage.setItem(`audiorack:${key}`, JSON.stringify(value));
    } catch {
        /* Storage is optional outside the extension. */
    }
}

export async function loadRack(): Promise<RackState> {
    const raw = await read(RACK_KEY);
    return raw === undefined ? defaultRack() : normalizeRack(raw);
}

export function saveRack(rack: RackState): Promise<void> {
    return write(RACK_KEY, rack);
}

export async function loadUserPresets(): Promise<UserPreset[]> {
    const raw = await read(PRESETS_KEY);
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
        .map((item) => ({ name: item.name.slice(0, 60), rack: normalizeRack(item.rack) }));
}

export function saveUserPresets(presets: UserPreset[]): Promise<void> {
    return write(PRESETS_KEY, presets);
}

/** Notifies about rack changes made by another extension page. */
export function onRackChanged(listener: (rack: RackState) => void): () => void {
    if (!hasExtensionStorage()) {
        return () => {};
    }
    const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area === 'local' && changes[RACK_KEY]?.newValue !== undefined) {
            listener(normalizeRack(changes[RACK_KEY].newValue));
        }
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
}
