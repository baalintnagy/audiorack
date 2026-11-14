export interface Kernel<P> {
    setParams(params: P): void;
    /** Processes a stereo block in place. */
    process(left: Float32Array, right: Float32Array, frames: number): void;
    reset(): void;
    /** Gain reduction values in dB since the previous call, if the effect has any. */
    takeMeters?(): number[];
}
