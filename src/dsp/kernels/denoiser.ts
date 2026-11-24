import { NOISE_PROFILE_BANDS, type DenoiserParams } from '../../shared/effects';
import { logFrequencies } from '../../shared/spectrum';
import { FFT } from '../fft';
import { dbToGain } from '../util';
import type { Kernel } from './kernel';

const FRAME = 2048;
const HOP = FRAME / 4;
const BINS = FRAME / 2 + 1;
/** Smoothing of the power the noise floor is tracked from (about 30 ms). */
const TRACKING_SMOOTHING = 0.7;
/**
 * The noise floor is the minimum of the tracked power over about two seconds, kept as the minima
 * of eight sub-windows so the oldest can be dropped: the estimate falls at once and rises to a
 * new, higher floor within two seconds. Shorter windows mistake the dips of music for noise.
 */
const SUB_WINDOWS = 8;
const SUB_WINDOW_SECONDS = 0.25;
/**
 * The minimum of the smoothed power of noise lies below its mean; this factor (about +4 dB)
 * brings the estimate back to the mean.
 */
const MINIMUM_BIAS = 2.5;

/** Number of log-spaced points in each of the denoiser's display curves. */
export const DENOISER_POINTS = 96;

/**
 * Layout of the readings produced by {@link DenoiserKernel}. While a profile is being learned,
 * the learned profile follows the seconds learned so far.
 */
export const DENOISER_FIELDS = {
    reduction: 0,
    input: 1,
    noise: 1 + DENOISER_POINTS,
    gain: 1 + DENOISER_POINTS * 2,
    learnedSeconds: 1 + DENOISER_POINTS * 3,
    profile: 2 + DENOISER_POINTS * 3,
};

/** FFT bins averaged into each band of a noise profile, inclusive. */
function profileBands(binWidth: number): [number, number][] {
    const frequencies = logFrequencies(NOISE_PROFILE_BANDS);
    return Array.from(frequencies, (frequency, index) => {
        const lower = index > 0 ? Math.sqrt(frequency * frequencies[index - 1]) : 0;
        const upper =
            index < NOISE_PROFILE_BANDS - 1
                ? Math.sqrt(frequency * frequencies[index + 1])
                : Infinity;
        const from = Math.min(BINS - 1, Math.round(lower / binWidth));
        const to = Math.min(BINS - 1, Math.max(from, Math.round(upper / binWidth) - 1));
        return [from, to];
    });
}

/**
 * For each FFT bin, the two profile bands around it and the weight of the upper one, so a
 * profile can be interpolated (in dB, over log frequency) back to bins.
 */
function profileInterpolation(binWidth: number) {
    const centers = Array.from(logFrequencies(NOISE_PROFILE_BANDS), (frequency) =>
        Math.log(frequency),
    );
    const lower = new Uint16Array(BINS);
    const weight = new Float64Array(BINS);
    for (let k = 0; k < BINS; k++) {
        const position = Math.log(Math.max(k, 0.5) * binWidth);
        let band = 0;
        while (band < NOISE_PROFILE_BANDS - 2 && centers[band + 1] < position) {
            band++;
        }
        lower[k] = band;
        weight[k] = Math.min(
            1,
            Math.max(0, (position - centers[band]) / (centers[band + 1] - centers[band])),
        );
    }
    return { lower, weight };
}

/**
 * Spectral noise reduction. The stereo signal is analysed in 2048-sample frames with 75% overlap
 * (both channels in one complex FFT). In adaptive mode the noise floor of each bin is the
 * bias-corrected minimum of its smoothed power over the last two seconds; in profile mode it is
 * a noise profile learned earlier by averaging the spectrum of a stretch of noise. Bins that are
 * not clearly above that floor are attenuated by up to the reduction amount. Both channels get
 * the same gains, so the stereo image stays intact.
 */
export class DenoiserKernel implements Kernel<DenoiserParams> {
    readonly latency = FRAME - HOP;
    private readonly fft = new FFT(FRAME);
    private readonly window: Float64Array;
    private readonly inLeft = new Float64Array(FRAME);
    private readonly inRight = new Float64Array(FRAME);
    private readonly outLeft = new Float64Array(FRAME);
    private readonly outRight = new Float64Array(FRAME);
    private readonly accumulateLeft = new Float64Array(FRAME);
    private readonly accumulateRight = new Float64Array(FRAME);
    private readonly re = new Float64Array(FRAME);
    private readonly im = new Float64Array(FRAME);
    private readonly power = new Float64Array(BINS);
    private readonly tracked = new Float64Array(BINS);
    /** Minimum of the current sub-window per bin. */
    private readonly current = new Float64Array(BINS);
    /** Minima of the previous sub-windows, `SUB_WINDOWS` per bin. */
    private readonly history = new Float64Array(BINS * SUB_WINDOWS);
    private readonly noise = new Float64Array(BINS);
    /** The noise floor actually used, adaptive or from the profile. */
    private readonly applied = new Float64Array(BINS);
    /** The profile from the parameters, interpolated to bins; empty means none. */
    private readonly profileNoise = new Float64Array(BINS);
    private hasProfile = false;
    private useProfile = false;
    private profileKey = '';
    private readonly bandBins: [number, number][];
    private readonly interpolation: { lower: Uint16Array; weight: Float64Array };
    /** Power summed per bin while learning, and the number of frames summed. */
    private readonly learnSum = new Float64Array(BINS);
    private learnFrames = 0;
    private learning = false;
    private readonly frameSeconds: number;
    private readonly rawGains = new Float64Array(BINS);
    private readonly rawPowers = new Float64Array(BINS);
    private readonly gains = new Float64Array(BINS);
    private readonly displayBins: Uint32Array;
    private readonly subWindowFrames: number;
    private subWindowFrame = 0;
    private subWindow = 0;
    private readonly displayScale: number;
    private rover = FRAME - HOP;
    /** Frames analysed since the last reset, until the input buffer has filled. */
    private warmup = 0;
    private floor = dbToGain(-12);
    private threshold = Math.pow(10, 6 / 10);
    private smoothing = 0.5;
    private freeze = false;
    private listen = false;
    /** Input and output energy since the last reading, for the reduction meter. */
    private energyIn = 0;
    private energyOut = 0;

    constructor(sampleRate: number) {
        // Square-root Hann windows on both sides overlap-add to a constant at 75% overlap.
        this.window = Float64Array.from({ length: FRAME }, (_, i) =>
            Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME)),
        );
        const binWidth = sampleRate / FRAME;
        this.bandBins = profileBands(binWidth);
        this.interpolation = profileInterpolation(binWidth);
        this.frameSeconds = HOP / sampleRate;
        this.displayBins = Uint32Array.from(logFrequencies(DENOISER_POINTS), (frequency) =>
            Math.min(BINS - 1, Math.max(1, Math.round(frequency / binWidth))),
        );
        this.subWindowFrames = Math.max(1, Math.round((SUB_WINDOW_SECONDS * sampleRate) / HOP));
        // A full-scale sine reads 0 dB on the display.
        const windowSum = this.window.reduce((total, value) => total + value, 0);
        this.displayScale = 2 / windowSum;
        this.reset();
    }

    setParams(p: DenoiserParams) {
        this.floor = dbToGain(-p.reductionDb);
        this.threshold = Math.pow(10, p.thresholdDb / 10);
        this.smoothing = (p.smoothing / 100) * 0.9;
        this.freeze = p.freeze;
        this.listen = p.listen;
        if (p.learning && !this.learning) {
            this.learnSum.fill(0);
            this.learnFrames = 0;
        }
        this.learning = p.learning;
        const key = p.profile.join(',');
        if (key !== this.profileKey) {
            this.profileKey = key;
            this.hasProfile = p.profile.length === NOISE_PROFILE_BANDS;
            if (this.hasProfile) {
                const { lower, weight } = this.interpolation;
                for (let k = 0; k < BINS; k++) {
                    const band = lower[k];
                    const db = p.profile[band] * (1 - weight[k]) + p.profile[band + 1] * weight[k];
                    this.profileNoise[k] = Math.pow(10, db / 10);
                }
            }
        }
        this.useProfile = p.mode === 'profile' && this.hasProfile;
    }

    /** The profile learned so far: mean power per band in dB. */
    private learnedProfile(): number[] {
        return this.bandBins.map(([from, to]) => {
            let sum = 0;
            for (let k = from; k <= to; k++) {
                sum += this.learnSum[k];
            }
            const mean = sum / (to - from + 1) / Math.max(1, this.learnFrames);
            return Math.round(10 * Math.log10(Math.max(mean, 1e-20)) * 10) / 10;
        });
    }

    reset() {
        this.inLeft.fill(0);
        this.inRight.fill(0);
        this.outLeft.fill(0);
        this.outRight.fill(0);
        this.accumulateLeft.fill(0);
        this.accumulateRight.fill(0);
        this.power.fill(0);
        this.tracked.fill(0);
        this.current.fill(Infinity);
        this.history.fill(Infinity);
        this.subWindowFrame = 0;
        this.subWindow = 0;
        this.noise.fill(Infinity);
        this.applied.fill(0);
        this.gains.fill(1);
        this.rover = FRAME - HOP;
        this.warmup = 0;
    }

    process(left: Float32Array, right: Float32Array, frames: number) {
        const latency = FRAME - HOP;
        for (let i = 0; i < frames; i++) {
            this.inLeft[this.rover] = left[i];
            this.inRight[this.rover] = right[i];
            left[i] = this.outLeft[this.rover - latency];
            right[i] = this.outRight[this.rover - latency];
            if (++this.rover >= FRAME) {
                this.rover = latency;
                this.processFrame();
            }
        }
    }

    private processFrame() {
        const { re, im, window } = this;
        for (let i = 0; i < FRAME; i++) {
            re[i] = this.inLeft[i] * window[i];
            im[i] = this.inRight[i] * window[i];
        }
        this.fft.forward(re, im);
        this.updateGains();
        for (let k = 0; k < BINS; k++) {
            const mirror = (FRAME - k) % FRAME;
            const gain = this.listen ? 1 - this.gains[k] : this.gains[k];
            re[k] *= gain;
            im[k] *= gain;
            if (mirror !== k) {
                re[mirror] *= gain;
                im[mirror] *= gain;
            }
        }
        // Inverse FFT through the forward transform of the conjugate.
        for (let i = 0; i < FRAME; i++) {
            im[i] = -im[i];
        }
        this.fft.forward(re, im);
        // 1/N for the inverse transform, 1/2 for the overlap of the squared windows.
        const scale = 1 / FRAME / 2;
        for (let i = 0; i < FRAME; i++) {
            this.accumulateLeft[i] += re[i] * window[i] * scale;
            this.accumulateRight[i] += -im[i] * window[i] * scale;
        }
        for (let i = 0; i < HOP; i++) {
            this.outLeft[i] = this.accumulateLeft[i];
            this.outRight[i] = this.accumulateRight[i];
        }
        this.accumulateLeft.copyWithin(0, HOP);
        this.accumulateRight.copyWithin(0, HOP);
        this.accumulateLeft.fill(0, FRAME - HOP);
        this.accumulateRight.fill(0, FRAME - HOP);
        this.inLeft.copyWithin(0, HOP, FRAME);
        this.inRight.copyWithin(0, HOP, FRAME);
    }

    /** Estimates the noise floor of each bin and derives smoothed spectral gains. */
    private updateGains() {
        const { re, im } = this;
        const powers = this.rawPowers;
        for (let k = 0; k < BINS; k++) {
            const mirror = (FRAME - k) % FRAME;
            // |L|² + |R|² of the two real signals packed into one complex transform.
            const current =
                (re[k] * re[k] +
                    im[k] * im[k] +
                    re[mirror] * re[mirror] +
                    im[mirror] * im[mirror]) /
                2;
            powers[k] = current;
            const filling = this.warmup < FRAME / HOP;
            if (filling) {
                // Frames that still contain the silence before the start would bias the
                // estimates low; start them from the first full frame instead.
                this.power[k] = current;
                this.tracked[k] = current;
            }
            const power = (this.power[k] = this.power[k] * 0.5 + current * 0.5);
            if (!this.freeze && !filling) {
                const tracked = (this.tracked[k] =
                    this.tracked[k] * TRACKING_SMOOTHING + current * (1 - TRACKING_SMOOTHING));
                let minimum = Math.min(this.current[k], tracked);
                this.current[k] = minimum;
                const base = k * SUB_WINDOWS;
                for (let window = 0; window < SUB_WINDOWS; window++) {
                    minimum = Math.min(minimum, this.history[base + window]);
                }
                this.noise[k] = minimum * MINIMUM_BIAS;
            }
            if (this.learning && !filling) {
                this.learnSum[k] += current;
            }
            const noise = this.useProfile
                ? this.profileNoise[k]
                : Number.isFinite(this.noise[k])
                  ? this.noise[k]
                  : power;
            this.applied[k] = noise;
            const wiener = power > 0 ? 1 - (this.threshold * noise) / power : 0;
            this.rawGains[k] = Math.min(1, Math.max(this.floor, wiener));
        }
        for (let k = 0; k < BINS; k++) {
            // Average neighbouring bins, then open quickly and close at the smoothing rate.
            const below = this.rawGains[Math.max(0, k - 1)];
            const above = this.rawGains[Math.min(BINS - 1, k + 1)];
            const target = (below + 2 * this.rawGains[k] + above) / 4;
            const previous = this.gains[k];
            this.gains[k] =
                target > previous ? target : target + (previous - target) * this.smoothing;
            const gain = this.listen ? 1 - this.gains[k] : this.gains[k];
            this.energyIn += powers[k];
            this.energyOut += powers[k] * gain * gain;
        }
        if (this.learning && this.warmup >= FRAME / HOP) {
            this.learnFrames++;
        }
        this.warmup = Math.min(this.warmup + 1, FRAME / HOP);
        if (!this.freeze && ++this.subWindowFrame >= this.subWindowFrames) {
            // Replace the oldest sub-window with the one just completed.
            this.subWindowFrame = 0;
            for (let k = 0; k < BINS; k++) {
                this.history[k * SUB_WINDOWS + this.subWindow] = this.current[k];
            }
            this.current.fill(Infinity);
            this.subWindow = (this.subWindow + 1) % SUB_WINDOWS;
        }
    }

    /**
     * How much quieter the output is than the input in dB, then input level, noise floor (dB)
     * and gain (dB) at {@link DENOISER_POINTS} log-spaced frequencies, the seconds of noise
     * learned, and while learning the profile learned so far.
     */
    takeMeters(): number[] {
        const reduction =
            this.energyIn > 1e-12
                ? 10 * Math.log10(this.energyIn / Math.max(this.energyOut, this.energyIn * 1e-6))
                : 0;
        this.energyIn = 0;
        this.energyOut = 0;
        // Power is summed over both channels; the display shows their average.
        const offset = 20 * Math.log10(this.displayScale) - 10 * Math.log10(2);
        const toDb = (power: number) =>
            Math.round(Math.max(-140, 10 * Math.log10(Math.max(power, 1e-20)) + offset) * 10) / 10;
        const bins = Array.from(this.displayBins);
        return [
            Math.round(reduction * 10) / 10,
            ...bins.map((bin) => toDb(this.power[bin])),
            ...bins.map((bin) => toDb(Number.isFinite(this.applied[bin]) ? this.applied[bin] : 0)),
            ...bins.map(
                (bin) => Math.round(20 * Math.log10(Math.max(this.gains[bin], 1e-4)) * 10) / 10,
            ),
            Math.round(this.learnFrames * this.frameSeconds * 10) / 10,
            ...(this.learning && this.learnFrames > 0 ? this.learnedProfile() : []),
        ];
    }
}
