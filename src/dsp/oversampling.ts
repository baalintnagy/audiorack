import type { OversamplingFactor } from '../shared/effects';
import { ensureCapacity } from './util';

/** Zeroth-order modified Bessel function of the first kind, for the Kaiser window. */
function besselI0(x: number): number {
    let sum = 1;
    let term = 1;
    for (let k = 1; k < 50; k++) {
        term *= (x / (2 * k)) * (x / (2 * k));
        sum += term;
        if (term < sum * 1e-12) {
            break;
        }
    }
    return sum;
}

/**
 * Kaiser-windowed half-band low pass with `4 * order - 1` taps. Every other tap is zero apart
 * from the center (0.5), so only the `2 * order` non-zero outer taps are returned. They sum to
 * 0.5, which gives the filter unity gain at DC.
 */
export function halfbandTaps(order: number, beta: number): Float64Array {
    const length = 4 * order - 1;
    const center = (length - 1) / 2;
    const taps = Float64Array.from({ length: 2 * order }, (_, i) => {
        const offset = 2 * i - center;
        const window =
            besselI0(beta * Math.sqrt(1 - (offset / (center + 1)) ** 2)) / besselI0(beta);
        return (Math.sin((Math.PI * offset) / 2) / (Math.PI * offset)) * window;
    });
    const sum = taps.reduce((total, tap) => total + tap, 0);
    return taps.map((tap) => (tap * 0.5) / sum);
}

/**
 * Doubles the sample rate of one channel: zero stuffing followed by a half-band low pass, split
 * into its two polyphase branches. Delays by `2 * order - 1` samples at the higher rate.
 */
class HalfbandUp {
    private readonly taps: Float64Array;
    private readonly history: Float64Array;
    private position = 0;

    constructor(taps: Float64Array) {
        this.taps = taps.map((tap) => tap * 2);
        this.history = new Float64Array(taps.length * 2);
    }

    reset() {
        this.history.fill(0);
    }

    /** Writes `2 * frames` samples to `output`. */
    process(input: Float32Array, output: Float32Array, frames: number) {
        const taps = this.taps;
        const history = this.history;
        const size = taps.length;
        const half = size / 2;
        let position = this.position;
        for (let j = 0; j < frames; j++) {
            position = position + 1 === size ? 0 : position + 1;
            history[position] = input[j];
            history[position + size] = input[j];
            // `history[newest - i]` is the input i samples ago.
            const newest = position + size;
            let sum = 0;
            for (let i = 0; i < size; i++) {
                sum += taps[i] * history[newest - i];
            }
            output[2 * j] = sum;
            output[2 * j + 1] = history[newest - (half - 1)];
        }
        this.position = position;
    }
}

/**
 * Halves the sample rate of one channel after the same half-band low pass. Delays by
 * `2 * order - 1` samples at the higher rate.
 */
class HalfbandDown {
    private readonly even: Float64Array;
    private readonly odd: Float64Array;
    private evenPosition = 0;
    private oddPosition = 0;

    constructor(private readonly taps: Float64Array) {
        this.even = new Float64Array(taps.length * 2);
        this.odd = new Float64Array(taps.length / 2);
    }

    reset() {
        this.even.fill(0);
        this.odd.fill(0);
    }

    /** Reads `2 * frames` samples from `input`. */
    process(input: Float32Array, output: Float32Array, frames: number) {
        const taps = this.taps;
        const even = this.even;
        const odd = this.odd;
        const size = taps.length;
        const lag = odd.length;
        let evenPosition = this.evenPosition;
        let oddPosition = this.oddPosition;
        for (let j = 0; j < frames; j++) {
            evenPosition = evenPosition + 1 === size ? 0 : evenPosition + 1;
            even[evenPosition] = input[2 * j];
            even[evenPosition + size] = input[2 * j];
            const newest = evenPosition + size;
            let sum = 0;
            for (let i = 0; i < size; i++) {
                sum += taps[i] * even[newest - i];
            }
            // The center tap reads the odd sample `order` steps back.
            const delayed = odd[oddPosition];
            odd[oddPosition] = input[2 * j + 1];
            oddPosition = oddPosition + 1 === lag ? 0 : oddPosition + 1;
            output[j] = sum + 0.5 * delayed;
        }
        this.evenPosition = evenPosition;
        this.oddPosition = oddPosition;
    }
}

/** Steep first stage (base rate to 2×) and a short second stage (2× to 4×). */
const FIRST_ORDER = 16;
const SECOND_ORDER = 5;
const FIRST_TAPS = halfbandTaps(FIRST_ORDER, 8);
const SECOND_TAPS = halfbandTaps(SECOND_ORDER, 6);

/** Base-rate latency of a round trip through the oversampler, per factor. */
export const OVERSAMPLING_LATENCY: Record<OversamplingFactor, number> = {
    1: 0,
    2: 2 * FIRST_ORDER - 1,
    // The second stage takes 2 * SECOND_ORDER - 1 samples at 2×; one more makes it whole.
    4: 2 * FIRST_ORDER - 1 + SECOND_ORDER,
};

export const MAX_OVERSAMPLING_LATENCY = Math.max(...Object.values(OVERSAMPLING_LATENCY));

interface Channel {
    firstUp: HalfbandUp;
    firstDown: HalfbandDown;
    secondUp: HalfbandUp;
    secondDown: HalfbandDown;
    /** Last 2× sample on the way down, for the one-sample alignment delay. */
    pending: number;
}

/**
 * Stereo 1×/2×/4× oversampler built from linear-phase half-band FIR stages. `up` returns the
 * signal at the higher rate in an internal buffer; process it in place and pass it to `down`.
 */
export class Oversampler {
    private readonly channels: Channel[] = [0, 1].map(() => ({
        firstUp: new HalfbandUp(FIRST_TAPS),
        firstDown: new HalfbandDown(FIRST_TAPS),
        secondUp: new HalfbandUp(SECOND_TAPS),
        secondDown: new HalfbandDown(SECOND_TAPS),
        pending: 0,
    }));
    private high = [new Float32Array(512), new Float32Array(512)];
    private middle = new Float32Array(256);
    private current: OversamplingFactor = 1;

    get factor() {
        return this.current;
    }

    /** Base-rate delay of the current factor. */
    get latency() {
        return OVERSAMPLING_LATENCY[this.current];
    }

    setFactor(factor: OversamplingFactor) {
        if (factor !== this.current) {
            this.current = factor;
            this.reset();
        }
    }

    reset() {
        this.channels.forEach((channel) => {
            channel.firstUp.reset();
            channel.firstDown.reset();
            channel.secondUp.reset();
            channel.secondDown.reset();
            channel.pending = 0;
        });
    }

    /** Upsamples `frames` samples of one channel; the result holds `frames * factor` samples. */
    up(input: Float32Array, frames: number, ch: number): Float32Array {
        const factor = this.current;
        this.high[ch] = ensureCapacity(this.high[ch], frames * factor);
        const high = this.high[ch];
        const channel = this.channels[ch];
        if (factor === 1) {
            high.set(input.subarray(0, frames));
        } else if (factor === 2) {
            channel.firstUp.process(input, high, frames);
        } else {
            this.middle = ensureCapacity(this.middle, frames * 2);
            channel.firstUp.process(input, this.middle, frames);
            channel.secondUp.process(this.middle, high, frames * 2);
        }
        return high;
    }

    /** Downsamples `frames * factor` samples of one channel into `output`. */
    down(high: Float32Array, output: Float32Array, frames: number, ch: number) {
        const factor = this.current;
        const channel = this.channels[ch];
        if (factor === 1) {
            output.set(high.subarray(0, frames));
        } else if (factor === 2) {
            channel.firstDown.process(high, output, frames);
        } else {
            this.middle = ensureCapacity(this.middle, frames * 2);
            const middle = this.middle;
            channel.secondDown.process(high, middle, frames * 2);
            let pending = channel.pending;
            for (let i = 0; i < frames * 2; i++) {
                const value = middle[i];
                middle[i] = pending;
                pending = value;
            }
            channel.pending = pending;
            channel.firstDown.process(middle, output, frames);
        }
    }
}
