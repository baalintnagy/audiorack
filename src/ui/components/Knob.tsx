import { useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import type { NumberSpec } from '../../shared/effects';
import { formatValue, fromNormalized, parseValue, roundForSpec, toNormalized } from '../format';

const START_ANGLE = -135;
const SWEEP = 270;

function polar(cx: number, cy: number, radius: number, degrees: number) {
    const radians = ((degrees - 90) * Math.PI) / 180;
    return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

function arc(cx: number, cy: number, radius: number, from: number, to: number) {
    const start = polar(cx, cy, radius, from);
    const end = polar(cx, cy, radius, to);
    const large = Math.abs(to - from) > 180 ? 1 : 0;
    const sweep = to > from ? 1 : 0;
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${large} ${sweep} ${end.x} ${end.y}`;
}

export function Knob({
    spec,
    value,
    onChange,
    color = 'var(--accent)',
    size = 46,
    label,
    defaultValue,
    disabled = false,
}: {
    spec: NumberSpec;
    value: number;
    onChange: (value: number) => void;
    color?: string;
    size?: number;
    label?: string;
    defaultValue?: number;
    disabled?: boolean;
}) {
    const drag = useRef<{ y: number; position: number } | undefined>(undefined);
    const [editing, setEditing] = useState(false);
    const normalized = Math.min(1, Math.max(0, toNormalized(spec, value)));
    const bipolar = spec.min < 0 && spec.max > 0 && spec.scale !== 'log';
    const origin = bipolar ? toNormalized(spec, 0) : 0;
    const angle = START_ANGLE + normalized * SWEEP;
    const originAngle = START_ANGLE + origin * SWEEP;
    const c = size / 2;
    const radius = size / 2 - 5;
    const pointer = polar(c, c, radius - 9, angle);
    const pointerBase = polar(c, c, radius * 0.2, angle);
    const name = label ?? spec.label;

    const set = (next: number) => {
        const rounded = roundForSpec(spec, Math.min(spec.max, Math.max(spec.min, next)));
        if (rounded !== value) {
            onChange(rounded);
        }
    };

    const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
        if (disabled || event.button !== 0) {
            return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { y: event.clientY, position: normalized };
    };

    const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
        if (!drag.current) {
            return;
        }
        // Accumulate relative movement so switching to fine mode mid-drag does not jump.
        const sensitivity = event.shiftKey ? 1200 : 220;
        const position = Math.min(
            1,
            Math.max(0, drag.current.position + (drag.current.y - event.clientY) / sensitivity),
        );
        drag.current = { y: event.clientY, position };
        set(fromNormalized(spec, position));
    };

    const onPointerUp = () => {
        drag.current = undefined;
    };

    const onWheel = (event: WheelEvent<SVGSVGElement>) => {
        if (disabled) {
            return;
        }
        const step = (event.shiftKey ? 0.002 : 0.015) * (event.deltaY < 0 ? 1 : -1);
        set(fromNormalized(spec, normalized + step));
    };

    const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
        const step = event.shiftKey ? 0.002 : 0.02;
        const keys: Record<string, number> = {
            ArrowUp: step,
            ArrowRight: step,
            ArrowDown: -step,
            ArrowLeft: -step,
            PageUp: 0.1,
            PageDown: -0.1,
        };
        if (event.key in keys) {
            event.preventDefault();
            set(fromNormalized(spec, normalized + keys[event.key]));
        } else if (event.key === 'Home') {
            set(spec.min);
        } else if (event.key === 'End') {
            set(spec.max);
        }
    };

    return (
        <div className={`knob ${disabled ? 'disabled' : ''}`} style={{ width: size + 16 }}>
            <span className="knob-label">{name}</span>
            <svg
                width={size}
                height={size}
                viewBox={`0 0 ${size} ${size}`}
                role="slider"
                tabIndex={disabled ? -1 : 0}
                aria-label={name}
                aria-valuemin={spec.min}
                aria-valuemax={spec.max}
                aria-valuenow={value}
                aria-valuetext={formatValue(spec, value)}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onWheel={onWheel}
                onKeyDown={onKeyDown}
                onDoubleClick={() => set(defaultValue ?? spec.default)}
            >
                <defs>
                    <radialGradient id="knob-cap" cx="40%" cy="30%" r="75%">
                        <stop offset="0%" stopColor="var(--knob-hi)" />
                        <stop offset="100%" stopColor="var(--knob-lo)" />
                    </radialGradient>
                </defs>
                <path
                    d={arc(c, c, radius, START_ANGLE, START_ANGLE + SWEEP)}
                    className="knob-track"
                />
                {Math.abs(angle - originAngle) > 0.5 && (
                    <path
                        d={arc(
                            c,
                            c,
                            radius,
                            Math.min(originAngle, angle),
                            Math.max(originAngle, angle),
                        )}
                        className="knob-value"
                        style={{ stroke: color }}
                    />
                )}
                <circle cx={c} cy={c} r={radius - 6} fill="url(#knob-cap)" className="knob-cap" />
                <line
                    x1={pointerBase.x}
                    y1={pointerBase.y}
                    x2={pointer.x}
                    y2={pointer.y}
                    className="knob-pointer"
                />
            </svg>
            {editing ? (
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
            ) : (
                <button
                    type="button"
                    className="knob-readout"
                    disabled={disabled}
                    title="Click to type a value"
                    onClick={() => setEditing(true)}
                >
                    {formatValue(spec, value)}
                </button>
            )}
        </div>
    );
}
