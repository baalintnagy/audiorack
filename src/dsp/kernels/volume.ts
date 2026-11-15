import type { VolumeParams } from '../../shared/effects';
import { Smoother, dbToGain, panGains } from '../util';
import type { Kernel } from './kernel';

export function volumeGains(p: VolumeParams): { left: number; right: number; width: number } {
    if (p.mute) {
        return { left: 0, right: 0, width: p.width / 100 };
    }
    const gain = dbToGain(p.gainDb);
    const pan = panGains(p.pan);
    return {
        left: gain * pan.left * (p.invertLeft ? -1 : 1),
        right: gain * pan.right * (p.invertRight ? -1 : 1),
        width: p.width / 100,
    };
}

export class VolumeKernel implements Kernel<VolumeParams> {
    private readonly left: Smoother;
    private readonly right: Smoother;
    private readonly width: Smoother;

    constructor(sampleRate: number) {
        this.left = new Smoother(1, 15, sampleRate);
        this.right = new Smoother(1, 15, sampleRate);
        this.width = new Smoother(1, 15, sampleRate);
    }

    setParams(p: VolumeParams) {
        const gains = volumeGains(p);
        this.left.set(gains.left);
        this.right.set(gains.right);
        this.width.set(gains.width);
    }

    process(left: Float32Array, right: Float32Array, frames: number) {
        for (let i = 0; i < frames; i++) {
            const mid = (left[i] + right[i]) * 0.5;
            const side = (left[i] - right[i]) * 0.5 * this.width.next();
            left[i] = (mid + side) * this.left.next();
            right[i] = (mid - side) * this.right.next();
        }
    }

    reset() {}
}
