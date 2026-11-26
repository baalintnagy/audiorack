import { Biquad, type BiquadCoefficients } from './biquad';

/** Readings below this are reported as silence; the absolute gate of BS.1770 is at -70 LUFS. */
export const SILENCE_LUFS = -120;
const ABSOLUTE_GATE_LUFS = -70;
const INTEGRATED_RELATIVE_GATE_LU = -10;
const RANGE_RELATIVE_GATE_LU = -20;

const SUB_BLOCK_SECONDS = 0.1;
const MOMENTARY_SUB_BLOCKS = 4;
const SHORT_TERM_SUB_BLOCKS = 30;

/**
 * The two K-weighting stages of ITU-R BS.1770: a high shelf modelling the head and an RLB
 * high-pass, designed from their analog prototypes so any sample rate gets the same response.
 */
export function kWeightingCoefficients(
    sampleRate: number,
): [BiquadCoefficients, BiquadCoefficients] {
    const shelfK = Math.tan((Math.PI * 1681.974450955533) / sampleRate);
    const shelfQ = 0.7071752369554196;
    const vh = Math.pow(10, 3.999843853973347 / 20);
    const vb = Math.pow(vh, 0.4996667741545416);
    const shelfA0 = 1 + shelfK / shelfQ + shelfK * shelfK;
    const shelf: BiquadCoefficients = {
        b0: (vh + (vb * shelfK) / shelfQ + shelfK * shelfK) / shelfA0,
        b1: (2 * (shelfK * shelfK - vh)) / shelfA0,
        b2: (vh - (vb * shelfK) / shelfQ + shelfK * shelfK) / shelfA0,
        a1: (2 * (shelfK * shelfK - 1)) / shelfA0,
        a2: (1 - shelfK / shelfQ + shelfK * shelfK) / shelfA0,
    };
    const highK = Math.tan((Math.PI * 38.13547087602444) / sampleRate);
    const highQ = 0.5003270373238773;
    const highA0 = 1 + highK / highQ + highK * highK;
    const highPass: BiquadCoefficients = {
        b0: 1,
        b1: -2,
        b2: 1,
        a1: (2 * (highK * highK - 1)) / highA0,
        a2: (1 - highK / highQ + highK * highK) / highA0,
    };
    return [shelf, highPass];
}

/** Loudness in LUFS of a K-weighted mean square summed over the channels. */
export function energyToLufs(energy: number): number {
    return energy > 1e-13 ? -0.691 + 10 * Math.log10(energy) : SILENCE_LUFS;
}

const HISTOGRAM_STEP = 0.05;
const HISTOGRAM_BINS = Math.round((10 - ABSOLUTE_GATE_LUFS) / HISTOGRAM_STEP);

/**
 * Block loudness values above the absolute gate, kept as a fixed-size histogram (count and
 * summed energy per 0.05 LU bin) so a measurement can run indefinitely without growing.
 */
class BlockHistogram {
    private readonly counts = new Float64Array(HISTOGRAM_BINS);
    private readonly energies = new Float64Array(HISTOGRAM_BINS);

    add(energy: number) {
        const lufs = energyToLufs(energy);
        if (lufs < ABSOLUTE_GATE_LUFS) {
            return;
        }
        const bin = Math.min(
            HISTOGRAM_BINS - 1,
            Math.floor((lufs - ABSOLUTE_GATE_LUFS) / HISTOGRAM_STEP),
        );
        this.counts[bin]++;
        this.energies[bin] += energy;
    }

    reset() {
        this.counts.fill(0);
        this.energies.fill(0);
    }

    /** First bin whose blocks pass a gate `relativeLu` below the mean of all blocks. */
    private gateBin(relativeLu: number): number | undefined {
        let count = 0;
        let energy = 0;
        for (let bin = 0; bin < HISTOGRAM_BINS; bin++) {
            count += this.counts[bin];
            energy += this.energies[bin];
        }
        if (count === 0) {
            return undefined;
        }
        const gate = energyToLufs(energy / count) + relativeLu;
        return Math.max(0, Math.ceil((gate - ABSOLUTE_GATE_LUFS) / HISTOGRAM_STEP));
    }

    /** Power mean of the blocks that pass both gates (integrated loudness). */
    gatedLoudness(relativeLu: number): number {
        const first = this.gateBin(relativeLu);
        if (first === undefined) {
            return SILENCE_LUFS;
        }
        let count = 0;
        let energy = 0;
        for (let bin = first; bin < HISTOGRAM_BINS; bin++) {
            count += this.counts[bin];
            energy += this.energies[bin];
        }
        return count > 0 ? energyToLufs(energy / count) : SILENCE_LUFS;
    }

    /** Spread between the 10th and 95th percentile of the gated blocks (loudness range). */
    range(relativeLu: number): number {
        const first = this.gateBin(relativeLu);
        if (first === undefined) {
            return 0;
        }
        let total = 0;
        for (let bin = first; bin < HISTOGRAM_BINS; bin++) {
            total += this.counts[bin];
        }
        if (total === 0) {
            return 0;
        }
        const percentile = (fraction: number) => {
            let seen = 0;
            for (let bin = first; bin < HISTOGRAM_BINS; bin++) {
                seen += this.counts[bin];
                if (seen >= fraction * total) {
                    return bin;
                }
            }
            return HISTOGRAM_BINS - 1;
        };
        return (percentile(0.95) - percentile(0.1)) * HISTOGRAM_STEP;
    }
}

/**
 * K-weighted loudness of a stereo signal per EBU R128: momentary (400 ms) and short-term (3 s)
 * windows from 100 ms sub-blocks, and optionally the gated integrated loudness and loudness
 * range since the last reset.
 */
export class LoudnessMeter {
    private readonly shelf = new Biquad();
    private readonly highPass = new Biquad();
    private readonly subBlockLength: number;
    private readonly subBlocks = new Float64Array(SHORT_TERM_SUB_BLOCKS);
    private position = 0;
    private filled = 0;
    private sum = 0;
    private count = 0;
    private readonly integrated = new BlockHistogram();
    private readonly shortTerms = new BlockHistogram();
    private momentaryMax = SILENCE_LUFS;
    private shortTermMax = SILENCE_LUFS;

    constructor(
        sampleRate: number,
        private readonly gated = false,
    ) {
        const [shelf, highPass] = kWeightingCoefficients(sampleRate);
        this.shelf.setCoefficients(shelf);
        this.highPass.setCoefficients(highPass);
        this.subBlockLength = Math.round(sampleRate * SUB_BLOCK_SECONDS);
    }

    reset() {
        this.shelf.reset();
        this.highPass.reset();
        this.subBlocks.fill(0);
        this.position = 0;
        this.filled = 0;
        this.sum = 0;
        this.count = 0;
        this.integrated.reset();
        this.shortTerms.reset();
        this.momentaryMax = SILENCE_LUFS;
        this.shortTermMax = SILENCE_LUFS;
    }

    process(left: Float32Array, right: Float32Array, frames: number) {
        for (let i = 0; i < frames; i++) {
            const l = this.highPass.tick(this.shelf.tick(left[i], 0), 0);
            const r = this.highPass.tick(this.shelf.tick(right[i], 1), 1);
            this.sum += l * l + r * r;
            if (++this.count === this.subBlockLength) {
                this.completeSubBlock();
            }
        }
    }

    private completeSubBlock() {
        this.subBlocks[this.position] = this.sum / this.count;
        this.position = (this.position + 1) % SHORT_TERM_SUB_BLOCKS;
        this.filled = Math.min(SHORT_TERM_SUB_BLOCKS, this.filled + 1);
        this.sum = 0;
        this.count = 0;
        // Gating blocks are the 400 ms momentary windows, overlapping by 75%; loudness range
        // uses the 3 s short-term windows every 100 ms.
        if (this.filled >= MOMENTARY_SUB_BLOCKS) {
            const momentary = this.windowEnergy(MOMENTARY_SUB_BLOCKS);
            this.momentaryMax = Math.max(this.momentaryMax, energyToLufs(momentary));
            if (this.gated) {
                this.integrated.add(momentary);
            }
        }
        if (this.filled >= SHORT_TERM_SUB_BLOCKS) {
            const shortTerm = this.windowEnergy(SHORT_TERM_SUB_BLOCKS);
            this.shortTermMax = Math.max(this.shortTermMax, energyToLufs(shortTerm));
            if (this.gated) {
                this.shortTerms.add(shortTerm);
            }
        }
    }

    /** Mean energy of the newest `length` sub-blocks (fewer right after a reset). */
    private windowEnergy(length: number): number {
        const available = Math.min(length, this.filled);
        if (available === 0) {
            return 0;
        }
        let energy = 0;
        for (let age = 0; age < available; age++) {
            const index = (this.position - 1 - age + SHORT_TERM_SUB_BLOCKS) % SHORT_TERM_SUB_BLOCKS;
            energy += this.subBlocks[index];
        }
        return energy / available;
    }

    /** Loudness of the newest 100 ms block alone, which follows a sudden pause at once. */
    get latestBlock(): number {
        return energyToLufs(this.windowEnergy(1));
    }

    get momentary(): number {
        return energyToLufs(this.windowEnergy(MOMENTARY_SUB_BLOCKS));
    }

    get shortTerm(): number {
        return energyToLufs(this.windowEnergy(SHORT_TERM_SUB_BLOCKS));
    }

    get integratedLoudness(): number {
        return this.integrated.gatedLoudness(INTEGRATED_RELATIVE_GATE_LU);
    }

    get loudnessRange(): number {
        return this.shortTerms.range(RANGE_RELATIVE_GATE_LU);
    }

    get maxMomentary(): number {
        return this.momentaryMax;
    }

    get maxShortTerm(): number {
        return this.shortTermMax;
    }
}

const OVERSAMPLING = 4;
const TAPS_PER_PHASE = 16;

/** Polyphase windowed-sinc interpolator taps for 4× oversampling, each phase summing to 1. */
function interpolationPhases(): Float64Array[] {
    const length = OVERSAMPLING * TAPS_PER_PHASE;
    const center = (length - 1) / 2;
    const taps = Array.from({ length }, (_, n) => {
        const t = (n - center) / OVERSAMPLING;
        const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
        // Blackman window.
        const phase = (2 * Math.PI * n) / (length - 1);
        return sinc * (0.42 - 0.5 * Math.cos(phase) + 0.08 * Math.cos(2 * phase));
    });
    return Array.from({ length: OVERSAMPLING }, (_, phase) => {
        const coefficients = Float64Array.from(
            { length: TAPS_PER_PHASE },
            (_, k) => taps[phase + k * OVERSAMPLING],
        );
        const sum = coefficients.reduce((total, value) => total + value, 0);
        return coefficients.map((value) => value / sum);
    });
}

/** Inter-sample peak level estimated by 4× oversampling, as for dBTP readings. */
export class TruePeakMeter {
    private readonly phases = interpolationPhases();
    private readonly history = [new Float64Array(TAPS_PER_PHASE), new Float64Array(TAPS_PER_PHASE)];
    private position = 0;
    private peak = 0;
    private max = 0;

    reset() {
        this.history.forEach((history) => history.fill(0));
        this.peak = 0;
        this.max = 0;
    }

    process(left: Float32Array, right: Float32Array, frames: number) {
        for (let i = 0; i < frames; i++) {
            this.history[0][this.position] = left[i];
            this.history[1][this.position] = right[i];
            for (let channel = 0; channel < 2; channel++) {
                const history = this.history[channel];
                for (let phase = 0; phase < OVERSAMPLING; phase++) {
                    const coefficients = this.phases[phase];
                    let value = 0;
                    for (let k = 0; k < TAPS_PER_PHASE; k++) {
                        value +=
                            coefficients[k] *
                            history[(this.position - k + TAPS_PER_PHASE) % TAPS_PER_PHASE];
                    }
                    const magnitude = Math.abs(value);
                    if (magnitude > this.peak) {
                        this.peak = magnitude;
                    }
                }
            }
            this.position = (this.position + 1) % TAPS_PER_PHASE;
        }
        if (this.peak > this.max) {
            this.max = this.peak;
        }
    }

    /** Highest true peak since the previous call, as a linear gain. */
    takePeak(): number {
        const value = this.peak;
        this.peak = 0;
        return value;
    }

    /** Highest true peak since the last reset, as a linear gain. */
    get maxPeak(): number {
        return this.max;
    }
}
