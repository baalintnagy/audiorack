import {
    EFFECT_TYPES,
    EQ_BAND_TYPES,
    FILTER_MODES,
    MAX_EQ_BANDS,
    SLOPES,
    SPECS,
    createId,
    defaultEqBand,
    defaultMultibandBand,
    defaultParams,
    defaultRack,
    type Effect,
    type EffectParamsMap,
    type EffectType,
    type EqBand,
    type MultibandBand,
    type RackState,
    type SpecKey,
} from './effects';

type Loose = Record<string, unknown>;

function isObject(value: unknown): value is Loose {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown, spec: SpecKey, fallback?: number): number {
    const { min, max, default: initial } = SPECS[spec];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback ?? initial;
    }
    return Math.min(max, Math.max(min, value));
}

function bool(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function oneOf<T extends string | number>(value: unknown, options: readonly T[], fallback: T): T {
    return options.includes(value as T) ? (value as T) : fallback;
}

function id(value: unknown): string {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(value) ? value : createId();
}

function normalizeBand(raw: unknown): EqBand {
    const band = isObject(raw) ? raw : {};
    const base = defaultEqBand();
    return {
        id: id(band.id),
        enabled: bool(band.enabled, true),
        type: oneOf(band.type, EQ_BAND_TYPES, base.type),
        frequency: num(band.frequency, 'frequency'),
        gainDb: num(band.gainDb, 'gainDb'),
        q: num(band.q, 'q'),
        slope: oneOf(band.slope, SLOPES, 24),
    };
}

function normalizeMultibandBand(raw: unknown): MultibandBand {
    const band = isObject(raw) ? raw : {};
    const base = defaultMultibandBand();
    return {
        thresholdDb: num(band.thresholdDb, 'thresholdDb', base.thresholdDb),
        ratio: num(band.ratio, 'ratio', base.ratio),
        attackMs: num(band.attackMs, 'attackMs', base.attackMs),
        releaseMs: num(band.releaseMs, 'releaseMs', base.releaseMs),
        makeupDb: num(band.makeupDb, 'makeupDb', base.makeupDb),
        solo: bool(band.solo, false),
        bypass: bool(band.bypass, false),
        mute: bool(band.mute, false),
    };
}

const normalizers: { [T in EffectType]: (raw: Loose) => EffectParamsMap[T] } = {
    eq: (raw) => ({
        bands: Array.isArray(raw.bands) ? raw.bands.slice(0, MAX_EQ_BANDS).map(normalizeBand) : [],
        outputDb: num(raw.outputDb, 'outputDb'),
    }),
    compressor: (raw) => {
        const base = defaultParams('compressor');
        return {
            thresholdDb: num(raw.thresholdDb, 'thresholdDb', base.thresholdDb),
            ratio: num(raw.ratio, 'ratio', base.ratio),
            kneeDb: num(raw.kneeDb, 'kneeDb', base.kneeDb),
            attackMs: num(raw.attackMs, 'attackMs', base.attackMs),
            releaseMs: num(raw.releaseMs, 'releaseMs', base.releaseMs),
            makeupDb: num(raw.makeupDb, 'makeupDb', base.makeupDb),
            autoMakeup: bool(raw.autoMakeup, base.autoMakeup),
            mix: num(raw.mix, 'mix'),
            detection: oneOf(raw.detection, ['peak', 'rms'] as const, base.detection),
            sidechainHpHz: num(raw.sidechainHpHz, 'sidechainHpHz'),
        };
    },
    limiter: (raw) => ({
        inputDb: num(raw.inputDb, 'inputDb'),
        ceilingDb: num(raw.ceilingDb, 'ceilingDb'),
        releaseMs: num(raw.releaseMs, 'limiterReleaseMs'),
        lookaheadMs: num(raw.lookaheadMs, 'lookaheadMs'),
    }),
    multiband: (raw) => {
        const base = defaultParams('multiband');
        const crossovers = (
            Array.isArray(raw.crossovers) && raw.crossovers.length >= 1
                ? raw.crossovers.slice(0, 3)
                : base.crossovers
        )
            .map((value) => num(value, 'crossover'))
            .sort((a, b) => a - b);
        const rawBands = Array.isArray(raw.bands) ? raw.bands : [];
        return {
            crossovers,
            bands: Array.from({ length: crossovers.length + 1 }, (_, index) =>
                normalizeMultibandBand(rawBands[index]),
            ),
            kneeDb: num(raw.kneeDb, 'kneeDb', base.kneeDb),
            outputDb: num(raw.outputDb, 'outputDb'),
        };
    },
    filter: (raw) => ({
        mode: oneOf(raw.mode, FILTER_MODES, 'lowpass'),
        cutoff: num(raw.cutoff, 'cutoff'),
        q: num(raw.q, 'filterQ'),
        slope: oneOf(raw.slope, SLOPES, 24),
        driveDb: num(raw.driveDb, 'driveDb'),
        lfoRate: num(raw.lfoRate, 'lfoRate'),
        lfoDepth: num(raw.lfoDepth, 'lfoDepth'),
        lfoShape: oneOf(raw.lfoShape, ['sine', 'triangle'] as const, 'sine'),
        mix: num(raw.mix, 'mix'),
    }),
    deesser: (raw) => ({
        frequency: num(raw.frequency, 'deessFrequency'),
        thresholdDb: num(raw.thresholdDb, 'deessThresholdDb'),
        rangeDb: num(raw.rangeDb, 'rangeDb'),
        releaseMs: num(raw.releaseMs, 'deessReleaseMs'),
        mode: oneOf(raw.mode, ['split', 'wide'] as const, 'split'),
        listen: bool(raw.listen, false),
    }),
    volume: (raw) => ({
        gainDb: num(raw.gainDb, 'volumeDb'),
        pan: num(raw.pan, 'pan'),
        width: num(raw.width, 'width'),
        invertLeft: bool(raw.invertLeft, false),
        invertRight: bool(raw.invertRight, false),
        mute: bool(raw.mute, false),
    }),
    bassboost: (raw) => ({
        boostDb: num(raw.boostDb, 'boostDb'),
        frequency: num(raw.frequency, 'bassFrequency'),
        harmonics: num(raw.harmonics, 'harmonics'),
        tighten: bool(raw.tighten, true),
        monoBass: bool(raw.monoBass, false),
        outputDb: num(raw.outputDb, 'outputDb'),
    }),
};

export function normalizeEffect(raw: unknown): Effect | undefined {
    if (!isObject(raw) || !EFFECT_TYPES.includes(raw.type as EffectType)) {
        return undefined;
    }
    const type = raw.type as EffectType;
    const params = normalizers[type](isObject(raw.params) ? raw.params : {});
    return { id: id(raw.id), type, bypass: bool(raw.bypass, false), params } as Effect;
}

export const MAX_CHAIN_LENGTH = 16;

/** Validates untrusted rack state from storage, presets or imported files. */
export function normalizeRack(raw: unknown): RackState {
    if (!isObject(raw)) {
        return defaultRack();
    }
    const chain = (Array.isArray(raw.chain) ? raw.chain : [])
        .slice(0, MAX_CHAIN_LENGTH)
        .map(normalizeEffect)
        .filter((effect): effect is Effect => effect !== undefined);
    const seen = new Set<string>();
    return {
        version: 1,
        bypass: bool(raw.bypass, false),
        inputDb: num(raw.inputDb, 'masterDb'),
        outputDb: num(raw.outputDb, 'masterDb'),
        chain: chain.map((effect) => {
            const unique = seen.has(effect.id) ? { ...effect, id: createId() } : effect;
            seen.add(unique.id);
            return unique;
        }),
    };
}
