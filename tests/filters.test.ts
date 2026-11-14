import { describe, expect, it } from 'vitest';
import {
    Biquad,
    biquadCoefficients,
    biquadMagnitude,
    butterworthQs,
    cascadeMagnitude,
    cutFilterCoefficients,
} from '../src/dsp/biquad';
import { MultibandSplitter } from '../src/dsp/crossover';
import { eqResponseDb } from '../src/dsp/eq';
import { defaultEqBand } from '../src/shared/effects';
import { SAMPLE_RATE, db, rms, sine } from './helpers';

describe('biquad sections', () => {
    it('matches the cookbook responses at the corner and center frequencies', () => {
        const lowpass = biquadCoefficients('lowpass', 1000, Math.SQRT1_2, 0, SAMPLE_RATE);
        expect(db(biquadMagnitude(lowpass, 1000, SAMPLE_RATE))).toBeCloseTo(-3.01, 1);
        expect(db(biquadMagnitude(lowpass, 20, SAMPLE_RATE))).toBeCloseTo(0, 2);
        const bell = biquadCoefficients('peaking', 2000, 1, 6, SAMPLE_RATE);
        expect(db(biquadMagnitude(bell, 2000, SAMPLE_RATE))).toBeCloseTo(6, 3);
        const shelf = biquadCoefficients('lowshelf', 200, Math.SQRT1_2, -9, SAMPLE_RATE);
        expect(db(biquadMagnitude(shelf, 20, SAMPLE_RATE))).toBeCloseTo(-9, 0);
        expect(db(biquadMagnitude(shelf, 10000, SAMPLE_RATE))).toBeCloseTo(0, 1);
    });

    it('produces Butterworth section Qs', () => {
        expect(butterworthQs(2)[0]).toBeCloseTo(Math.SQRT1_2, 5);
        const [first, second] = butterworthQs(4);
        expect(first).toBeCloseTo(0.541, 3);
        expect(second).toBeCloseTo(1.307, 3);
    });

    it('keeps steep cut filters at -3 dB at the corner frequency', () => {
        SLOPES_TO_TEST.forEach((slope) => {
            const sections = cutFilterCoefficients('highpass', 500, slope, 1, SAMPLE_RATE);
            expect(sections).toHaveLength(slope / 12);
            expect(db(cascadeMagnitude(sections, 500, SAMPLE_RATE))).toBeCloseTo(-3.01, 1);
            const octaveBelow = db(cascadeMagnitude(sections, 250, SAMPLE_RATE));
            expect(octaveBelow).toBeLessThan(-slope + 4);
        });
    });

    it('filters a signal in the time domain like its magnitude response predicts', () => {
        const filter = new Biquad();
        filter.setCoefficients(biquadCoefficients('lowpass', 1000, Math.SQRT1_2, 0, SAMPLE_RATE));
        const signal = sine(4000, 0.5);
        filter.process(signal, signal.length, 0);
        const expected = biquadMagnitude(filter.coefficients, 4000, SAMPLE_RATE) * 0.5;
        expect(rms(signal, 4800) * Math.SQRT2).toBeCloseTo(expected, 2);
    });

    it('combines EQ band responses', () => {
        const bands = [
            defaultEqBand({ frequency: 100, gainDb: 6 }),
            defaultEqBand({ frequency: 100, gainDb: 3 }),
        ];
        const [response] = eqResponseDb(bands, [100], SAMPLE_RATE);
        expect(response).toBeCloseTo(9, 2);
        const disabled = eqResponseDb([{ ...bands[0], enabled: false }], [100], SAMPLE_RATE);
        expect(disabled[0]).toBeCloseTo(0, 5);
    });
});

const SLOPES_TO_TEST = [12, 24, 36, 48];

describe('Linkwitz-Riley band splitting', () => {
    it('recombines four bands with a flat magnitude', () => {
        [60, 150, 700, 1500, 4000, 6000, 12000].forEach((frequency) => {
            const splitter = new MultibandSplitter();
            splitter.setCrossovers([150, 1500, 6000], SAMPLE_RATE);
            const input = sine(frequency, 0.4);
            const bands = Array.from({ length: 4 }, () => new Float32Array(128));
            const output = new Float32Array(input.length);
            for (let start = 0; start < input.length; start += 128) {
                bands[0].set(input.subarray(start, start + 128));
                splitter.split(bands, 128, 0);
                for (let i = 0; i < 128; i++) {
                    output[start + i] = bands.reduce((sum, band) => sum + band[i], 0);
                }
            }
            expect(db(rms(output, 9600) / rms(input, 9600))).toBeCloseTo(0, 1);
        });
    });
});
