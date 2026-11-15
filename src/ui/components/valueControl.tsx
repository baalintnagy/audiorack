import { useState, type KeyboardEvent, type WheelEvent } from 'react';
import type { NumberSpec } from '../../shared/effects';
import { formatValue, fromNormalized, parseValue, roundForSpec, toNormalized } from '../format';

const KEY_STEPS: Record<string, number> = {
    ArrowUp: 1,
    ArrowRight: 1,
    ArrowDown: -1,
    ArrowLeft: -1,
};

/**
 * Shared behavior of continuous controls (knobs, faders): clamping and rounding to the spec,
 * mouse wheel, arrow/page/home/end keys and double-click reset. Shift selects fine steps.
 */
export function useValueControl({
    spec,
    value,
    onChange,
    defaultValue,
    disabled = false,
}: {
    spec: NumberSpec;
    value: number;
    onChange: (value: number) => void;
    defaultValue?: number;
    disabled?: boolean;
}) {
    const normalized = Math.min(1, Math.max(0, toNormalized(spec, value)));

    const set = (next: number) => {
        const rounded = roundForSpec(spec, Math.min(spec.max, Math.max(spec.min, next)));
        if (rounded !== value) {
            onChange(rounded);
        }
    };

    const setNormalized = (position: number) =>
        set(fromNormalized(spec, Math.min(1, Math.max(0, position))));

    return {
        normalized,
        set,
        setNormalized,
        reset: () => set(defaultValue ?? spec.default),
        onWheel: (event: WheelEvent<Element>) => {
            if (disabled) {
                return;
            }
            const step = (event.shiftKey ? 0.002 : 0.015) * (event.deltaY < 0 ? 1 : -1);
            setNormalized(normalized + step);
        },
        onKeyDown: (event: KeyboardEvent<Element>) => {
            const step = event.shiftKey ? 0.002 : 0.02;
            if (event.key in KEY_STEPS) {
                event.preventDefault();
                setNormalized(normalized + KEY_STEPS[event.key] * step);
            } else if (event.key === 'PageUp' || event.key === 'PageDown') {
                event.preventDefault();
                setNormalized(normalized + (event.key === 'PageUp' ? 0.1 : -0.1));
            } else if (event.key === 'Home') {
                set(spec.min);
            } else if (event.key === 'End') {
                set(spec.max);
            }
        },
        /** ARIA attributes for the element with `role="slider"`. */
        aria: {
            role: 'slider',
            tabIndex: disabled ? -1 : 0,
            'aria-valuemin': spec.min,
            'aria-valuemax': spec.max,
            'aria-valuenow': value,
            'aria-valuetext': formatValue(spec, value),
        },
    };
}

/** The formatted value; click it to type a new one (`2.5k`, `-6`, …). */
export function ValueReadout({
    spec,
    value,
    set,
    disabled = false,
}: {
    spec: NumberSpec;
    value: number;
    set: (value: number) => void;
    disabled?: boolean;
}) {
    const [editing, setEditing] = useState(false);
    if (editing) {
        return (
            <input
                className="knob-input"
                autoFocus
                defaultValue={roundForSpec(spec, value)}
                onBlur={(event) => {
                    const parsed = parseValue(spec, event.target.value);
                    if (parsed !== undefined) {
                        set(parsed);
                    }
                    setEditing(false);
                }}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        event.currentTarget.blur();
                    } else if (event.key === 'Escape') {
                        setEditing(false);
                    }
                }}
            />
        );
    }
    return (
        <button
            type="button"
            className="knob-readout"
            disabled={disabled}
            title="Click to type a value"
            onClick={() => setEditing(true)}
        >
            {formatValue(spec, value)}
        </button>
    );
}
