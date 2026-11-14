export type EffectType =
    | 'eq'
    | 'compressor'
    | 'limiter'
    | 'multiband'
    | 'filter'
    | 'deesser'
    | 'volume'
    | 'bassboost'
    | 'spectrum'
    | 'spectrogram'
    | 'stereo';

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

export interface VolumeParams {
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

export interface EffectParamsMap {
    eq: EqParams;
    compressor: CompressorParams;
    limiter: LimiterParams;
    multiband: MultibandParams;
    filter: FilterParams;
    deesser: DeesserParams;
    volume: VolumeParams;
    bassboost: BassBoostParams;
    spectrum: SpectrumParams;
    spectrogram: SpectrogramParams;
    stereo: StereoParams;
}

export type EffectOf<T extends EffectType> = {
    id: string;
    type: T;
    bypass: boolean;
    params: EffectParamsMap[T];
};

export type Effect = { [T in EffectType]: EffectOf<T> }[EffectType];

export interface RackState {
    version: 1;
    bypass: boolean;
    inputDb: number;
    outputDb: number;
    chain: Effect[];
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
    volumeDb: { label: 'Gain', min: -60, max: 24, default: 0, unit: 'dB', decimals: 1 },
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
    tilt: { label: 'Tilt', min: 0, max: 6, default: 4.5, unit: 'dB/oct', decimals: 1 },
    smoothing: { label: 'Smoothing', min: 0, max: 100, default: 60, unit: '%' },
    analyzerRange: { label: 'Range', min: 48, max: 144, default: 96, unit: 'dB' },
    floorDb: { label: 'Floor', min: -140, max: -40, default: -100, unit: 'dB' },
    spectrogramCeilingDb: { label: 'Ceiling', min: -40, max: 0, default: -10, unit: 'dB' },
    persistence: { label: 'Persistence', min: 0, max: 100, default: 60, unit: '%' },
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
    multiband: {
        label: 'Multiband',
        short: 'MB',
        description: 'Up to four-band compressor with Linkwitz-Riley crossovers',
        color: '#b78bff',
        category: 'effect',
    },
    filter: {
        label: 'Filter',
        short: 'FLT',
        description: 'Resonant multimode filter with LFO',
        color: '#3fe0c5',
        category: 'effect',
    },
    deesser: {
        label: 'De-esser',
        short: 'DS',
        description: 'Sibilance tamer with split-band mode',
        color: '#ffd84f',
        category: 'effect',
    },
    volume: {
        label: 'Volume',
        short: 'VOL',
        description: 'Gain, pan, stereo width and polarity',
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
        description: 'Goniometer, correlation and balance meters',
        color: '#8fe3ff',
        category: 'analyzer',
    },
};

export const EFFECT_TYPES = Object.keys(EFFECT_INFO) as EffectType[];

export const MAX_EQ_BANDS = 12;

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
        volume: {
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
    };
    return defaults[type];
}

export function createEffect<T extends EffectType>(type: T): EffectOf<T> {
    return { id: createId(), type, bypass: false, params: defaultParams(type) };
}

export function defaultRack(): RackState {
    return {
        version: 1,
        bypass: false,
        inputDb: 0,
        outputDb: 0,
        chain: [createEffect('eq'), createEffect('compressor'), createEffect('limiter')],
    };
}
