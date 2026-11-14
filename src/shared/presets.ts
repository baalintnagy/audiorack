import {
    createEffect,
    defaultEqBand,
    defaultRack,
    type Effect,
    type EffectParamsMap,
    type EffectType,
    type RackState,
} from './effects';

function effect<T extends EffectType>(type: T, params: Partial<EffectParamsMap[T]> = {}): Effect {
    const base = createEffect(type);
    return { ...base, params: { ...base.params, ...params } } as Effect;
}

function rack(chain: Effect[], partial: Partial<RackState> = {}): RackState {
    return { ...defaultRack(), chain, ...partial };
}

export interface FactoryPreset {
    name: string;
    description: string;
    create: () => RackState;
}

export const FACTORY_PRESETS: FactoryPreset[] = [
    {
        name: 'Default',
        description: 'EQ, compressor and a safety limiter',
        create: defaultRack,
    },
    {
        name: 'Night Mode',
        description: 'Evens out loud explosions and quiet dialogue',
        create: () =>
            rack([
                effect('eq', {
                    bands: [
                        defaultEqBand({ type: 'lowcut', frequency: 60, q: 0.71, slope: 24 }),
                        defaultEqBand({ type: 'lowshelf', frequency: 150, gainDb: -3, q: 0.71 }),
                        defaultEqBand({ frequency: 2500, gainDb: 2, q: 0.8 }),
                    ],
                }),
                effect('multiband', {}),
                effect('compressor', {
                    thresholdDb: -30,
                    ratio: 6,
                    attackMs: 5,
                    releaseMs: 300,
                    kneeDb: 10,
                    detection: 'rms',
                }),
                effect('limiter', { inputDb: 3, ceilingDb: -1 }),
            ]),
    },
    {
        name: 'Voice Clarity',
        description: 'Podcasts and talks: rumble cut, presence lift, de-essing',
        create: () =>
            rack([
                effect('eq', {
                    bands: [
                        defaultEqBand({ type: 'lowcut', frequency: 90, q: 0.71, slope: 24 }),
                        defaultEqBand({ frequency: 250, gainDb: -2.5, q: 1.2 }),
                        defaultEqBand({ frequency: 3200, gainDb: 3, q: 0.9 }),
                        defaultEqBand({
                            type: 'highshelf',
                            frequency: 10000,
                            gainDb: 1.5,
                            q: 0.71,
                        }),
                    ],
                }),
                effect('deesser', { thresholdDb: -32, rangeDb: 8 }),
                effect('compressor', { thresholdDb: -24, ratio: 3, attackMs: 8, releaseMs: 150 }),
                effect('limiter', { ceilingDb: -1 }),
            ]),
    },
    {
        name: 'Bass Head',
        description: 'Deep low end that still translates to laptop speakers',
        create: () =>
            rack([
                effect('bassboost', { boostDb: 8, frequency: 70, harmonics: 45 }),
                effect('compressor', {
                    thresholdDb: -16,
                    ratio: 2.5,
                    attackMs: 20,
                    releaseMs: 180,
                    sidechainHpHz: 60,
                }),
                effect('limiter', { ceilingDb: -0.8, releaseMs: 60 }),
            ]),
    },
    {
        name: 'Loudness',
        description: 'Multiband glue and limiting for a dense, loud sound',
        create: () =>
            rack([
                effect('multiband', {}),
                effect('limiter', { inputDb: 6, ceilingDb: -0.5, releaseMs: 50 }),
            ]),
    },
    {
        name: 'Lo-Fi Radio',
        description: 'Band-limited, driven and slowly wobbling',
        create: () =>
            rack([
                effect('filter', {
                    mode: 'bandpass',
                    cutoff: 1400,
                    q: 0.6,
                    slope: 24,
                    driveDb: 9,
                    lfoRate: 0.15,
                    lfoDepth: 0.4,
                }),
                effect('volume', { width: 40, gainDb: 4 }),
                effect('limiter', { ceilingDb: -1 }),
            ]),
    },
    {
        name: 'Clean',
        description: 'Empty rack',
        create: () => rack([]),
    },
];
