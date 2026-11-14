import type { Effect, EffectParamsMap } from '../../shared/effects';
import { EFFECT_INFO } from '../../shared/effects';
import { BassBoostEditor } from './BassBoostEditor';
import { CompressorEditor } from './CompressorEditor';
import { DeesserEditor } from './DeesserEditor';
import { EqEditor } from './EqEditor';
import { FilterEditor } from './FilterEditor';
import { LimiterEditor } from './LimiterEditor';
import { MultibandEditor } from './MultibandEditor';
import { VolumeEditor } from './VolumeEditor';

export function EffectEditor({
    effect,
    setParams,
}: {
    effect: Effect;
    setParams: (patch: Partial<EffectParamsMap[Effect['type']]>) => void;
}) {
    const color = EFFECT_INFO[effect.type].color;
    switch (effect.type) {
        case 'eq':
            return <EqEditor effect={effect} setParams={setParams} color={color} />;
        case 'compressor':
            return <CompressorEditor effect={effect} setParams={setParams} color={color} />;
        case 'limiter':
            return <LimiterEditor effect={effect} setParams={setParams} color={color} />;
        case 'multiband':
            return <MultibandEditor effect={effect} setParams={setParams} color={color} />;
        case 'filter':
            return <FilterEditor effect={effect} setParams={setParams} color={color} />;
        case 'deesser':
            return <DeesserEditor effect={effect} setParams={setParams} color={color} />;
        case 'volume':
            return <VolumeEditor effect={effect} setParams={setParams} color={color} />;
        case 'bassboost':
            return <BassBoostEditor effect={effect} setParams={setParams} color={color} />;
    }
}
