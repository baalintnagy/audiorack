import { BUTTERWORTH_Q, BiquadCascade, biquadCoefficients } from './biquad';
import { ensureCapacity } from './util';

/**
 * Fourth-order Linkwitz-Riley crossover. The low and high outputs sum to an allpass
 * response, so splitting and recombining keeps a flat magnitude.
 */
export class LinkwitzRiley {
    private readonly low = new BiquadCascade();
    private readonly high = new BiquadCascade();

    setFrequency(frequency: number, sampleRate: number) {
        const lp = biquadCoefficients('lowpass', frequency, BUTTERWORTH_Q, 0, sampleRate);
        const hp = biquadCoefficients('highpass', frequency, BUTTERWORTH_Q, 0, sampleRate);
        this.low.setCoefficients([lp, lp]);
        this.high.setCoefficients([hp, hp]);
    }

    reset() {
        this.low.reset();
        this.high.reset();
    }

    /** Splits `input` into `low` and `high`; `input` may alias `high`. */
    split(input: Float32Array, low: Float32Array, high: Float32Array, frames: number, ch: number) {
        low.set(input.subarray(0, frames));
        if (high !== input) {
            high.set(input.subarray(0, frames));
        }
        this.low.process(low, frames, ch);
        this.high.process(high, frames, ch);
    }

    /** Applies the crossover's allpass phase response without splitting. */
    allpass(buffer: Float32Array, scratch: Float32Array, frames: number, ch: number) {
        scratch.set(buffer.subarray(0, frames));
        this.low.process(buffer, frames, ch);
        this.high.process(scratch, frames, ch);
        for (let i = 0; i < frames; i++) {
            buffer[i] += scratch[i];
        }
    }
}

/**
 * Splits a signal into `crossovers.length + 1` phase-aligned bands. Lower bands pass
 * through allpass copies of the higher crossovers so that the band sum stays flat.
 */
export class MultibandSplitter {
    private splits: LinkwitzRiley[] = [];
    private compensation: LinkwitzRiley[][] = [];
    private scratch = new Float32Array(128);
    private frequencies: number[] = [];

    setCrossovers(frequencies: number[], sampleRate: number) {
        const changedCount = frequencies.length !== this.frequencies.length;
        if (changedCount) {
            this.splits = frequencies.map(() => new LinkwitzRiley());
            this.compensation = frequencies.map((_, band) =>
                frequencies.slice(band + 1).map(() => new LinkwitzRiley()),
            );
        }
        frequencies.forEach((frequency, index) => {
            this.splits[index].setFrequency(frequency, sampleRate);
            this.compensation
                .flatMap((filters, band) =>
                    filters.map((filter, offset) => ({ filter, at: band + 1 + offset })),
                )
                .filter(({ at }) => at === index)
                .forEach(({ filter }) => filter.setFrequency(frequency, sampleRate));
        });
        this.frequencies = [...frequencies];
    }

    get bandCount() {
        return this.frequencies.length + 1;
    }

    reset() {
        this.splits.forEach((split) => split.reset());
        this.compensation.flat().forEach((filter) => filter.reset());
    }

    /** `bands[0]` receives the input; afterwards bands are ordered from low to high. */
    split(bands: Float32Array[], frames: number, ch: number) {
        this.scratch = ensureCapacity(this.scratch, frames);
        const count = this.bandCount;
        // Peel off the lowest band first; the remainder moves upwards.
        const rest = bands[count - 1];
        if (rest !== bands[0]) {
            rest.set(bands[0].subarray(0, frames));
        }
        for (let index = 0; index < count - 1; index++) {
            this.splits[index].split(rest, bands[index], rest, frames, ch);
            this.compensation[index].forEach((filter) =>
                filter.allpass(bands[index], this.scratch, frames, ch),
            );
        }
    }
}
