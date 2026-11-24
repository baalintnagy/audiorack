import type { GateParams } from '../../shared/effects';
import { BUTTERWORTH_Q, Biquad, biquadCoefficients } from '../biquad';
import { dbToGain, gainToDb, timeCoefficient } from '../util';
import type { Kernel } from './kernel';

/** Release time of the level detector feeding the open/close decision. */
const DETECTOR_RELEASE_MS = 20;

/** Layout of the readings produced by {@link GateKernel}. */
export const GATE_FIELDS = { reduction: 0, level: 1 };

/**
 * Noise gate: opens when the (optionally high-passed) stereo-linked level reaches the threshold,
 * stays open for the hold time once it falls below the threshold minus the hysteresis, then
 * fades to the range. Gain moves in the log domain, so attack and release sound even.
 */
export class GateKernel implements Kernel<GateParams> {
    private readonly sidechain = new Biquad();
    private sidechainEnabled = false;
    private readonly detectorRelease: number;
    private attack = 0;
    private release = 0;
    private holdSamples = 0;
    private openDb = 0;
    private closeDb = 0;
    private floorDb = -40;
    private envelope = 0;
    private open = false;
    private holdLeft = 0;
    private gainDb = 0;
    private gain = 1;
    private peakReduction = 0;
    private peakLevel = 0;

    constructor(private readonly sampleRate: number) {
        this.detectorRelease = timeCoefficient(DETECTOR_RELEASE_MS, sampleRate);
    }

    setParams(p: GateParams) {
        this.sidechainEnabled = p.sidechainHpHz > 20.5;
        this.sidechain.setCoefficients(
            biquadCoefficients('highpass', p.sidechainHpHz, BUTTERWORTH_Q, 0, this.sampleRate),
        );
        this.attack = timeCoefficient(p.attackMs, this.sampleRate);
        this.release = timeCoefficient(p.releaseMs, this.sampleRate);
        this.holdSamples = Math.round((p.holdMs / 1000) * this.sampleRate);
        this.openDb = p.thresholdDb;
        this.closeDb = p.thresholdDb - p.hysteresisDb;
        this.floorDb = -p.rangeDb;
    }

    process(left: Float32Array, right: Float32Array, frames: number) {
        for (let i = 0; i < frames; i++) {
            const l = left[i];
            const r = right[i];
            const level = this.sidechainEnabled
                ? Math.max(Math.abs(this.sidechain.tick(l, 0)), Math.abs(this.sidechain.tick(r, 1)))
                : Math.max(Math.abs(l), Math.abs(r));
            this.envelope =
                level > this.envelope
                    ? level
                    : level + (this.envelope - level) * this.detectorRelease;
            if (this.envelope > this.peakLevel) {
                this.peakLevel = this.envelope;
            }
            const levelDb = gainToDb(this.envelope);
            if (levelDb >= this.openDb) {
                this.open = true;
                this.holdLeft = this.holdSamples;
            } else if (this.open && levelDb < this.closeDb) {
                if (this.holdLeft > 0) {
                    this.holdLeft--;
                } else {
                    this.open = false;
                }
            }
            const target = this.open ? 0 : this.floorDb;
            if (target !== this.gainDb) {
                const coefficient = target > this.gainDb ? this.attack : this.release;
                this.gainDb = target + (this.gainDb - target) * coefficient;
                if (Math.abs(this.gainDb - target) < 1e-4) {
                    this.gainDb = target;
                }
                this.gain = dbToGain(this.gainDb);
            }
            if (-this.gainDb > this.peakReduction) {
                this.peakReduction = -this.gainDb;
            }
            left[i] = l * this.gain;
            right[i] = r * this.gain;
        }
    }

    reset() {
        this.sidechain.reset();
        this.envelope = 0;
        this.open = false;
        this.holdLeft = 0;
        this.gainDb = this.floorDb;
        this.gain = dbToGain(this.gainDb);
    }

    /** Peak reduction in dB and peak detector level (linear) since the previous call. */
    takeMeters() {
        const readings = [this.peakReduction, this.peakLevel];
        this.peakReduction = -this.gainDb;
        this.peakLevel = this.envelope;
        return readings.map((value) => Math.round(value * 10000) / 10000);
    }
}
