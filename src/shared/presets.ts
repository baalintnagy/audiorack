import {
    createBranch,
    createEffect,
    createParallelGroup,
    defaultEqBand,
    defaultRack,
    type ChainItem,
    type Effect,
    type EffectParamsMap,
    type EffectType,
    type RackState,
} from './effects';

function effect<T extends EffectType>(type: T, params: Partial<EffectParamsMap[T]> = {}): Effect {
    const base = createEffect(type);
    return { ...base, params: { ...base.params, ...params } } as Effect;
}

function rack(chain: ChainItem[], partial: Partial<RackState> = {}): RackState {
    return { ...defaultRack(), chain, ...partial };
}

/** The longest name a saved preset can have. */
export const MAX_PRESET_NAME = 60;

interface FactoryPreset {
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
        name: 'Parallel Punch',
        description: 'Parallel compression: a crushed copy blended under the dry signal',
        create: () =>
            rack([
                effect('eq', {
                    bands: [defaultEqBand({ type: 'lowcut', frequency: 30, q: 0.71, slope: 24 })],
                }),
                createParallelGroup([
                    createBranch(),
                    {
                        ...createBranch([
                            effect('compressor', {
                                thresholdDb: -40,
                                ratio: 10,
                                attackMs: 2,
                                releaseMs: 120,
                                kneeDb: 3,
                                autoMakeup: true,
                            }),
                            effect('eq', {
                                bands: [
                                    defaultEqBand({
                                        type: 'highshelf',
                                        frequency: 6000,
                                        gainDb: 3,
                                    }),
                                ],
                            }),
                        ]),
                        gainDb: -8,
                    },
                ]),
                effect('limiter', { ceilingDb: -1 }),
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
                effect('utility', { width: 40, gainDb: 4 }),
                effect('limiter', { ceilingDb: -1 }),
            ]),
    },
    {
        name: 'Clean',
        description: 'Empty rack',
        create: () => rack([]),
    },
];

/**
 * A free name for saving the rack as a preset: `base` with the next unused counter when the
 * rack came from a preset (a counter it already ends with is replaced), otherwise "Preset" and
 * a counter. Names compare without regard to case.
 */
export function nextPresetName(base: string | undefined, taken: string[]): string {
    const used = new Set(taken.map((name) => name.trim().toLowerCase()));
    const stem = base?.trim().replace(/\s+\d+$/, '') || 'Preset';
    // Shorten the stem rather than the counter to stay within the preset name limit.
    const named = (counter: number) =>
        `${stem.slice(0, MAX_PRESET_NAME - 1 - String(counter).length).trimEnd()} ${counter}`;
    // A name from a preset already counts as the first one.
    let counter = base?.trim() ? 2 : 1;
    while (used.has(named(counter).toLowerCase())) {
        counter++;
    }
    return named(counter);
}

/**
 * Moves the item at `from` so it lands at `to`, an insertion point in the original list
 * (0 before the first item, `list.length` after the last). Returns the list itself when nothing
 * moves.
 */
export function moveListItem<T>(list: T[], from: number, to: number): T[] {
    if (from < 0 || from >= list.length) {
        return list;
    }
    const target = Math.min(Math.max(to, 0), list.length);
    // Dropping an item right before or after itself leaves it where it is.
    if (target === from || target === from + 1) {
        return list;
    }
    const rest = list.filter((_, index) => index !== from);
    const at = target > from ? target - 1 : target;
    return [...rest.slice(0, at), list[from], ...rest.slice(at)];
}

/** Saves `preset` under its name: in place of a preset of the same name, else last. */
export function upsertPreset<T extends { name: string }>(presets: T[], preset: T): T[] {
    const index = presets.findIndex((item) => item.name === preset.name);
    return index < 0
        ? [...presets, preset]
        : presets.map((item, position) => (position === index ? preset : item));
}
