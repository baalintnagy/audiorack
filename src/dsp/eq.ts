import type { EqBand } from '../shared/effects';
import {
    BUTTERWORTH_Q,
    biquadCoefficients,
    cascadeMagnitude,
    cutFilterCoefficients,
    type BiquadCoefficients,
} from './biquad';

export function eqBandCoefficients(band: EqBand, sampleRate: number): BiquadCoefficients[] {
    if (!band.enabled) {
        return [];
    }
    switch (band.type) {
        case 'bell':
            return [biquadCoefficients('peaking', band.frequency, band.q, band.gainDb, sampleRate)];
        case 'lowshelf':
            return [
                biquadCoefficients('lowshelf', band.frequency, band.q, band.gainDb, sampleRate),
            ];
        case 'highshelf':
            return [
                biquadCoefficients('highshelf', band.frequency, band.q, band.gainDb, sampleRate),
            ];
        case 'lowcut':
            return cutFilterCoefficients(
                'highpass',
                band.frequency,
                band.slope,
                band.q / BUTTERWORTH_Q,
                sampleRate,
            );
        case 'highcut':
            return cutFilterCoefficients(
                'lowpass',
                band.frequency,
                band.slope,
                band.q / BUTTERWORTH_Q,
                sampleRate,
            );
        case 'notch':
            return [biquadCoefficients('notch', band.frequency, band.q, 0, sampleRate)];
        case 'bandpass':
            return [biquadCoefficients('bandpass', band.frequency, band.q, 0, sampleRate)];
    }
}

/** Combined EQ response in dB at each frequency. */
export function eqResponseDb(
    bands: EqBand[],
    frequencies: ArrayLike<number>,
    sampleRate: number,
): Float32Array {
    const sections = bands.flatMap((band) => eqBandCoefficients(band, sampleRate));
    return Float32Array.from({ length: frequencies.length }, (_, index) => {
        const magnitude = cascadeMagnitude(sections, frequencies[index], sampleRate);
        return 20 * Math.log10(Math.max(magnitude, 1e-6));
    });
}
