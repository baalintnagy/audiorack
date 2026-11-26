export type EffectType =
    | 'eq'
    | 'compressor'
    | 'limiter'
    | 'leveler'
    | 'multiband'
    | 'saturator'
    | 'gate'
    | 'filter'
    | 'deesser'
    | 'denoiser'
    | 'utility'
    | 'bassboost'
    | 'spectrum'
    | 'spectrogram'
    | 'stereo'
    | 'loudness';

export type AnalyzerChannel = 'mono' | 'left' | 'right' | 'mid' | 'side';

export const ANALYZER_CHANNELS: AnalyzerChannel[] = ['mono', 'left', 'right', 'mid', 'side'];

export const FFT_SIZES = [2048, 4096, 8192] as const;

export const SPECTROGRAM_PALETTES = ['magma', 'ice', 'mono'] as const;

export type EqBandType =
    'bell' | 'lowshelf' | 'highshelf' | 'lowcut' | 'highcut' | 'notch' | 'bandpass';

export const EQ_BAND_TYPES: EqBandType[] = [
    'bell',
    'lowshelf',
    'highshelf',
    'lowcut',
    'highcut',
    'notch',
    'bandpass',
];

export const SLOPES = [12, 24, 36, 48] as const;

export interface EqBand {
    id: string;
    enabled: boolean;
    type: EqBandType;
    frequency: number;
    gainDb: number;
    q: number;
    slope: number;
}

export interface EqParams {
    bands: EqBand[];
    outputDb: number;
}

export interface CompressorParams {
    thresholdDb: number;
    ratio: number;
    kneeDb: number;
    attackMs: number;
    releaseMs: number;
    makeupDb: number;
    autoMakeup: boolean;
    mix: number;
    detection: 'peak' | 'rms';
    sidechainHpHz: number;
}

export interface LimiterParams {
    inputDb: number;
    ceilingDb: number;
    releaseMs: number;
    lookaheadMs: number;
}

export interface MultibandBand {
    thresholdDb: number;
    ratio: number;
    attackMs: number;
    releaseMs: number;
    makeupDb: number;
    solo: boolean;
    bypass: boolean;
    mute: boolean;
}

export interface MultibandParams {
    crossovers: number[];
    bands: MultibandBand[];
    kneeDb: number;
    outputDb: number;
}

export type SaturationStyle = 'tube' | 'tape' | 'soft' | 'hard' | 'fold' | 'rectify';

export const SATURATION_STYLES: SaturationStyle[] = [
    'tube',
    'tape',
    'soft',
    'hard',
    'fold',
    'rectify',
];

export const OVERSAMPLING_FACTORS = [1, 2, 4] as const;

export type OversamplingFactor = (typeof OVERSAMPLING_FACTORS)[number];

export const MAX_SATURATOR_BANDS = 4;

export interface SaturatorBand {
    style: SaturationStyle;
    driveDb: number;
    /** -100 to 100: how far the drive follows the band's level (negative: falls with it). */
    dynamics: number;
    /** Tilt of the saturated band in dB, positive brightens. */
    tone: number;
    mix: number;
    levelDb: number;
    solo: boolean;
    mute: boolean;
    bypass: boolean;
}

export interface SaturatorParams {
    /** Zero to three ascending crossover frequencies, for one to four bands. */
    crossovers: number[];
    bands: SaturatorBand[];
    oversampling: OversamplingFactor;
    mix: number;
    outputDb: number;
}

export interface GateParams {
    thresholdDb: number;
    /** How far the closed gate attenuates. */
    rangeDb: number;
    attackMs: number;
    holdMs: number;
    releaseMs: number;
    /** The gate closes this far below the threshold, so it does not chatter. */
    hysteresisDb: number;
    sidechainHpHz: number;
}

export type FilterMode = 'lowpass' | 'highpass' | 'bandpass' | 'notch';

export const FILTER_MODES: FilterMode[] = ['lowpass', 'highpass', 'bandpass', 'notch'];

export interface FilterParams {
    mode: FilterMode;
    cutoff: number;
    q: number;
    slope: number;
    driveDb: number;
    lfoRate: number;
    lfoDepth: number;
    lfoShape: 'sine' | 'triangle';
    mix: number;
}

export interface DeesserParams {
    frequency: number;
    thresholdDb: number;
    rangeDb: number;
    releaseMs: number;
    mode: 'split' | 'wide';
    listen: boolean;
}

/** Number of log-spaced bands in a learned noise profile. */
export const NOISE_PROFILE_BANDS = 128;

export interface DenoiserParams {
    /** Largest attenuation applied to noise. */
    reductionDb: number;
    /** How far above the noise floor a bin has to be to pass untouched. */
    thresholdDb: number;
    /** Time smoothing of the gains, against "musical noise" artifacts. */
    smoothing: number;
    /**
     * `adaptive` follows the noise floor of the audio; `profile` removes the learned noise
     * profile instead (and falls back to adaptive while there is none).
     */
    mode: 'adaptive' | 'profile';
    /** Stops adapting the noise floor (adaptive mode). */
    freeze: boolean;
    /** Outputs only what is removed. */
    listen: boolean;
    /** Averaging the spectrum of the audio into a new noise profile. */
    learning: boolean;
    /**
     * Learned noise power per band in dB, {@link NOISE_PROFILE_BANDS} log-spaced bands from 20 Hz
     * to 20 kHz, or empty.
     */
    profile: number[];
}

/** Rides the gain towards a loudness target; see the leveler kernel. */
export interface LevelerParams {
    targetLufs: number;
    /**
     * Fast: reacts within milliseconds, like a compressor that also lifts; otherwise it rides
     * the level slowly, over seconds.
     */
    fast: boolean;
    /** Seconds the slow leveler takes to close most of the gap to the target; down is faster. */
    responseS: number;
    /** The same for the fast leveler, in milliseconds. */
    fastResponseMs: number;
    maxBoostDb: number;
    maxCutDb: number;
    /** Below this momentary loudness the gain holds still. */
    gateLufs: number;
}

export interface UtilityParams {
    gainDb: number;
    pan: number;
    width: number;
    invertLeft: boolean;
    invertRight: boolean;
    mute: boolean;
}

export interface BassBoostParams {
    boostDb: number;
    frequency: number;
    harmonics: number;
    tighten: boolean;
    monoBass: boolean;
    outputDb: number;
}

export interface SpectrumParams {
    channel: AnalyzerChannel;
    fftSize: number;
    tilt: number;
    rangeDb: number;
    smoothing: number;
    peakHold: boolean;
}

export interface SpectrogramParams {
    channel: AnalyzerChannel;
    fftSize: number;
    tilt: number;
    floorDb: number;
    ceilingDb: number;
    palette: (typeof SPECTROGRAM_PALETTES)[number];
}

export interface StereoParams {
    display: 'lines' | 'dots';
    persistence: number;
    autoGain: boolean;
}

export interface LoudnessParams {
    targetLufs: number;
    /** Incremented to restart the integrated measurement. */
    resets: number;
}

export interface EffectParamsMap {
    eq: EqParams;
    compressor: CompressorParams;
    limiter: LimiterParams;
    multiband: MultibandParams;
    saturator: SaturatorParams;
    gate: GateParams;
    filter: FilterParams;
    deesser: DeesserParams;
    denoiser: DenoiserParams;
    leveler: LevelerParams;
    utility: UtilityParams;
    bassboost: BassBoostParams;
    spectrum: SpectrumParams;
    spectrogram: SpectrogramParams;
    stereo: StereoParams;
    loudness: LoudnessParams;
}

export type EffectOf<T extends EffectType> = {
    id: string;
    type: T;
    bypass: boolean;
    /** Accent color chosen by the user (`#rrggbb`); the type's own color when absent. */
    color?: string;
    params: EffectParamsMap[T];
};

export type Effect = { [T in EffectType]: EffectOf<T> }[EffectType];

/** One signal path of a parallel group: a serial chain of effects with its own level. */
export interface ParallelBranch {
    id: string;
    gainDb: number;
    /** -100 (left) to 100 (right), constant power. */
    pan: number;
    mute: boolean;
    /** While any branch is soloed, only soloed branches are heard. */
    solo: boolean;
    /** Inverts the polarity of the branch. */
    invert: boolean;
    /** An empty branch passes the dry signal. */
    effects: Effect[];
}

/** Splits the signal into branches that are processed side by side and summed. */
export interface ParallelGroup {
    id: string;
    type: 'parallel';
    bypass: boolean;
    /** Accent color chosen by the user (`#rrggbb`); the group's default when absent. */
    color?: string;
    branches: ParallelBranch[];
}

export type ChainItem = Effect | ParallelGroup;

export interface RackState {
    version: 2;
    bypass: boolean;
    inputDb: number;
    outputDb: number;
    chain: ChainItem[];
}

export function isParallelGroup(item: ChainItem): item is ParallelGroup {
    return item.type === 'parallel';
}

/** Numeric parameter metadata shared by knobs, validation and the DSP. */
export interface NumberSpec {
    min: number;
    max: number;
    default: number;
    unit: string;
    scale?: 'linear' | 'log';
    label: string;
    decimals?: number;
}

export const SPECS = {
    frequency: { label: 'Freq', min: 20, max: 20000, default: 1000, unit: 'Hz', scale: 'log' },
    gainDb: { label: 'Gain', min: -30, max: 30, default: 0, unit: 'dB', decimals: 1 },
    q: { label: 'Q', min: 0.1, max: 18, default: 1, unit: '', scale: 'log', decimals: 2 },
    outputDb: { label: 'Output', min: -24, max: 24, default: 0, unit: 'dB', decimals: 1 },
    thresholdDb: { label: 'Threshold', min: -60, max: 0, default: -18, unit: 'dB', decimals: 1 },
    ratio: { label: 'Ratio', min: 1, max: 20, default: 4, unit: ':1', scale: 'log', decimals: 1 },
    kneeDb: { label: 'Knee', min: 0, max: 24, default: 6, unit: 'dB', decimals: 1 },
    attackMs: {
        label: 'Attack',
        min: 0.1,
        max: 250,
        default: 10,
        unit: 'ms',
        scale: 'log',
        decimals: 1,
    },
    releaseMs: { label: 'Release', min: 5, max: 2500, default: 120, unit: 'ms', scale: 'log' },
    makeupDb: { label: 'Makeup', min: -12, max: 30, default: 0, unit: 'dB', decimals: 1 },
    mix: { label: 'Mix', min: 0, max: 100, default: 100, unit: '%' },
    sidechainHpHz: {
        label: 'SC HPF',
        min: 20,
        max: 500,
        default: 20,
        unit: 'Hz',
        scale: 'log',
    },
    inputDb: { label: 'Gain', min: -12, max: 24, default: 0, unit: 'dB', decimals: 1 },
    ceilingDb: { label: 'Ceiling', min: -12, max: 0, default: -1, unit: 'dB', decimals: 1 },
    limiterReleaseMs: {
        label: 'Release',
        min: 1,
        max: 1000,
        default: 80,
        unit: 'ms',
        scale: 'log',
    },
    lookaheadMs: {
        label: 'Lookahead',
        min: 0.5,
        max: 10,
        default: 3,
        unit: 'ms',
        decimals: 1,
    },
    crossover: { label: 'Crossover', min: 40, max: 16000, default: 1000, unit: 'Hz', scale: 'log' },
    cutoff: { label: 'Cutoff', min: 20, max: 20000, default: 2000, unit: 'Hz', scale: 'log' },
    filterQ: {
        label: 'Resonance',
        min: 0.3,
        max: 12,
        default: 0.71,
        unit: '',
        scale: 'log',
        decimals: 2,
    },
    driveDb: { label: 'Drive', min: 0, max: 24, default: 0, unit: 'dB', decimals: 1 },
    lfoRate: {
        label: 'LFO Rate',
        min: 0.05,
        max: 20,
        default: 0.5,
        unit: 'Hz',
        scale: 'log',
        decimals: 2,
    },
    lfoDepth: { label: 'LFO Depth', min: 0, max: 4, default: 0, unit: 'oct', decimals: 2 },
    deessFrequency: {
        label: 'Freq',
        min: 2000,
        max: 16000,
        default: 6500,
        unit: 'Hz',
        scale: 'log',
    },
    deessThresholdDb: {
        label: 'Threshold',
        min: -60,
        max: 0,
        default: -30,
        unit: 'dB',
        decimals: 1,
    },
    rangeDb: { label: 'Range', min: 0, max: 24, default: 10, unit: 'dB', decimals: 1 },
    deessReleaseMs: {
        label: 'Release',
        min: 10,
        max: 500,
        default: 60,
        unit: 'ms',
        scale: 'log',
    },
    levelerTargetLufs: {
        label: 'Target',
        min: -36,
        max: -10,
        default: -18,
        unit: 'LUFS',
        decimals: 1,
    },
    levelerResponse: {
        label: 'Response',
        min: 0.5,
        max: 30,
        default: 4,
        unit: 's',
        scale: 'log',
        decimals: 1,
    },
    levelerFastResponse: {
        label: 'Response',
        min: 5,
        max: 1000,
        default: 100,
        unit: 'ms',
        scale: 'log',
    },
    maxBoostDb: { label: 'Boost', min: 0, max: 24, default: 12, unit: 'dB', decimals: 1 },
    maxCutDb: { label: 'Cut', min: 0, max: 24, default: 12, unit: 'dB', decimals: 1 },
    levelerGateLufs: { label: 'Gate', min: -70, max: -30, default: -50, unit: 'LUFS' },
    utilityGainDb: { label: 'Gain', min: -60, max: 24, default: 0, unit: 'dB', decimals: 1 },
    pan: { label: 'Pan', min: -100, max: 100, default: 0, unit: '' },
    width: { label: 'Width', min: 0, max: 200, default: 100, unit: '%' },
    boostDb: { label: 'Boost', min: 0, max: 18, default: 6, unit: 'dB', decimals: 1 },
    bassFrequency: {
        label: 'Freq',
        min: 30,
        max: 250,
        default: 80,
        unit: 'Hz',
        scale: 'log',
    },
    harmonics: { label: 'Harmonics', min: 0, max: 100, default: 25, unit: '%' },
    masterDb: { label: 'Gain', min: -24, max: 24, default: 0, unit: 'dB', decimals: 1 },
    branchGainDb: { label: 'Level', min: -48, max: 12, default: 0, unit: 'dB', decimals: 1 },
    tilt: { label: 'Tilt', min: 0, max: 6, default: 4.5, unit: 'dB/oct', decimals: 1 },
    smoothing: { label: 'Smoothing', min: 0, max: 100, default: 60, unit: '%' },
    analyzerRange: { label: 'Range', min: 48, max: 144, default: 96, unit: 'dB' },
    floorDb: { label: 'Floor', min: -140, max: -40, default: -100, unit: 'dB' },
    spectrogramCeilingDb: { label: 'Ceiling', min: -40, max: 0, default: -10, unit: 'dB' },
    persistence: { label: 'Persistence', min: 0, max: 100, default: 60, unit: '%' },
    gateThresholdDb: {
        label: 'Threshold',
        min: -80,
        max: 0,
        default: -45,
        unit: 'dB',
        decimals: 1,
    },
    gateRangeDb: { label: 'Range', min: 0, max: 80, default: 40, unit: 'dB', decimals: 1 },
    gateAttackMs: {
        label: 'Attack',
        min: 0.05,
        max: 50,
        default: 1,
        unit: 'ms',
        scale: 'log',
        decimals: 2,
    },
    holdMs: { label: 'Hold', min: 0, max: 500, default: 50, unit: 'ms' },
    gateReleaseMs: { label: 'Release', min: 5, max: 2000, default: 150, unit: 'ms', scale: 'log' },
    hysteresisDb: { label: 'Hysteresis', min: 0, max: 12, default: 4, unit: 'dB', decimals: 1 },
    denoiseReductionDb: {
        label: 'Reduction',
        min: 0,
        max: 40,
        default: 12,
        unit: 'dB',
        decimals: 1,
    },
    denoiseThresholdDb: {
        label: 'Threshold',
        min: 0,
        max: 20,
        default: 6,
        unit: 'dB',
        decimals: 1,
    },
    denoiseSmoothing: { label: 'Smoothing', min: 0, max: 100, default: 50, unit: '%' },
    satDriveDb: { label: 'Drive', min: 0, max: 36, default: 6, unit: 'dB', decimals: 1 },
    satDynamics: { label: 'Dynamics', min: -100, max: 100, default: 0, unit: '%' },
    satTone: { label: 'Tone', min: -12, max: 12, default: 0, unit: 'dB', decimals: 1 },
    targetLufs: { label: 'Target', min: -36, max: -6, default: -14, unit: 'LUFS', decimals: 1 },
    resets: { label: 'Resets', min: 0, max: 1e9, default: 0, unit: '' },
} satisfies Record<string, NumberSpec>;

export type SpecKey = keyof typeof SPECS;

export interface EffectInfo {
    label: string;
    short: string;
    description: string;
    color: string;
    /** Analyzers pass audio through unchanged and only visualize it. */
    category: 'effect' | 'analyzer';
}

export const EFFECT_INFO: Record<EffectType, EffectInfo> = {
    eq: {
        label: 'Equalizer',
        short: 'EQ',
        description: 'Parametric EQ with up to 12 bands',
        color: '#4fb3ff',
        category: 'effect',
    },
    compressor: {
        label: 'Compressor',
        short: 'COMP',
        description: 'Soft-knee feed-forward compressor',
        color: '#ffb347',
        category: 'effect',
    },
    limiter: {
        label: 'Limiter',
        short: 'LIM',
        description: 'Lookahead brickwall limiter',
        color: '#ff5e7a',
        category: 'effect',
    },
    leveler: {
        label: 'Leveler',
        short: 'LVL',
        description: 'Rides the gain towards a loudness target, like a hand on the fader',
        color: '#c8f560',
        category: 'effect',
    },
    multiband: {
        label: 'Multiband',
        short: 'MB',
        description: 'Up to four-band compressor with Linkwitz-Riley crossovers',
        color: '#b78bff',
        category: 'effect',
    },
    saturator: {
        label: 'Saturator',
        short: 'SAT',
        description: 'Up to four-band saturation with six curves, dynamics and oversampling',
        color: '#ff7a59',
        category: 'effect',
    },
    filter: {
        label: 'Filter',
        short: 'FLT',
        description: 'Resonant multimode filter with LFO',
        color: '#3fe0c5',
        category: 'effect',
    },
    gate: {
        label: 'Gate',
        short: 'GATE',
        description: 'Noise gate with hold, hysteresis and sidechain filter',
        color: '#62f08a',
        category: 'effect',
    },
    deesser: {
        label: 'De-esser',
        short: 'DS',
        description: 'Sibilance tamer with split-band mode',
        color: '#ffd84f',
        category: 'effect',
    },
    denoiser: {
        label: 'Denoiser',
        short: 'DN',
        description: 'Spectral noise reduction that follows the noise floor',
        color: '#7fd1b9',
        category: 'effect',
    },
    utility: {
        label: 'Utility',
        short: 'UTIL',
        description: 'Gain, pan, stereo width, polarity and a loudness meter',
        color: '#9fe870',
        category: 'effect',
    },
    bassboost: {
        label: 'Bass Booster',
        short: 'BASS',
        description: 'Low shelf boost with harmonic enhancer',
        color: '#ff8a3d',
        category: 'effect',
    },
    spectrum: {
        label: 'Spectrum',
        short: 'SPEC',
        description: 'FFT spectrum analyzer with peak hold',
        color: '#6f8cff',
        category: 'analyzer',
    },
    spectrogram: {
        label: 'Spectrogram',
        short: 'SGRAM',
        description: 'Scrolling time-frequency display',
        color: '#ff6fd8',
        category: 'analyzer',
    },
    stereo: {
        label: 'Stereo Image',
        short: 'IMAGE',
        description: 'Goniometer, correlation and balance meters, and the image by frequency',
        color: '#8fe3ff',
        category: 'analyzer',
    },
    loudness: {
        label: 'Loudness',
        short: 'LUFS',
        description: 'EBU R128 loudness: momentary, short-term, integrated, range, true peak',
        color: '#ffcf6f',
        category: 'analyzer',
    },
};

export const EFFECT_TYPES = Object.keys(EFFECT_INFO) as EffectType[];

export const MAX_EQ_BANDS = 12;

export const MIN_BRANCHES = 2;
export const MAX_BRANCHES = 4;

/** Display metadata for a parallel group, shaped like the effects' own. */
export const PARALLEL_INFO = {
    label: 'Parallel',
    short: 'PAR',
    description: 'Runs branches side by side on the same input and sums them',
    color: '#c7d0dc',
};

export function itemInfo(item: ChainItem): Omit<EffectInfo, 'category'> {
    return isParallelGroup(item) ? PARALLEL_INFO : EFFECT_INFO[item.type];
}

/** The accent color of an item: the user's choice, else the default of its type. */
export function itemColor(item: ChainItem): string {
    return item.color ?? itemInfo(item).color;
}

/** Colors offered in the accent color picker, chosen to read well on the dark theme. */
export const ACCENT_SWATCHES = [
    '#4fb3ff',
    '#6f8cff',
    '#b78bff',
    '#ff6fd8',
    '#ff5e7a',
    '#ff7a59',
    '#ffb347',
    '#ffd84f',
    '#9fe870',
    '#62f08a',
    '#3fe0c5',
    '#8fe3ff',
];

export const ACCENT_COLOR_PATTERN = /^#[0-9a-f]{6}$/;

export function createId(): string {
    return Math.random().toString(36).slice(2, 10);
}

export function defaultEqBand(partial: Partial<EqBand> = {}): EqBand {
    return {
        id: createId(),
        enabled: true,
        type: 'bell',
        frequency: 1000,
        gainDb: 0,
        q: 1,
        slope: 24,
        ...partial,
    };
}

export function defaultMultibandBand(partial: Partial<MultibandBand> = {}): MultibandBand {
    return {
        thresholdDb: -24,
        ratio: 3,
        attackMs: 15,
        releaseMs: 150,
        makeupDb: 0,
        solo: false,
        bypass: false,
        mute: false,
        ...partial,
    };
}

export function defaultSaturatorBand(partial: Partial<SaturatorBand> = {}): SaturatorBand {
    return {
        style: 'tube',
        driveDb: 6,
        dynamics: 0,
        tone: 0,
        mix: 100,
        levelDb: 0,
        solo: false,
        mute: false,
        bypass: false,
        ...partial,
    };
}

export function defaultParams<T extends EffectType>(type: T): EffectParamsMap[T] {
    const defaults: EffectParamsMap = {
        eq: {
            bands: [
                defaultEqBand({ type: 'lowcut', frequency: 30, q: 0.71 }),
                defaultEqBand({ type: 'lowshelf', frequency: 120, q: 0.71 }),
                defaultEqBand({ frequency: 1000 }),
                defaultEqBand({ type: 'highshelf', frequency: 8000, q: 0.71 }),
            ],
            outputDb: 0,
        },
        compressor: {
            thresholdDb: -18,
            ratio: 4,
            kneeDb: 6,
            attackMs: 10,
            releaseMs: 120,
            makeupDb: 0,
            autoMakeup: true,
            mix: 100,
            detection: 'peak',
            sidechainHpHz: 20,
        },
        limiter: { inputDb: 0, ceilingDb: -1, releaseMs: 80, lookaheadMs: 3 },
        multiband: {
            crossovers: [150, 1500, 6000],
            bands: [
                defaultMultibandBand({ attackMs: 30, releaseMs: 250 }),
                defaultMultibandBand(),
                defaultMultibandBand({ attackMs: 8, releaseMs: 100 }),
                defaultMultibandBand({ attackMs: 3, releaseMs: 60 }),
            ],
            kneeDb: 6,
            outputDb: 0,
        },
        saturator: {
            crossovers: [],
            bands: [defaultSaturatorBand()],
            oversampling: 2,
            mix: 100,
            outputDb: 0,
        },
        gate: {
            thresholdDb: -45,
            rangeDb: 40,
            attackMs: 1,
            holdMs: 50,
            releaseMs: 150,
            hysteresisDb: 4,
            sidechainHpHz: 20,
        },
        filter: {
            mode: 'lowpass',
            cutoff: 2000,
            q: 0.71,
            slope: 24,
            driveDb: 0,
            lfoRate: 0.5,
            lfoDepth: 0,
            lfoShape: 'sine',
            mix: 100,
        },
        deesser: {
            frequency: 6500,
            thresholdDb: -30,
            rangeDb: 10,
            releaseMs: 60,
            mode: 'split',
            listen: false,
        },
        denoiser: {
            reductionDb: 12,
            thresholdDb: 6,
            smoothing: 50,
            mode: 'adaptive',
            freeze: false,
            listen: false,
            learning: false,
            profile: [],
        },
        leveler: {
            targetLufs: -18,
            fast: false,
            responseS: 4,
            fastResponseMs: 100,
            maxBoostDb: 12,
            maxCutDb: 12,
            gateLufs: -50,
        },
        utility: {
            gainDb: 0,
            pan: 0,
            width: 100,
            invertLeft: false,
            invertRight: false,
            mute: false,
        },
        bassboost: {
            boostDb: 6,
            frequency: 80,
            harmonics: 25,
            tighten: true,
            monoBass: false,
            outputDb: 0,
        },
        spectrum: {
            channel: 'mono',
            fftSize: 4096,
            tilt: 4.5,
            rangeDb: 96,
            smoothing: 60,
            peakHold: true,
        },
        spectrogram: {
            channel: 'mono',
            fftSize: 4096,
            tilt: 3,
            floorDb: -100,
            ceilingDb: -10,
            palette: 'magma',
        },
        stereo: { display: 'dots', persistence: 60, autoGain: true },
        loudness: { targetLufs: -14, resets: 0 },
    };
    return defaults[type];
}

export function createEffect<T extends EffectType>(type: T): EffectOf<T> {
    return { id: createId(), type, bypass: false, params: defaultParams(type) };
}

export function createBranch(effects: Effect[] = [], gainDb = 0): ParallelBranch {
    return { id: createId(), gainDb, pan: 0, mute: false, solo: false, invert: false, effects };
}

/** Branch level of a new two-branch group, so that it starts at unity gain. */
export const EQUAL_MIX_DB = -6;

export function createParallelGroup(
    branches: ParallelBranch[] = [createBranch([], EQUAL_MIX_DB), createBranch([], EQUAL_MIX_DB)],
): ParallelGroup {
    return { id: createId(), type: 'parallel', bypass: false, branches };
}

export function defaultRack(): RackState {
    return {
        version: 2,
        bypass: false,
        inputDb: 0,
        outputDb: 0,
        chain: [createEffect('eq'), createEffect('compressor'), createEffect('limiter')],
    };
}
