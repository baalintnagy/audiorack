import type { EffectOf, EffectParamsMap, EffectType } from '../../shared/effects';

export interface EditorProps<T extends EffectType> {
    effect: EffectOf<T>;
    setParams: (patch: Partial<EffectParamsMap[T]>) => void;
    color: string;
}

export const BAND_COLORS = [
    '#4fb3ff',
    '#ffb347',
    '#9fe870',
    '#ff6fa8',
    '#b78bff',
    '#3fe0c5',
    '#ffd84f',
    '#ff8a3d',
    '#6f8cff',
    '#f06bff',
    '#62f08a',
    '#ff5e5e',
];
