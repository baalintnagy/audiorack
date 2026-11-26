import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { Levels, SignalReading, Telemetry } from '../shared/messages';

type Listener = (telemetry: Telemetry) => void;

/**
 * Holds the latest engine readings outside React state, so 30 fps updates redraw only
 * the canvases that subscribe to them.
 */
export class TelemetryStore {
    protected frame: Telemetry | undefined;
    private listeners = new Set<Listener>();

    get latest(): Telemetry | undefined {
        return this.frame;
    }

    publish(telemetry: Telemetry) {
        this.frame = telemetry;
        this.listeners.forEach((listener) => listener(telemetry));
    }

    clear() {
        this.frame = undefined;
    }

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    get sampleRate() {
        return this.latest?.sampleRate ?? 48000;
    }
}

/**
 * Passes on the frames of another store, except while held: then its subscribers get none and
 * `latest` stays at the frame it was held on, so whatever draws from it holds still.
 */
export class HoldableTelemetry extends TelemetryStore {
    private held = false;

    constructor(private readonly source: TelemetryStore) {
        super();
    }

    override get latest(): Telemetry | undefined {
        return this.held ? this.frame : this.source.latest;
    }

    /** Starts passing frames on; returns the function that stops it. */
    follow(): () => void {
        return this.source.subscribe((telemetry) => {
            if (!this.held) {
                this.publish(telemetry);
            }
        });
    }

    hold(held: boolean) {
        if (held && !this.held) {
            this.frame = this.source.latest;
        }
        this.held = held;
    }
}

export const TelemetryContext = createContext(new TelemetryStore());

/**
 * What an effect measured on its own signal in a frame of telemetry, which its displays show
 * rather than the rack's input and output; nothing while the effect is bypassed.
 */
export function signalOf(
    telemetry: Telemetry | undefined,
    effectId: string,
): SignalReading | undefined {
    return telemetry?.meters.signals[effectId];
}

/** Levels of silence, for an effect without a reading. */
export const SILENT_LEVELS: Levels = { peak: [0, 0], rms: [0, 0] };

/** An effect's own output peak, linear, of the louder channel; zero without a reading. */
export function outputPeak(telemetry: Telemetry, effectId: string): number {
    return Math.max(...(signalOf(telemetry, effectId)?.output.peak ?? SILENT_LEVELS.peak));
}

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

/**
 * A telemetry store for a part of the page that can be frozen, such as an analyzer: provide it
 * to that part, and while `frozen` everything there holds still on the last readings it had,
 * while the engine itself carries on.
 */
export function useFreezableTelemetry(frozen: boolean): TelemetryStore {
    const source = useTelemetryStore();
    const store = useMemo(() => new HoldableTelemetry(source), [source]);
    useLayoutEffect(() => store.hold(frozen), [store, frozen]);
    useEffect(() => store.follow(), [store]);
    return store;
}
