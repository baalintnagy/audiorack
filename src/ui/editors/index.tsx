import type { Effect, EffectParamsMap } from '../../shared/effects';
import { itemColor } from '../../shared/effects';
import { BassBoostEditor } from './BassBoostEditor';
import { CompressorEditor } from './CompressorEditor';
import { DeesserEditor } from './DeesserEditor';
import { DenoiserEditor } from './DenoiserEditor';
import { EqEditor } from './EqEditor';
import { FilterEditor } from './FilterEditor';
import { GateEditor } from './GateEditor';
import { LimiterEditor } from './LimiterEditor';
import { LoudnessEditor } from './LoudnessEditor';
import { MultibandEditor } from './MultibandEditor';
import { SaturatorEditor } from './SaturatorEditor';
import { SpectrogramEditor } from './SpectrogramEditor';
import { SpectrumEditor } from './SpectrumEditor';
import { StereoEditor } from './StereoEditor';
import { VolumeEditor } from './VolumeEditor';

export function EffectEditor({
    effect,
    setParams,
}: {
    effect: Effect;
    setParams: (patch: Partial<EffectParamsMap[Effect['type']]>) => void;
}) {
    const color = itemColor(effect);
    switch (effect.type) {
        case 'eq':
            return <EqEditor effect={effect} setParams={setParams} color={color} />;
        case 'compressor':
            return <CompressorEditor effect={effect} setParams={setParams} color={color} />;
        case 'limiter':
            return <LimiterEditor effect={effect} setParams={setParams} color={color} />;
        case 'multiband':
            return <MultibandEditor effect={effect} setParams={setParams} color={color} />;
        case 'saturator':
            return <SaturatorEditor effect={effect} setParams={setParams} color={color} />;
        case 'gate':
            return <GateEditor effect={effect} setParams={setParams} color={color} />;
        case 'denoiser':
            return <DenoiserEditor effect={effect} setParams={setParams} color={color} />;
        case 'loudness':
            return <LoudnessEditor effect={effect} setParams={setParams} color={color} />;
        case 'filter':
            return <FilterEditor effect={effect} setParams={setParams} color={color} />;
        case 'deesser':
            return <DeesserEditor effect={effect} setParams={setParams} color={color} />;
        case 'volume':
            return <VolumeEditor effect={effect} setParams={setParams} color={color} />;
        case 'bassboost':
            return <BassBoostEditor effect={effect} setParams={setParams} color={color} />;
        case 'spectrum':
            return <SpectrumEditor effect={effect} setParams={setParams} color={color} />;
        case 'spectrogram':
            return <SpectrogramEditor effect={effect} setParams={setParams} color={color} />;
        case 'stereo':
            return <StereoEditor effect={effect} setParams={setParams} color={color} />;
    }
}
