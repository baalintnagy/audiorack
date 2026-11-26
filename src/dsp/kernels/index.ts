import type { EffectParamsMap, EffectType } from '../../shared/effects';
import { SpectrogramKernel, SpectrumKernel, StereoKernel } from './analyzers';
import { BassBoostKernel } from './bassboost';
import { CompressorKernel } from './compressor';
import { DeesserKernel } from './deesser';
import { DenoiserKernel } from './denoiser';
import { EqKernel } from './eq';
import { FilterKernel } from './filter';
import { GateKernel } from './gate';
import type { Kernel } from './kernel';
import { LevelerKernel } from './leveler';
import { LimiterKernel } from './limiter';
import { LoudnessKernel } from './loudness';
import { MultibandKernel } from './multiband';
import { SaturatorKernel } from './saturator';
import { UtilityKernel } from './utility';

type KernelFactories = {
    [T in EffectType]: new (sampleRate: number) => Kernel<EffectParamsMap[T]>;
};

export const KERNELS: KernelFactories = {
    eq: EqKernel,
    compressor: CompressorKernel,
    limiter: LimiterKernel,
    leveler: LevelerKernel,
    multiband: MultibandKernel,
    saturator: SaturatorKernel,
    gate: GateKernel,
    filter: FilterKernel,
    deesser: DeesserKernel,
    denoiser: DenoiserKernel,
    utility: UtilityKernel,
    bassboost: BassBoostKernel,
    spectrum: SpectrumKernel,
    spectrogram: SpectrogramKernel,
    stereo: StereoKernel,
    loudness: LoudnessKernel,
};

export function createKernel<T extends EffectType>(type: T, sampleRate: number): Kernel<unknown> {
    const Factory = KERNELS[type] as new (sampleRate: number) => Kernel<unknown>;
    return new Factory(sampleRate);
}

export type { Kernel } from './kernel';
