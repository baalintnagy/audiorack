/** In-place iterative radix-2 complex FFT with precomputed twiddles and bit reversal. */
export class FFT {
    private readonly cos: Float64Array;
    private readonly sin: Float64Array;
    private readonly reversed: Uint32Array;

    constructor(readonly size: number) {
        if (size < 2 || (size & (size - 1)) !== 0) {
            throw new Error(`FFT size must be a power of two, got ${size}`);
        }
        const half = size / 2;
        this.cos = Float64Array.from({ length: half }, (_, i) =>
            Math.cos((-2 * Math.PI * i) / size),
        );
        this.sin = Float64Array.from({ length: half }, (_, i) =>
            Math.sin((-2 * Math.PI * i) / size),
        );
        const bits = Math.log2(size);
        this.reversed = Uint32Array.from({ length: size }, (_, i) => {
            let value = 0;
            for (let bit = 0; bit < bits; bit++) {
                value = (value << 1) | ((i >> bit) & 1);
            }
            return value;
        });
    }

    forward(re: Float64Array, im: Float64Array) {
        const n = this.size;
        for (let i = 0; i < n; i++) {
            const j = this.reversed[i];
            if (j > i) {
                [re[i], re[j]] = [re[j], re[i]];
                [im[i], im[j]] = [im[j], im[i]];
            }
        }
        for (let length = 2; length <= n; length <<= 1) {
            const half = length >> 1;
            const step = n / length;
            for (let start = 0; start < n; start += length) {
                for (let k = 0; k < half; k++) {
                    const wr = this.cos[k * step];
                    const wi = this.sin[k * step];
                    const a = start + k;
                    const b = a + half;
                    const tr = re[b] * wr - im[b] * wi;
                    const ti = re[b] * wi + im[b] * wr;
                    re[b] = re[a] - tr;
                    im[b] = im[a] - ti;
                    re[a] += tr;
                    im[a] += ti;
                }
            }
        }
    }
}

export function hannWindow(size: number): Float64Array {
    return Float64Array.from(
        { length: size },
        (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)),
    );
}
