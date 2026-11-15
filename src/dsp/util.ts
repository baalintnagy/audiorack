export const MIN_DB = -120;

export function dbToGain(db: number): number {
    return Math.pow(10, db / 20);
}

export function gainToDb(gain: number): number {
    return gain > 1e-6 ? 20 * Math.log10(gain) : MIN_DB;
}

/** One-pole smoothing coefficient reaching ~63% of a step after the given time. */
export function timeCoefficient(ms: number, sampleRate: number): number {
    return ms <= 0 ? 0 : Math.exp(-1 / ((ms / 1000) * sampleRate));
}

export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/** Constant-power pan law (-100 to 100) normalized to unity gain at the center. */
export function panGains(pan: number): { left: number; right: number } {
    const angle = ((pan / 100 + 1) * Math.PI) / 4;
    return { left: Math.cos(angle) * Math.SQRT2, right: Math.sin(angle) * Math.SQRT2 };
}

/** Per-sample one-pole smoother for gains and other continuous parameters. */
export class Smoother {
    private current: number;
    private target: number;
    private coefficient: number;
    private primed = false;

    constructor(value: number, ms: number, sampleRate: number) {
        this.current = value;
        this.target = value;
        this.coefficient = timeCoefficient(ms, sampleRate);
    }

    /** Ramps to `value`; the first call after construction jumps so effects start settled. */
    set(value: number) {
        if (!this.primed) {
            this.primed = true;
            this.current = value;
        }
        this.target = value;
    }

    jump(value: number) {
        this.current = value;
        this.target = value;
    }

    get value() {
        return this.current;
    }

    get settled() {
        return Math.abs(this.current - this.target) < 1e-6;
    }

    next(): number {
        if (this.current !== this.target) {
            this.current = this.target + (this.current - this.target) * this.coefficient;
            if (Math.abs(this.current - this.target) < 1e-7) {
                this.current = this.target;
            }
        }
        return this.current;
    }
}

/** Grows a scratch buffer when the render quantum becomes larger than expected. */
export function ensureCapacity<T extends Float32Array>(buffer: T, frames: number): T {
    return buffer.length >= frames ? buffer : (new Float32Array(frames) as T);
}
