import { createContext, useContext, useEffect, useRef } from 'react';
import type { Telemetry } from '../shared/messages';

type Listener = (telemetry: Telemetry) => void;

/**
 * Holds the latest engine readings outside React state, so 30 fps updates redraw only
 * the canvases that subscribe to them.
 */
export class TelemetryStore {
    latest: Telemetry | undefined;
    private listeners = new Set<Listener>();

    publish(telemetry: Telemetry) {
        this.latest = telemetry;
        this.listeners.forEach((listener) => listener(telemetry));
    }

    clear() {
        this.latest = undefined;
    }

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    get sampleRate() {
        return this.latest?.sampleRate ?? 48000;
    }
}

export const TelemetryContext = createContext(new TelemetryStore());

export function useTelemetryStore() {
    return useContext(TelemetryContext);
}

/** Calls `listener` for each telemetry frame while mounted, always using the latest closure. */
export function useTelemetry(listener: Listener) {
    const store = useTelemetryStore();
    const ref = useRef(listener);
    ref.current = listener;
    useEffect(() => store.subscribe((telemetry) => ref.current(telemetry)), [store]);
}
