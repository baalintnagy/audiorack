export const SAMPLE_RATE = 48000;
export const BLOCK = 128;

export function sine(frequency: number, seconds: number, amplitude = 0.5): Float32Array {
    const length = Math.round(seconds * SAMPLE_RATE);
    return Float32Array.from(
        { length },
        (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE),
    );
}

/** Deterministic white noise in [-amplitude, amplitude]. */
export function noise(seconds: number, amplitude = 1, seed = 1): Float32Array {
    let state = seed;
    const length = Math.round(seconds * SAMPLE_RATE);
    return Float32Array.from({ length }, () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return ((state / 0xffffffff) * 2 - 1) * amplitude;
    });
}

/** Runs a stereo block processor over whole signals, block by block. */
export function processStereo(
    left: Float32Array,
    right: Float32Array,
    process: (l: Float32Array, r: Float32Array, frames: number) => void,
): [Float32Array, Float32Array] {
    const outLeft = new Float32Array(left.length);
    const outRight = new Float32Array(right.length);
    const blockLeft = new Float32Array(BLOCK);
    const blockRight = new Float32Array(BLOCK);
    for (let start = 0; start < left.length; start += BLOCK) {
        const frames = Math.min(BLOCK, left.length - start);
        blockLeft.set(left.subarray(start, start + frames));
        blockRight.set(right.subarray(start, start + frames));
        process(blockLeft, blockRight, frames);
        outLeft.set(blockLeft.subarray(0, frames), start);
        outRight.set(blockRight.subarray(0, frames), start);
    }
    return [outLeft, outRight];
}

export function rms(signal: Float32Array, from = 0): number {
    const part = signal.subarray(from);
    return Math.sqrt(part.reduce((sum, value) => sum + value * value, 0) / part.length);
}

export function peak(signal: Float32Array): number {
    return signal.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
}

export function db(value: number): number {
    return 20 * Math.log10(value);
}
