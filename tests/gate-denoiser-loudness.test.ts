import { describe, expect, it } from 'vitest';
import { createKernel } from '../src/dsp/kernels';
import { STEREO_BANDS, STEREO_BAND_FIELDS, STEREO_FIELDS } from '../src/dsp/kernels/analyzers';
import { DENOISER_FIELDS } from '../src/dsp/kernels/denoiser';
import { GATE_FIELDS } from '../src/dsp/kernels/gate';
import { LOUDNESS_FIELDS } from '../src/dsp/kernels/loudness';
import { UTILITY_FIELDS } from '../src/dsp/kernels/utility';
import { logFrequencies } from '../src/shared/spectrum';
import {
    NOISE_PROFILE_BANDS,
    defaultParams,
    type EffectParamsMap,
    type EffectType,
} from '../src/shared/effects';
import { SAMPLE_RATE, db, noise, processStereo, rms, sine } from './helpers';

function kernelFor<T extends EffectType>(type: T, params: Partial<EffectParamsMap[T]> = {}) {
    const kernel = createKernel(type, SAMPLE_RATE);
    kernel.setParams({ ...defaultParams(type), ...params });
    return kernel;
}

function concat(...parts: Float32Array[]): Float32Array {
    const result = new Float32Array(parts.reduce((total, part) => total + part.length, 0));
    parts.reduce((offset, part) => {
        result.set(part, offset);
        return offset + part.length;
    }, 0);
    return result;
}

const dbfs = (value: number) => Math.pow(10, value / 20);

describe('loudness analyzer', () => {
    // EBU Tech 3341 test case 1: a stereo 1 kHz sine at -23 dBFS reads -23 LUFS.
    it('reads -23 LUFS for a -23 dBFS stereo 1 kHz sine', () => {
        const kernel = kernelFor('loudness');
        const signal = sine(1000, 5, dbfs(-23));
        processStereo(signal, signal, (l, r, frames) => kernel.process(l, r, frames));
        const readings = kernel.takeMeters?.() ?? [];
        expect(readings[LOUDNESS_FIELDS.momentary]).toBeCloseTo(-23, 1);
        expect(readings[LOUDNESS_FIELDS.shortTerm]).toBeCloseTo(-23, 1);
        expect(readings[LOUDNESS_FIELDS.integrated]).toBeCloseTo(-23, 1);
        expect(readings[LOUDNESS_FIELDS.range]).toBeLessThan(0.2);
        expect(readings[LOUDNESS_FIELDS.seconds]).toBe(5);
    });

    // Like EBU Tech 3341 test case 3: quiet passages fall below the relative gate.
    it('gates quiet passages out of the integrated loudness', () => {
        const kernel = kernelFor('loudness');
        const signal = concat(
            sine(1000, 10, dbfs(-36)),
            sine(1000, 60, dbfs(-23)),
            sine(1000, 10, dbfs(-36)),
        );
        processStereo(signal, signal, (l, r, frames) => kernel.process(l, r, frames));
        const readings = kernel.takeMeters?.() ?? [];
        expect(readings[LOUDNESS_FIELDS.integrated]).toBeCloseTo(-23, 1);
        expect(readings[LOUDNESS_FIELDS.maxMomentary]).toBeCloseTo(-23, 1);
    });

    // Loudness range of EBU Tech 3342 test case 1: 20 s at -20 and 20 s at -30 LUFS give 10 LU.
    it('measures the loudness range', () => {
        const kernel = kernelFor('loudness');
        const signal = concat(sine(1000, 20, dbfs(-20)), sine(1000, 20, dbfs(-30)));
        processStereo(signal, signal, (l, r, frames) => kernel.process(l, r, frames));
        expect(kernel.takeMeters?.()[LOUDNESS_FIELDS.range]).toBeCloseTo(10, 0);
    });

    it('finds peaks between samples', () => {
        const kernel = kernelFor('loudness');
        // A quarter-sample-rate sine sampled at 45°: every sample is at -3 dB of the real peak.
        const signal = Float32Array.from({ length: SAMPLE_RATE }, (_, i) =>
            Math.sin((Math.PI / 2) * i + Math.PI / 4),
        );
        processStereo(signal, signal, (l, r, frames) => kernel.process(l, r, frames));
        expect(kernel.takeMeters?.()[LOUDNESS_FIELDS.maxTruePeak]).toBeGreaterThan(-0.5);
    });

    it('restarts the measurement when reset', () => {
        const kernel = kernelFor('loudness');
        const signal = sine(1000, 2, dbfs(-23));
        processStereo(signal, signal, (l, r, frames) => kernel.process(l, r, frames));
        kernel.setParams({ ...defaultParams('loudness'), resets: 1 });
        const readings = kernel.takeMeters?.() ?? [];
        expect(readings[LOUDNESS_FIELDS.integrated]).toBe(-120);
        expect(readings[LOUDNESS_FIELDS.seconds]).toBe(0);
    });
});

describe('utility loudness meter', () => {
    it('reports the loudness of the output after the gain', () => {
        const kernel = kernelFor('utility', { gainDb: -6 });
        const signal = sine(1000, 4, dbfs(-17));
        processStereo(signal, signal, (l, r, frames) => kernel.process(l, r, frames));
        const readings = kernel.takeMeters?.() ?? [];
        expect(readings[UTILITY_FIELDS.momentary]).toBeCloseTo(-23, 0);
        expect(readings[UTILITY_FIELDS.shortTerm]).toBeCloseTo(-23, 0);
    });
});

describe('gate', () => {
    it('attenuates material below the threshold by the range and passes louder material', () => {
        const kernel = kernelFor('gate', { thresholdDb: -40, rangeDb: 30, releaseMs: 20 });
        const quiet = sine(500, 1, dbfs(-50));
        const [closed] = processStereo(quiet, quiet, (l, r, frames) =>
            kernel.process(l, r, frames),
        );
        expect(db(rms(closed, SAMPLE_RATE / 2) / rms(quiet, SAMPLE_RATE / 2))).toBeCloseTo(-30, 0);
        expect(kernel.takeMeters?.()[GATE_FIELDS.reduction]).toBeCloseTo(30, 0);

        const loud = sine(500, 0.5, dbfs(-20));
        const [open] = processStereo(loud, loud, (l, r, frames) => kernel.process(l, r, frames));
        expect(rms(open, SAMPLE_RATE / 4)).toBeCloseTo(rms(loud, SAMPLE_RATE / 4), 4);
    });

    it('holds the gate open in the hysteresis band', () => {
        const kernel = kernelFor('gate', { thresholdDb: -40, hysteresisDb: 6, holdMs: 0 });
        // Opens at -30 dB, then stays open at -43 dB, above the -46 dB closing level.
        const signal = concat(sine(500, 0.3, dbfs(-30)), sine(500, 0.7, dbfs(-43)));
        const [output] = processStereo(signal, signal, (l, r, frames) =>
            kernel.process(l, r, frames),
        );
        const tail = Math.round(SAMPLE_RATE * 0.6);
        expect(rms(output, tail)).toBeCloseTo(rms(signal, tail), 4);
    });
});

describe('denoiser', () => {
    it('reports its latency and reduces steady noise', () => {
        const kernel = kernelFor('denoiser', { reductionDb: 20 });
        expect(kernel.latency).toBe(1536);
        const left = noise(3, 0.01, 3);
        const right = noise(3, 0.01, 4);
        const [outLeft] = processStereo(left, right, (l, r, frames) =>
            kernel.process(l, r, frames),
        );
        const from = SAMPLE_RATE * 2;
        expect(db(rms(outLeft, from) / rms(left, from))).toBeLessThan(-12);
        expect(kernel.takeMeters?.()[DENOISER_FIELDS.reduction]).toBeGreaterThan(10);
    });

    it('keeps a tone that stands out of the noise', () => {
        const kernel = kernelFor('denoiser', { reductionDb: 20 });
        const latency = 1536;
        // Half-second cycles of tone and pause over steady hiss, like speech or music would be.
        const tone = sine(1000, 3, 0.3).map((value, i) => (i % 24000 < 12000 ? value : 0));
        const hiss = noise(3, 0.003, 5);
        const input = tone.map((value, i) => value + hiss[i]);
        const [output] = processStereo(input, input, (l, r, frames) =>
            kernel.process(l, r, frames),
        );
        // The last tone burst, 2.5 to 2.75 s, away from its edges and shifted by the latency.
        const from = 2.5 * SAMPLE_RATE + 2400;
        const to = 2.75 * SAMPLE_RATE - 2400;
        const kept = rms(output.subarray(from + latency, to + latency));
        expect(db(kept / rms(tone.subarray(from, to)))).toBeGreaterThan(-1);
        // In the pauses, the hiss is reduced.
        const pause = rms(output.subarray(2.8 * SAMPLE_RATE + latency, 2.95 * SAMPLE_RATE));
        expect(db(pause / rms(hiss.subarray(2.8 * SAMPLE_RATE)))).toBeLessThan(-10);
    });

    it('passes the removed noise only in listen mode', () => {
        const kernel = kernelFor('denoiser', { reductionDb: 40, listen: true });
        const left = noise(2, 0.01, 6);
        const [output] = processStereo(left, left, (l, r, frames) => kernel.process(l, r, frames));
        const from = SAMPLE_RATE;
        expect(db(rms(output, from) / rms(left, from))).toBeGreaterThan(-3);
    });
});

describe('denoiser noise profile', () => {
    /** Learns a profile from two seconds of the given noise, as the editor does. */
    function learnProfile(left: Float32Array, right: Float32Array): number[] {
        const kernel = kernelFor('denoiser', { learning: true });
        processStereo(left, right, (l, r, frames) => kernel.process(l, r, frames));
        const readings = kernel.takeMeters?.() ?? [];
        expect(readings[DENOISER_FIELDS.learnedSeconds]).toBeGreaterThan(1.8);
        return readings.slice(DENOISER_FIELDS.profile);
    }

    it('learns one level per band from the recorded noise', () => {
        const profile = learnProfile(noise(2, 0.01, 7), noise(2, 0.01, 8));
        expect(profile).toHaveLength(NOISE_PROFILE_BANDS);
        // White noise has the same power in every FFT bin, so the profile is flat.
        const mids = profile.slice(40, 120);
        expect(Math.max(...mids) - Math.min(...mids)).toBeLessThan(3);
    });

    it('removes the profiled noise and keeps a steady tone that adaptive mode would take', () => {
        const profile = learnProfile(noise(2, 0.01, 7), noise(2, 0.01, 8));
        const tone = sine(1000, 3, 0.05);
        const hissLeft = noise(3, 0.01, 9);
        const hissRight = noise(3, 0.01, 10);
        const left = tone.map((value, i) => value + hissLeft[i]);
        const right = tone.map((value, i) => value + hissRight[i]);
        const latency = 1536;
        const from = SAMPLE_RATE * 2;
        const toneLevel = (mode: 'adaptive' | 'profile') => {
            const kernel = kernelFor('denoiser', { reductionDb: 20, mode, profile });
            const [output] = processStereo(left, right, (l, r, frames) =>
                kernel.process(l, r, frames),
            );
            // Compare against the tone alone: what is left of the hiss is far quieter.
            return db(rms(output.subarray(from + latency)) / rms(tone.subarray(from)));
        };
        expect(toneLevel('profile')).toBeGreaterThan(-1);
        expect(toneLevel('adaptive')).toBeLessThan(-3);

        const kernel = kernelFor('denoiser', { reductionDb: 20, mode: 'profile', profile });
        const [cleaned] = processStereo(hissLeft, hissRight, (l, r, frames) =>
            kernel.process(l, r, frames),
        );
        expect(db(rms(cleaned, from) / rms(hissLeft, from))).toBeLessThan(-12);
    });

    it('falls back to adaptive mode without a profile', () => {
        const kernel = kernelFor('denoiser', { reductionDb: 20, mode: 'profile' });
        const left = noise(3, 0.01, 3);
        const [output] = processStereo(left, left, (l, r, frames) => kernel.process(l, r, frames));
        expect(db(rms(output, SAMPLE_RATE * 2) / rms(left, SAMPLE_RATE * 2))).toBeLessThan(-12);
    });
});

describe('stereo image by frequency', () => {
    function bandsFor(left: Float32Array, right: Float32Array) {
        const kernel = kernelFor('stereo');
        processStereo(left, right, (l, r, frames) => kernel.process(l, r, frames));
        const readings = kernel.takeMeters?.() ?? [];
        expect(readings).toHaveLength(STEREO_FIELDS.bands + STEREO_BANDS * STEREO_BAND_FIELDS.size);
        const frequencies = logFrequencies(STEREO_BANDS);
        return (frequency: number) => {
            const band = frequencies.findIndex((value) => value >= frequency);
            const start = STEREO_FIELDS.bands + band * STEREO_BAND_FIELDS.size;
            return readings.slice(start, start + STEREO_BAND_FIELDS.size);
        };
    }

    it('places each frequency where it sits in the stereo field', () => {
        const low = sine(100, 0.2, 0.5);
        const high = sine(4000, 0.2, 0.5);
        // Low tone centered, high tone only on the left.
        const left = low.map((value, i) => value + high[i]);
        const band = bandsFor(left, low);
        const center = band(100);
        expect(center[STEREO_BAND_FIELDS.position]).toBeCloseTo(0, 1);
        expect(center[STEREO_BAND_FIELDS.correlation]).toBeCloseTo(1, 1);
        expect(center[STEREO_BAND_FIELDS.width]).toBeCloseTo(0, 1);
        expect(band(4000)[STEREO_BAND_FIELDS.position]).toBeLessThan(-0.95);
    });

    it('reads anti-phase content as negative correlation', () => {
        const tone = sine(1000, 0.2, 0.5);
        const band = bandsFor(
            tone,
            tone.map((value) => -value),
        );
        expect(band(1000)[STEREO_BAND_FIELDS.correlation]).toBeLessThan(-0.95);
    });
});
