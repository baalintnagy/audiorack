/** Whole-sample stereo delay that aligns signal paths with different latencies. */
export class StereoDelay {
    private left = new Float32Array(0);
    private right = new Float32Array(0);
    private position = 0;

    /** Current delay in samples. */
    get delay() {
        return this.left.length;
    }

    /** Changes the delay; the buffer is reallocated (and cleared) only when it changes. */
    setDelay(samples: number) {
        const length = Math.max(0, Math.round(samples));
        if (length !== this.left.length) {
            this.left = new Float32Array(length);
            this.right = new Float32Array(length);
            this.position = 0;
        }
    }

    reset() {
        this.left.fill(0);
        this.right.fill(0);
    }

    /** Delays `left`/`right` in place. */
    process(left: Float32Array, right: Float32Array, frames: number) {
        const length = this.left.length;
        if (length === 0) {
            return;
        }
        const bufferLeft = this.left;
        const bufferRight = this.right;
        let position = this.position;
        for (let i = 0; i < frames; i++) {
            const l = left[i];
            const r = right[i];
            left[i] = bufferLeft[position];
            right[i] = bufferRight[position];
            bufferLeft[position] = l;
            bufferRight[position] = r;
            position = position + 1 === length ? 0 : position + 1;
        }
        this.position = position;
    }
}
