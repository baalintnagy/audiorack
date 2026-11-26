import { describe, expect, it } from 'vitest';
import { RackProcessor } from '../src/dsp/rack';
import { createEffect, defaultRack, type Effect, type EffectType } from '../src/shared/effects';
import { SAMPLE_RATE, processStereo, sine } from './helpers';

/** Frames per second the engine sends meters at. */
const FRAME_RATE = 30;

/**
 * Plays a tone through a rack, taking meters at the engine's frame rate as the editors receive
 * them, and returns the last frame.
 */
function play(rack: ReturnType<typeof defaultRack>, seconds = 0.5) {
    const processor = new RackProcessor(SAMPLE_RATE);
    processor.setRack(rack);
    const input = sine(1000, 1 / FRAME_RATE, 0.5);
    const frames = Array.from({ length: Math.round(seconds * FRAME_RATE) }, () => {
        processStereo(input, input, (l, r, length) => processor.process(l, r, length));
        return processor.takeMeters();
    });
    return frames[frames.length - 1];
}

describe("effects' own signals", () => {
    it("measure each effect's own input and output, not the rack's", () => {
        const quieter = createEffect('utility');
        quieter.params.gainDb = -6;
        const louder = createEffect('utility');
        louder.params.gainDb = 6;
        const meters = play({ ...defaultRack(), outputDb: 12, chain: [quieter, louder] });
        const first = meters.signals[quieter.id];
        const second = meters.signals[louder.id];
        expect(first.input.peak[0]).toBeCloseTo(0.5, 2);
        expect(first.output.peak[0]).toBeCloseTo(0.25, 2);
        // The second sees what the first passed on, whatever the rack's output gain.
        expect(second.input.peak[0]).toBeCloseTo(0.25, 2);
        expect(second.output.peak[0]).toBeCloseTo(0.5, 2);
        expect(meters.outputPeak[0]).toBeCloseTo(2, 1);
    });

    it("stay the same when the rack's output gain changes", () => {
        const effect = createEffect('compressor');
        const at = (outputDb: number) =>
            play({ ...defaultRack(), outputDb, chain: [effect] }).signals[effect.id].output.peak[0];
        expect(at(-12)).toBeCloseTo(at(12), 4);
    });

    it('include the spectra that the display of the effect draws', () => {
        const types: EffectType[] = ['eq', 'filter', 'compressor', 'limiter'];
        const effects = types.map((type) => createEffect(type) as Effect);
        const { signals } = play({ ...defaultRack(), chain: effects });
        const spectra = effects.map((effect) => [
            signals[effect.id].pre !== undefined,
            signals[effect.id].post !== undefined,
        ]);
        expect(spectra).toEqual([
            [true, true],
            [false, true],
            [false, false],
            [false, false],
        ]);
        // The tone shows in the equalizer's spectrum at its frequency, near its level.
        const post = signals[effects[0].id].post ?? [];
        expect(Math.max(...post)).toBeGreaterThan(-12);
    });

    it('are left out while an effect is bypassed', () => {
        const effect = { ...createEffect('limiter'), bypass: true };
        const { signals } = play({ ...defaultRack(), chain: [effect] });
        expect(signals).not.toHaveProperty(effect.id);
    });
});
