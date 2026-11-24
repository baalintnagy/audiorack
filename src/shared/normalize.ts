import {
    ANALYZER_CHANNELS,
    EFFECT_TYPES,
    FFT_SIZES,
    SPECTROGRAM_PALETTES,
    EQ_BAND_TYPES,
    FILTER_MODES,
    MAX_BRANCHES,
    MAX_EQ_BANDS,
    MIN_BRANCHES,
    NOISE_PROFILE_BANDS,
    SLOPES,
    SPECS,
    createBranch,
    createId,
    defaultEqBand,
    defaultMultibandBand,
    defaultParams,
    defaultRack,
    isParallelGroup,
    type ChainItem,
    type Effect,
    type EffectParamsMap,
    type EffectType,
    type EqBand,
    type MultibandBand,
    type ParallelBranch,
    type ParallelGroup,
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

/** A learned noise profile: exactly one finite level per band, or none at all. */
function noiseProfile(raw: unknown): number[] {
    if (
        !Array.isArray(raw) ||
        raw.length !== NOISE_PROFILE_BANDS ||
        !raw.every((value) => typeof value === 'number' && Number.isFinite(value))
    ) {
        return [];
    }
    return raw.map((value: number) => Math.round(Math.min(40, Math.max(-200, value)) * 10) / 10);
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
    gate: (raw) => ({
        thresholdDb: num(raw.thresholdDb, 'gateThresholdDb'),
        rangeDb: num(raw.rangeDb, 'gateRangeDb'),
        attackMs: num(raw.attackMs, 'gateAttackMs'),
        holdMs: num(raw.holdMs, 'holdMs'),
        releaseMs: num(raw.releaseMs, 'gateReleaseMs'),
        hysteresisDb: num(raw.hysteresisDb, 'hysteresisDb'),
        sidechainHpHz: num(raw.sidechainHpHz, 'sidechainHpHz'),
    }),
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
    denoiser: (raw) => ({
        reductionDb: num(raw.reductionDb, 'denoiseReductionDb'),
        thresholdDb: num(raw.thresholdDb, 'denoiseThresholdDb'),
        smoothing: num(raw.smoothing, 'denoiseSmoothing'),
        mode: oneOf(raw.mode, ['adaptive', 'profile'] as const, 'adaptive'),
        freeze: bool(raw.freeze, false),
        listen: bool(raw.listen, false),
        learning: bool(raw.learning, false),
        profile: noiseProfile(raw.profile),
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
    spectrum: (raw) => ({
        channel: oneOf(raw.channel, ANALYZER_CHANNELS, 'mono'),
        fftSize: oneOf(raw.fftSize, FFT_SIZES, 4096),
        tilt: num(raw.tilt, 'tilt'),
        rangeDb: num(raw.rangeDb, 'analyzerRange'),
        smoothing: num(raw.smoothing, 'smoothing'),
        peakHold: bool(raw.peakHold, true),
    }),
    spectrogram: (raw) => {
        const floorDb = num(raw.floorDb, 'floorDb');
        return {
            channel: oneOf(raw.channel, ANALYZER_CHANNELS, 'mono'),
            fftSize: oneOf(raw.fftSize, FFT_SIZES, 4096),
            tilt: num(raw.tilt, 'tilt', 3),
            floorDb,
            ceilingDb: Math.max(num(raw.ceilingDb, 'spectrogramCeilingDb'), floorDb + 12),
            palette: oneOf(raw.palette, SPECTROGRAM_PALETTES, 'magma'),
        };
    },
    stereo: (raw) => ({
        display: oneOf(raw.display, ['lines', 'dots'] as const, 'dots'),
        persistence: num(raw.persistence, 'persistence'),
        autoGain: bool(raw.autoGain, true),
    }),
    loudness: (raw) => ({
        targetLufs: num(raw.targetLufs, 'targetLufs'),
        resets: Math.round(num(raw.resets, 'resets')),
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

/** Maximum number of effects in the rack, counting those inside parallel branches. */
export const MAX_CHAIN_LENGTH = 16;
export const MAX_PARALLEL_GROUPS = 4;

/** Tracks how many effects and groups may still be added while normalizing a rack. */
class Budget {
    constructor(
        private effects: number,
        private groups: number,
    ) {}

    takeEffects(effects: Effect[]): Effect[] {
        const kept = effects.slice(0, this.effects);
        this.effects -= kept.length;
        return kept;
    }

    takeGroup(): boolean {
        if (this.groups === 0) {
            return false;
        }
        this.groups--;
        return true;
    }
}

function normalizeEffects(raw: unknown): Effect[] {
    return (Array.isArray(raw) ? raw : [])
        .slice(0, MAX_CHAIN_LENGTH)
        .map(normalizeEffect)
        .filter((effect): effect is Effect => effect !== undefined);
}

function normalizeBranch(raw: unknown, budget: Budget): ParallelBranch {
    const branch = isObject(raw) ? raw : {};
    return {
        id: id(branch.id),
        gainDb: num(branch.gainDb, 'branchGainDb'),
        pan: num(branch.pan, 'pan'),
        mute: bool(branch.mute, false),
        solo: bool(branch.solo, false),
        invert: bool(branch.invert, false),
        effects: budget.takeEffects(normalizeEffects(branch.effects)),
    };
}

function normalizeGroup(raw: Loose, budget: Budget): ParallelGroup | undefined {
    if (!budget.takeGroup()) {
        return undefined;
    }
    const branches = (Array.isArray(raw.branches) ? raw.branches : [])
        .slice(0, MAX_BRANCHES)
        .map((branch) => normalizeBranch(branch, budget));
    const padding = Array.from({ length: Math.max(0, MIN_BRANCHES - branches.length) }, () =>
        createBranch(),
    );
    return {
        id: id(raw.id),
        type: 'parallel',
        bypass: bool(raw.bypass, false),
        branches: [...branches, ...padding],
    };
}

function normalizeItem(raw: unknown, budget: Budget): ChainItem | undefined {
    if (isObject(raw) && raw.type === 'parallel') {
        return normalizeGroup(raw, budget);
    }
    const effect = normalizeEffect(raw);
    return effect ? budget.takeEffects([effect])[0] : undefined;
}

/** Gives every effect, group and branch an id that is unique within the rack. */
function withUniqueIds(chain: ChainItem[]): ChainItem[] {
    const seen = new Set<string>();
    const unique = <T extends { id: string }>(item: T): T => {
        const result = seen.has(item.id) ? { ...item, id: createId() } : item;
        seen.add(result.id);
        return result;
    };
    return chain.map((item) =>
        isParallelGroup(item)
            ? unique({
                  ...item,
                  branches: item.branches.map((branch) =>
                      unique({ ...branch, effects: branch.effects.map(unique) }),
                  ),
              })
            : unique(item),
    );
}

/** Validates untrusted rack state from storage, presets or imported files. */
export function normalizeRack(raw: unknown): RackState {
    if (!isObject(raw)) {
        return defaultRack();
    }
    const budget = new Budget(MAX_CHAIN_LENGTH, MAX_PARALLEL_GROUPS);
    const chain = (Array.isArray(raw.chain) ? raw.chain : [])
        .map((item) => normalizeItem(item, budget))
        .filter((item): item is ChainItem => item !== undefined);
    return {
        version: 2,
        bypass: bool(raw.bypass, false),
        inputDb: num(raw.inputDb, 'masterDb'),
        outputDb: num(raw.outputDb, 'masterDb'),
        chain: withUniqueIds(chain),
    };
}
