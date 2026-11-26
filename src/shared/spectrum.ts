export const MIN_FREQUENCY = 20;
export const MAX_FREQUENCY = 20000;
export const SPECTRUM_BINS = 192;
/** The level a spectrum reading gives for silence: the floor of every bin. */
export const SILENCE_DB = -140;

/** Log-spaced band centers between 20 Hz and 20 kHz. */
export function logFrequencies(count: number): Float32Array {
    const ratio = Math.log(MAX_FREQUENCY / MIN_FREQUENCY);
    return Float32Array.from(
        { length: count },
        (_, index) => MIN_FREQUENCY * Math.exp((ratio * index) / (count - 1)),
    );
}

export const SPECTRUM_FREQUENCIES = logFrequencies(SPECTRUM_BINS);

/**
 * Reduces linear FFT magnitudes (dB) to log-spaced bins. Wide bands take the loudest FFT
 * bin; narrow low-frequency bands interpolate between neighbouring bins.
 */
export function toLogSpectrum(
    fft: Float32Array,
    sampleRate: number,
    frequencies: Float32Array = SPECTRUM_FREQUENCIES,
): number[] {
    const binWidth = sampleRate / 2 / fft.length;
    const count = frequencies.length;
    return Array.from(frequencies, (frequency, index) => {
        const lower = index > 0 ? Math.sqrt(frequency * frequencies[index - 1]) : frequency;
        const upper = index < count - 1 ? Math.sqrt(frequency * frequencies[index + 1]) : frequency;
        const from = Math.floor(lower / binWidth);
        const to = Math.min(fft.length - 1, Math.ceil(upper / binWidth));
        let value: number;
        if (to - from <= 1) {
            const position = Math.min(frequency / binWidth, fft.length - 1);
            const base = Math.floor(position);
            const next = Math.min(base + 1, fft.length - 1);
            const fraction = position - base;
            value = fft[base] * (1 - fraction) + fft[next] * fraction;
        } else {
            value = -Infinity;
            for (let bin = from; bin <= to; bin++) {
                value = Math.max(value, fft[bin]);
            }
        }
        return Number.isFinite(value)
            ? Math.round(Math.max(value, SILENCE_DB) * 10) / 10
            : SILENCE_DB;
    });
}
