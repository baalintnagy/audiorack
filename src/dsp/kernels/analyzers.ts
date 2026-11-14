import type {
    AnalyzerChannel,
    SpectrogramParams,
    SpectrumParams,
    StereoParams,
} from '../../shared/effects';
import { SPECTRUM_BINS, logFrequencies, toLogSpectrum } from '../../shared/spectrum';
import { FFT, hannWindow } from '../fft';
import type { Kernel } from './kernel';

const HISTORY = 8192;

/** Records the most recent stereo samples without altering the signal. */
class Tap {
    readonly left = new Float32Array(HISTORY);
    readonly right = new Float32Array(HISTORY);
    position = 0;

    write(left: Float32Array, right: Float32Array, frames: number) {
        for (let i = 0; i < frames; i++) {
            this.left[this.position] = left[i];
            this.right[this.position] = right[i];
            this.position = (this.position + 1) % HISTORY;
        }
    }

    /** Index of the sample `age` samples ago (0 is the newest). */
    index(age: number) {
        return (this.position - 1 - age + HISTORY * 2) % HISTORY;
    }

    reset() {
        this.left.fill(0);
        this.right.fill(0);
    }
}

function mixChannel(channel: AnalyzerChannel, l: number, r: number): number {
    switch (channel) {
        case 'left':
            return l;
        case 'right':
            return r;
        case 'side':
            return (l - r) * 0.5;
        case 'mono':
        case 'mid':
            return (l + r) * 0.5;
    }
}

/**
 * Computes a Hann-windowed FFT of the tapped signal and reduces it to log-spaced bins.
 * Levels are normalized so a full-scale sine reads 0 dBFS.
 */
class SpectrumTap implements Kernel<{ channel: AnalyzerChannel; fftSize: number }> {
    private readonly tap = new Tap();
    private channel: AnalyzerChannel = 'mono';
    private fft = new FFT(4096);
    private window = hannWindow(4096);
    private re = new Float64Array(4096);
    private im = new Float64Array(4096);
    private magnitudes = new Float32Array(2048);
    private readonly frequencies: Float32Array;

    constructor(
        private readonly sampleRate: number,
        bins: number,
    ) {
        this.frequencies = logFrequencies(bins);
    }

    setParams(p: { channel: AnalyzerChannel; fftSize: number }) {
        this.channel = p.channel;
        if (p.fftSize !== this.fft.size) {
            this.fft = new FFT(p.fftSize);
            this.window = hannWindow(p.fftSize);
            this.re = new Float64Array(p.fftSize);
            this.im = new Float64Array(p.fftSize);
            this.magnitudes = new Float32Array(p.fftSize / 2);
        }
    }

    process(left: Float32Array, right: Float32Array, frames: number) {
        this.tap.write(left, right, frames);
    }

    reset() {
        this.tap.reset();
    }

    takeMeters(): number[] {
        const n = this.fft.size;
        const { left, right } = this.tap;
        for (let i = 0; i < n; i++) {
            const index = this.tap.index(n - 1 - i);
            this.re[i] = mixChannel(this.channel, left[index], right[index]) * this.window[i];
            this.im[i] = 0;
        }
        this.fft.forward(this.re, this.im);
        // A Hann window sums to n/2; doubling restores the energy of the negative frequencies.
        const scale = 4 / n;
        for (let k = 0; k < n / 2; k++) {
            const magnitude = Math.hypot(this.re[k], this.im[k]) * scale;
            this.magnitudes[k] = 20 * Math.log10(Math.max(magnitude, 1e-7));
        }
        return toLogSpectrum(this.magnitudes, this.sampleRate, this.frequencies);
    }
}

export class SpectrumKernel extends SpectrumTap implements Kernel<SpectrumParams> {
    constructor(sampleRate: number) {
        super(sampleRate, SPECTRUM_BINS);
    }
}

export const SPECTROGRAM_BINS = 256;

export class SpectrogramKernel extends SpectrumTap implements Kernel<SpectrogramParams> {
    constructor(sampleRate: number) {
        super(sampleRate, SPECTROGRAM_BINS);
    }
}

export const STEREO_POINTS = 256;
const STEREO_WINDOW = 2048;

/** Layout of the readings produced by {@link StereoKernel}. */
export const STEREO_FIELDS = { correlation: 0, balance: 1, width: 2, peak: 3, points: 4 };

function round(value: number) {
    return Math.round(value * 10000) / 10000;
}

/**
 * Stereo statistics over the most recent window: phase correlation (-1..1), balance in dB
 * (positive is louder left), side-to-mid ratio, peak, and interleaved L/R sample pairs for
 * the goniometer.
 */
export class StereoKernel implements Kernel<StereoParams> {
    private readonly tap = new Tap();

    constructor(_sampleRate: number) {}

    setParams() {}

    process(left: Float32Array, right: Float32Array, frames: number) {
        this.tap.write(left, right, frames);
    }

    reset() {
        this.tap.reset();
    }

    takeMeters(): number[] {
        const { left, right } = this.tap;
        let lr = 0;
        let ll = 0;
        let rr = 0;
        let mid = 0;
        let side = 0;
        let peak = 0;
        for (let age = 0; age < STEREO_WINDOW; age++) {
            const index = this.tap.index(age);
            const l = left[index];
            const r = right[index];
            lr += l * r;
            ll += l * l;
            rr += r * r;
            mid += (l + r) * (l + r);
            side += (l - r) * (l - r);
            peak = Math.max(peak, Math.abs(l), Math.abs(r));
        }
        const silent = ll + rr < 1e-10;
        const correlation = silent ? 0 : lr / Math.sqrt(Math.max(ll * rr, 1e-20));
        const balance = silent ? 0 : 10 * Math.log10(Math.max(ll, 1e-12) / Math.max(rr, 1e-12));
        const width = silent ? 0 : Math.sqrt(side / Math.max(mid, 1e-12));
        const points = Array.from({ length: STEREO_POINTS * 2 }, (_, i) => {
            const index = this.tap.index(STEREO_POINTS - 1 - (i >> 1));
            return round(i & 1 ? right[index] : left[index]);
        });
        return [
            round(Math.max(-1, Math.min(1, correlation))),
            round(Math.max(-60, Math.min(60, balance))),
            round(Math.min(width, 10)),
            round(peak),
            ...points,
        ];
    }
}
