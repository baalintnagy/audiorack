import type { NumberSpec } from '../shared/effects';

export function toNormalized(spec: NumberSpec, value: number): number {
    if (spec.scale === 'log') {
        return Math.log(value / spec.min) / Math.log(spec.max / spec.min);
    }
    return (value - spec.min) / (spec.max - spec.min);
}

export function fromNormalized(spec: NumberSpec, normalized: number): number {
    const n = Math.min(1, Math.max(0, normalized));
    if (spec.scale === 'log') {
        return spec.min * Math.pow(spec.max / spec.min, n);
    }
    return spec.min + (spec.max - spec.min) * n;
}

export function roundForSpec(spec: NumberSpec, value: number): number {
    const decimals = spec.decimals ?? (spec.scale === 'log' && value < 100 ? 1 : 0);
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
}

export function formatFrequency(hz: number): string {
    if (hz >= 1000) {
        return `${(hz / 1000).toFixed(hz >= 10000 ? 1 : 2)} kHz`;
    }
    return `${hz.toFixed(hz < 100 ? 1 : 0)} Hz`;
}

export function formatValue(spec: NumberSpec, value: number): string {
    if (spec.unit === 'Hz') {
        return formatFrequency(value);
    }
    if (spec.unit === ':1') {
        return value >= 19.95 ? '∞:1' : `${value.toFixed(1)}:1`;
    }
    if (spec.unit === 'ms') {
        return value >= 100 ? `${value.toFixed(0)} ms` : `${value.toFixed(1)} ms`;
    }
    if (spec.label === 'Pan') {
        if (Math.abs(value) < 0.5) {
            return 'C';
        }
        return `${Math.abs(value).toFixed(0)}${value < 0 ? 'L' : 'R'}`;
    }
    const decimals = spec.decimals ?? 0;
    const sign = spec.unit === 'dB' && value > 0 ? '+' : '';
    const unit = spec.unit ? ` ${spec.unit}` : '';
    return `${sign}${value.toFixed(decimals)}${unit}`;
}

/** Parses user-typed values such as "2.5k", "-6", "120 ms". */
export function parseValue(spec: NumberSpec, text: string): number | undefined {
    const match = /^\s*([-+]?\d*\.?\d+)\s*(k)?/i.exec(text);
    if (!match) {
        return undefined;
    }
    const value = Number(match[1]) * (match[2] ? 1000 : 1);
    return Number.isFinite(value) ? Math.min(spec.max, Math.max(spec.min, value)) : undefined;
}

export function formatDb(value: number, decimals = 1): string {
    if (!Number.isFinite(value) || value <= -99) {
        return '-∞';
    }
    return value.toFixed(decimals);
}

export function gainToDbValue(gain: number): number {
    return gain > 1e-6 ? 20 * Math.log10(gain) : -120;
}
