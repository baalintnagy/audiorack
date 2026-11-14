import type { MultibandParams } from '../../shared/effects';
import { MultibandSplitter } from '../crossover';
import { DynamicsCore } from '../dynamics';
import { Smoother, dbToGain, ensureCapacity } from '../util';
import type { Kernel } from './kernel';

interface BandState {
    core: DynamicsCore;
    makeup: Smoother;
    level: Smoother;
    active: boolean;
}

export class MultibandKernel implements Kernel<MultibandParams> {
    private readonly splitter = new MultibandSplitter();
    private bandsLeft: Float32Array[] = [];
    private bandsRight: Float32Array[] = [];
    private states: BandState[] = [];
    private readonly output: Smoother;

    constructor(private readonly sampleRate: number) {
        this.output = new Smoother(1, 20, sampleRate);
    }

    setParams(p: MultibandParams) {
        this.splitter.setCrossovers(p.crossovers, this.sampleRate);
        const count = p.crossovers.length + 1;
        while (this.states.length < count) {
            this.states.push({
                core: new DynamicsCore(this.sampleRate),
                makeup: new Smoother(1, 20, this.sampleRate),
                level: new Smoother(1, 10, this.sampleRate),
                active: true,
            });
            this.bandsLeft.push(new Float32Array(128));
            this.bandsRight.push(new Float32Array(128));
        }
        this.states.length = count;
        this.bandsLeft.length = count;
        this.bandsRight.length = count;
        const soloed = p.bands.some((band) => band.solo);
        p.bands.forEach((band, index) => {
            const state = this.states[index];
            state.core.configure({ ...band, kneeDb: p.kneeDb, detection: 'peak' });
            state.active = !band.bypass;
            state.makeup.set(band.bypass ? 1 : dbToGain(band.makeupDb));
            state.level.set(band.mute || (soloed && !band.solo) ? 0 : 1);
        });
        this.output.set(dbToGain(p.outputDb));
    }

    process(left: Float32Array, right: Float32Array, frames: number) {
        const count = this.states.length;
        for (let band = 0; band < count; band++) {
            this.bandsLeft[band] = ensureCapacity(this.bandsLeft[band], frames);
            this.bandsRight[band] = ensureCapacity(this.bandsRight[band], frames);
        }
        this.bandsLeft[0].set(left.subarray(0, frames));
        this.bandsRight[0].set(right.subarray(0, frames));
        this.splitter.split(this.bandsLeft, frames, 0);
        this.splitter.split(this.bandsRight, frames, 1);
        for (let i = 0; i < frames; i++) {
            let l = 0;
            let r = 0;
            for (let band = 0; band < count; band++) {
                const state = this.states[band];
                const bl = this.bandsLeft[band][i];
                const br = this.bandsRight[band][i];
                const gain =
                    (state.active ? state.core.gain(bl, br) : 1) *
                    state.makeup.next() *
                    state.level.next();
                l += bl * gain;
                r += br * gain;
            }
            const output = this.output.next();
            left[i] = l * output;
            right[i] = r * output;
        }
    }

    reset() {
        this.splitter.reset();
        this.states.forEach((state) => state.core.reset());
    }

    takeMeters() {
        return this.states.map((state) => state.core.takePeakReduction());
    }
}
