import { dbToGain, gainToDb, timeCoefficient } from './util';

/** Static output level of a soft-knee compressor (Giannoulis, Massberg & Reiss, 2012). */
export function gainComputerDb(
    inputDb: number,
    thresholdDb: number,
    ratio: number,
    kneeDb: number,
): number {
    const over = inputDb - thresholdDb;
    if (2 * over < -kneeDb) {
        return inputDb;
    }
    if (kneeDb > 0 && 2 * Math.abs(over) <= kneeDb) {
        const k = over + kneeDb / 2;
        return inputDb + ((1 / ratio - 1) * k * k) / (2 * kneeDb);
    }
    return thresholdDb + over / ratio;
}

/** Positive gain reduction in dB for a static input level. */
export function gainReductionDb(
    inputDb: number,
    thresholdDb: number,
    ratio: number,
    kneeDb: number,
): number {
    return Math.max(0, inputDb - gainComputerDb(inputDb, thresholdDb, ratio, kneeDb));
}

export function autoMakeupDb(thresholdDb: number, ratio: number): number {
    // Restore about half of the reduction applied to a full-scale signal.
    return gainReductionDb(0, thresholdDb, ratio, 0) * 0.5;
}

export interface DynamicsSettings {
    thresholdDb: number;
    ratio: number;
    kneeDb: number;
    attackMs: number;
    releaseMs: number;
    detection: 'peak' | 'rms';
}

/**
 * Stereo-linked feed-forward detector and gain computer with branching attack/release
 * smoothing in the log domain.
 */
export class DynamicsCore {
    private settings: DynamicsSettings = {
        thresholdDb: 0,
        ratio: 1,
        kneeDb: 0,
        attackMs: 10,
        releaseMs: 100,
        detection: 'peak',
    };
    private attack = 0;
    private release = 0;
    private readonly rmsCoefficient: number;
    private meanSquare = 0;
    private reduction = 0;
    private peakReduction = 0;

    constructor(private readonly sampleRate: number) {
        this.rmsCoefficient = timeCoefficient(10, sampleRate);
    }

    configure(settings: DynamicsSettings) {
        this.settings = settings;
        this.attack = timeCoefficient(settings.attackMs, this.sampleRate);
        this.release = timeCoefficient(settings.releaseMs, this.sampleRate);
    }

    reset() {
        this.meanSquare = 0;
        this.reduction = 0;
        this.peakReduction = 0;
    }

    /** Returns the linear gain for a detector input (absolute sample values of both channels). */
    gain(left: number, right: number): number {
        const s = this.settings;
        let level: number;
        if (s.detection === 'rms') {
            const square = (left * left + right * right) / 2;
            this.meanSquare = square + (this.meanSquare - square) * this.rmsCoefficient;
            level = Math.sqrt(this.meanSquare);
        } else {
            level = Math.max(Math.abs(left), Math.abs(right));
        }
        const target = gainReductionDb(gainToDb(level), s.thresholdDb, s.ratio, s.kneeDb);
        const coefficient = target > this.reduction ? this.attack : this.release;
        this.reduction = target + (this.reduction - target) * coefficient;
        if (this.reduction < 1e-6) {
            this.reduction = 0;
        }
        if (this.reduction > this.peakReduction) {
            this.peakReduction = this.reduction;
        }
        return this.reduction === 0 ? 1 : dbToGain(-this.reduction);
    }

    get currentReduction() {
        return this.reduction;
    }

    /** Maximum reduction since the previous call, for metering. */
    takePeakReduction(): number {
        const value = this.peakReduction;
        this.peakReduction = this.reduction;
        return value;
    }
}
