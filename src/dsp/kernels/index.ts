import type { EffectParamsMap, EffectType } from '../../shared/effects';
import { SpectrogramKernel, SpectrumKernel, StereoKernel } from './analyzers';
import { BassBoostKernel } from './bassboost';
import { CompressorKernel } from './compressor';
import { DeesserKernel } from './deesser';
import { EqKernel } from './eq';
import { FilterKernel } from './filter';
import type { Kernel } from './kernel';
import { LimiterKernel } from './limiter';
import { MultibandKernel } from './multiband';
import { VolumeKernel } from './volume';

type KernelFactories = {
    [T in EffectType]: new (sampleRate: number) => Kernel<EffectParamsMap[T]>;
};

export const KERNELS: KernelFactories = {
    eq: EqKernel,
    compressor: CompressorKernel,
    limiter: LimiterKernel,
    multiband: MultibandKernel,
    filter: FilterKernel,
    deesser: DeesserKernel,
    volume: VolumeKernel,
    bassboost: BassBoostKernel,
    spectrum: SpectrumKernel,
    spectrogram: SpectrogramKernel,
    stereo: StereoKernel,
};

export function createKernel<T extends EffectType>(type: T, sampleRate: number): Kernel<unknown> {
    const Factory = KERNELS[type] as new (sampleRate: number) => Kernel<unknown>;
    return new Factory(sampleRate);
}

export type { Kernel } from './kernel';
