import { describe, expect, it } from 'vitest';
import { FFT } from '../src/dsp/fft';
import {
    SPECTROGRAM_BINS,
    STEREO_BANDS,
    STEREO_BAND_FIELDS,
    STEREO_FIELDS,
    SpectrogramKernel,
    SpectrumKernel,
    StereoKernel,
} from '../src/dsp/kernels/analyzers';
import { defaultParams } from '../src/shared/effects';
import { SPECTRUM_BINS, SPECTRUM_FREQUENCIES } from '../src/shared/spectrum';
import { SAMPLE_RATE, noise, processStereo, sine } from './helpers';

describe('FFT', () => {
    it('finds the bin of a complex exponential', () => {
        const fft = new FFT(64);
        const re = Float64Array.from({ length: 64 }, (_, i) =>
            Math.cos((2 * Math.PI * 5 * i) / 64),
        );
        const im = Float64Array.from({ length: 64 }, (_, i) =>
            Math.sin((2 * Math.PI * 5 * i) / 64),
        );
        fft.forward(re, im);
        const magnitudes = Array.from(re, (value, i) => Math.hypot(value, im[i]));
        expect(magnitudes[5]).toBeCloseTo(64, 6);
        expect(magnitudes.filter((_, i) => i !== 5).every((value) => value < 1e-9)).toBe(true);
    });

    it('rejects sizes that are not powers of two', () => {
        expect(() => new FFT(1000)).toThrow();
    });
});

describe('spectrum analyzer', () => {
    it('reads a full-scale sine near 0 dBFS at its frequency', () => {
        const kernel = new SpectrumKernel(SAMPLE_RATE);
        kernel.setParams(defaultParams('spectrum'));
        const signal = sine(1000, 0.2, 1);
        const [left] = processStereo(signal, signal, (l, r, frames) =>
            kernel.process(l, r, frames),
        );
        expect(left).toEqual(signal);
        const spectrum = kernel.takeMeters();
        expect(spectrum).toHaveLength(SPECTRUM_BINS);
        const loudest = spectrum.indexOf(Math.max(...spectrum));
        expect(SPECTRUM_FREQUENCIES[loudest]).toBeGreaterThan(900);
        expect(SPECTRUM_FREQUENCIES[loudest]).toBeLessThan(1100);
        expect(spectrum[loudest]).toBeGreaterThan(-2);
        expect(spectrum[loudest]).toBeLessThan(0.5);
    });

    it('analyzes the selected channel', () => {
        const kernel = new SpectrumKernel(SAMPLE_RATE);
        kernel.setParams({ ...defaultParams('spectrum'), channel: 'side' });
        const signal = sine(1000, 0.2, 0.5);
        processStereo(signal, signal, (l, r, frames) => kernel.process(l, r, frames));
        expect(Math.max(...kernel.takeMeters())).toBeLessThan(-100);
    });

    it('uses the higher spectrogram resolution', () => {
        const kernel = new SpectrogramKernel(SAMPLE_RATE);
        kernel.setParams({ ...defaultParams('spectrogram'), fftSize: 8192 });
        const signal = noise(0.2, 0.5);
        processStereo(signal, signal, (l, r, frames) => kernel.process(l, r, frames));
        const columns = kernel.takeMeters();
        expect(columns).toHaveLength(SPECTROGRAM_BINS);
        expect(columns.every(Number.isFinite)).toBe(true);
    });
});

describe('stereo analyzer', () => {
    function analyze(left: Float32Array, right: Float32Array) {
        const kernel = new StereoKernel(SAMPLE_RATE);
        processStereo(left, right, (l, r, frames) => kernel.process(l, r, frames));
        return kernel.takeMeters();
    }

    it('reports a mono signal as fully correlated with no width', () => {
        const signal = sine(440, 0.1, 0.5);
        const readings = analyze(signal, signal);
        expect(readings[STEREO_FIELDS.correlation]).toBeCloseTo(1, 3);
        expect(readings[STEREO_FIELDS.width]).toBeCloseTo(0, 3);
        expect(readings[STEREO_FIELDS.balance]).toBeCloseTo(0, 3);
        expect(readings[STEREO_FIELDS.peak]).toBeCloseTo(0.5, 2);
        expect(readings).toHaveLength(STEREO_FIELDS.bands + STEREO_BANDS * STEREO_BAND_FIELDS.size);
    });

    it('detects polarity problems and imbalance', () => {
        const signal = sine(440, 0.1, 0.5);
        const inverted = signal.map((value) => -value);
        expect(analyze(signal, inverted)[STEREO_FIELDS.correlation]).toBeCloseTo(-1, 3);
        const quieter = signal.map((value) => value * 0.5);
        expect(analyze(signal, quieter)[STEREO_FIELDS.balance]).toBeCloseTo(6.02, 1);
    });

    it('stays finite on silence', () => {
        const silence = new Float32Array(4800);
        expect(analyze(silence, silence).every(Number.isFinite)).toBe(true);
    });

    /** Per-band readings after playing `left`/`right` with meters taken as the worklet does. */
    function bandReadings(left: Float32Array, right: Float32Array) {
        const kernel = new StereoKernel(SAMPLE_RATE);
        let readings: number[] = [];
        for (let start = 0; start < left.length; start += 1024) {
            const end = Math.min(left.length, start + 1024);
            kernel.process(left.slice(start, end), right.slice(start, end), end - start);
            readings = kernel.takeMeters();
        }
        return Array.from({ length: STEREO_BANDS }, (_, band) => {
            const start = STEREO_FIELDS.bands + band * STEREO_BAND_FIELDS.size;
            return {
                position: readings[start + STEREO_BAND_FIELDS.position],
                width: readings[start + STEREO_BAND_FIELDS.width],
                correlation: readings[start + STEREO_BAND_FIELDS.correlation],
            };
        });
    }

    it('images mono and anti-phase content correctly in every band', () => {
        const signal = noise(1, 0.3);
        bandReadings(signal, signal).forEach((band) => {
            expect(band.correlation).toBeCloseTo(1, 3);
            expect(band.width).toBeCloseTo(0, 2);
            expect(band.position).toBeCloseTo(0, 3);
        });
        const inverted = signal.map((value) => -value);
        bandReadings(signal, inverted).forEach((band) => {
            expect(band.correlation).toBeCloseTo(-1, 3);
            expect(band.width).toBe(10);
        });
    });

    it('averages the low bands instead of reading noise from a single frame', () => {
        // Shared noise plus a little independent noise per channel: the same correlation and
        // S/M width in every band, centered.
        const common = noise(2, 0.3, 5);
        const left = noise(2, 0.3, 1).map((value, i) => common[i] + 0.45 * value);
        const right = noise(2, 0.3, 2).map((value, i) => common[i] + 0.45 * value);
        const correlation = 1 / (1 + 0.45 ** 2);
        const width = Math.sqrt((2 * 0.45 ** 2) / (4 + 2 * 0.45 ** 2));
        bandReadings(left, right).forEach((band) => {
            expect(Math.abs(band.correlation - correlation)).toBeLessThan(0.15);
            expect(Math.abs(band.width - width)).toBeLessThan(0.15);
            expect(Math.abs(band.position)).toBeLessThan(0.2);
        });
    });
});
