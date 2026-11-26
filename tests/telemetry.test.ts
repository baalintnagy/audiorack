import { describe, expect, it } from 'vitest';
import type { Telemetry } from '../src/shared/messages';
import { HoldableTelemetry, TelemetryStore } from '../src/ui/telemetry';

/** A frame told apart by its sample rate. */
function frame(sampleRate: number): Telemetry {
    return {
        sampleRate,
        meters: {
            inputPeak: [0, 0],
            inputRms: [0, 0],
            outputPeak: [0, 0],
            outputRms: [0, 0],
            effects: {},
            signals: {},
        },
    };
}

describe('freezable telemetry', () => {
    it('passes frames on until held, then keeps the frame it was held on', () => {
        const source = new TelemetryStore();
        const store = new HoldableTelemetry(source);
        const seen: number[] = [];
        store.subscribe((telemetry) => seen.push(telemetry.sampleRate));
        const stop = store.follow();
        source.publish(frame(1));
        store.hold(true);
        source.publish(frame(2));
        source.publish(frame(3));
        expect(seen).toEqual([1]);
        expect(store.latest?.sampleRate).toBe(1);
        // Released, it follows again from the next frame.
        store.hold(false);
        expect(store.latest?.sampleRate).toBe(3);
        source.publish(frame(4));
        expect(seen).toEqual([1, 4]);
        stop();
        source.publish(frame(5));
        expect(seen).toEqual([1, 4]);
    });

    it('follows the source while live, including when it is cleared', () => {
        const source = new TelemetryStore();
        const store = new HoldableTelemetry(source);
        source.publish(frame(1));
        expect(store.latest?.sampleRate).toBe(1);
        source.clear();
        expect(store.latest).toBeUndefined();
    });
});
