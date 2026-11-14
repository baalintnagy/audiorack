/**
 * Second-order IIR sections based on Robert Bristow-Johnson's Audio EQ Cookbook.
 * Coefficients are normalized so that a0 = 1.
 */
export type BiquadType =
    | 'peaking'
    | 'lowshelf'
    | 'highshelf'
    | 'lowpass'
    | 'highpass'
    | 'bandpass'
    | 'notch'
    | 'allpass';

export interface BiquadCoefficients {
    b0: number;
    b1: number;
    b2: number;
    a1: number;
    a2: number;
}

export const IDENTITY: BiquadCoefficients = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };

export const BUTTERWORTH_Q = Math.SQRT1_2;

export function biquadCoefficients(
    type: BiquadType,
    frequency: number,
    q: number,
    gainDb: number,
    sampleRate: number,
): BiquadCoefficients {
    const nyquist = sampleRate / 2;
    const f = Math.min(Math.max(frequency, 1), nyquist * 0.995);
    const w0 = (2 * Math.PI * f) / sampleRate;
    const cos = Math.cos(w0);
    const sin = Math.sin(w0);
    const safeQ = Math.max(q, 0.025);
    const alpha = sin / (2 * safeQ);
    const a = Math.pow(10, gainDb / 40);
    let b0: number;
    let b1: number;
    let b2: number;
    let a0: number;
    let a1: number;
    let a2: number;
    switch (type) {
        case 'lowpass':
            b0 = (1 - cos) / 2;
            b1 = 1 - cos;
            b2 = (1 - cos) / 2;
            a0 = 1 + alpha;
            a1 = -2 * cos;
            a2 = 1 - alpha;
            break;
        case 'highpass':
            b0 = (1 + cos) / 2;
            b1 = -(1 + cos);
            b2 = (1 + cos) / 2;
            a0 = 1 + alpha;
            a1 = -2 * cos;
            a2 = 1 - alpha;
            break;
        case 'bandpass':
            // Constant 0 dB peak gain.
            b0 = alpha;
            b1 = 0;
            b2 = -alpha;
            a0 = 1 + alpha;
            a1 = -2 * cos;
            a2 = 1 - alpha;
            break;
        case 'notch':
            b0 = 1;
            b1 = -2 * cos;
            b2 = 1;
            a0 = 1 + alpha;
            a1 = -2 * cos;
            a2 = 1 - alpha;
            break;
        case 'allpass':
            b0 = 1 - alpha;
            b1 = -2 * cos;
            b2 = 1 + alpha;
            a0 = 1 + alpha;
            a1 = -2 * cos;
            a2 = 1 - alpha;
            break;
        case 'peaking':
            b0 = 1 + alpha * a;
            b1 = -2 * cos;
            b2 = 1 - alpha * a;
            a0 = 1 + alpha / a;
            a1 = -2 * cos;
            a2 = 1 - alpha / a;
            break;
        case 'lowshelf': {
            const sq = 2 * Math.sqrt(a) * alpha;
            b0 = a * (a + 1 - (a - 1) * cos + sq);
            b1 = 2 * a * (a - 1 - (a + 1) * cos);
            b2 = a * (a + 1 - (a - 1) * cos - sq);
            a0 = a + 1 + (a - 1) * cos + sq;
            a1 = -2 * (a - 1 + (a + 1) * cos);
            a2 = a + 1 + (a - 1) * cos - sq;
            break;
        }
        case 'highshelf': {
            const sq = 2 * Math.sqrt(a) * alpha;
            b0 = a * (a + 1 + (a - 1) * cos + sq);
            b1 = -2 * a * (a - 1 + (a + 1) * cos);
            b2 = a * (a + 1 + (a - 1) * cos - sq);
            a0 = a + 1 - (a - 1) * cos + sq;
            a1 = 2 * (a - 1 - (a + 1) * cos);
            a2 = a + 1 - (a - 1) * cos - sq;
            break;
        }
    }
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Linear magnitude of a section at the given frequency. */
export function biquadMagnitude(
    c: BiquadCoefficients,
    frequency: number,
    sampleRate: number,
): number {
    const w = (2 * Math.PI * frequency) / sampleRate;
    const cos1 = Math.cos(w);
    const sin1 = Math.sin(w);
    const cos2 = Math.cos(2 * w);
    const sin2 = Math.sin(2 * w);
    const numRe = c.b0 + c.b1 * cos1 + c.b2 * cos2;
    const numIm = -(c.b1 * sin1 + c.b2 * sin2);
    const denRe = 1 + c.a1 * cos1 + c.a2 * cos2;
    const denIm = -(c.a1 * sin1 + c.a2 * sin2);
    return Math.sqrt((numRe * numRe + numIm * numIm) / (denRe * denRe + denIm * denIm));
}

/**
 * Q values of the second-order sections that form an even-order Butterworth filter.
 * Each section contributes 12 dB/octave.
 */
export function butterworthQs(order: number): number[] {
    const sections = Math.max(1, Math.round(order / 2));
    const n = sections * 2;
    return Array.from(
        { length: sections },
        (_, k) => 1 / (2 * Math.cos(((2 * k + 1) * Math.PI) / (2 * n))),
    );
}

/** Stereo transposed direct form II biquad. */
export class Biquad {
    private c: BiquadCoefficients = IDENTITY;
    private readonly z1 = new Float64Array(2);
    private readonly z2 = new Float64Array(2);

    setCoefficients(coefficients: BiquadCoefficients) {
        this.c = coefficients;
    }

    get coefficients() {
        return this.c;
    }

    reset() {
        this.z1.fill(0);
        this.z2.fill(0);
    }

    tick(x: number, channel: number): number {
        const c = this.c;
        const y = c.b0 * x + this.z1[channel];
        this.z1[channel] = c.b1 * x - c.a1 * y + this.z2[channel];
        this.z2[channel] = c.b2 * x - c.a2 * y;
        return y;
    }

    process(buffer: Float32Array, frames: number, channel: number) {
        const { b0, b1, b2, a1, a2 } = this.c;
        let z1 = this.z1[channel];
        let z2 = this.z2[channel];
        for (let i = 0; i < frames; i++) {
            const x = buffer[i];
            const y = b0 * x + z1;
            z1 = b1 * x - a1 * y + z2;
            z2 = b2 * x - a2 * y;
            buffer[i] = y;
        }
        // Flush denormals and recover from unstable transients.
        this.z1[channel] = Number.isFinite(z1) && Math.abs(z1) > 1e-20 ? z1 : 0;
        this.z2[channel] = Number.isFinite(z2) && Math.abs(z2) > 1e-20 ? z2 : 0;
    }
}

/** A chain of sections, used for steep filter slopes. */
export class BiquadCascade {
    private sections: Biquad[] = [];

    setCoefficients(coefficients: BiquadCoefficients[]) {
        while (this.sections.length < coefficients.length) {
            this.sections.push(new Biquad());
        }
        if (this.sections.length > coefficients.length) {
            this.sections.length = coefficients.length;
        }
        coefficients.forEach((c, index) => this.sections[index].setCoefficients(c));
    }

    reset() {
        this.sections.forEach((section) => section.reset());
    }

    tick(x: number, channel: number): number {
        let y = x;
        for (const section of this.sections) {
            y = section.tick(y, channel);
        }
        return y;
    }

    process(buffer: Float32Array, frames: number, channel: number) {
        for (const section of this.sections) {
            section.process(buffer, frames, channel);
        }
    }
}

/**
 * Coefficients of a Butterworth low or high cut with a 12/24/36/48 dB/octave slope. The
 * resonance factor scales the Q of the sharpest section; 1 keeps a maximally flat passband.
 */
export function cutFilterCoefficients(
    type: 'lowpass' | 'highpass',
    frequency: number,
    slopeDbPerOctave: number,
    resonance: number,
    sampleRate: number,
): BiquadCoefficients[] {
    const qs = butterworthQs(slopeDbPerOctave / 6);
    const sharpest = qs.length - 1;
    return qs.map((q, index) =>
        biquadCoefficients(type, frequency, index === sharpest ? q * resonance : q, 0, sampleRate),
    );
}

export function cascadeMagnitude(
    coefficients: BiquadCoefficients[],
    frequency: number,
    sampleRate: number,
): number {
    return coefficients.reduce(
        (product, c) => product * biquadMagnitude(c, frequency, sampleRate),
        1,
    );
}
