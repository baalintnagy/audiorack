import { useRef, type PointerEvent } from 'react';
import type { NumberSpec } from '../../shared/effects';
import { toNormalized } from '../format';
import { ValueReadout, useValueControl } from './valueControl';

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
    const control = useValueControl({ spec, value, onChange, defaultValue, disabled });
    const normalized = control.normalized;
    const bipolar = spec.min < 0 && spec.max > 0 && spec.scale !== 'log';
    const origin = bipolar ? toNormalized(spec, 0) : 0;
    const angle = START_ANGLE + normalized * SWEEP;
    const originAngle = START_ANGLE + origin * SWEEP;
    const c = size / 2;
    const radius = size / 2 - 5;
    const pointer = polar(c, c, radius - 9, angle);
    const pointerBase = polar(c, c, radius * 0.2, angle);
    const name = label ?? spec.label;

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
        control.setNormalized(position);
    };

    const onPointerUp = () => {
        drag.current = undefined;
    };

    return (
        <div className={`knob ${disabled ? 'disabled' : ''}`} style={{ width: size + 16 }}>
            <span className="knob-label">{name}</span>
            <svg
                width={size}
                height={size}
                viewBox={`0 0 ${size} ${size}`}
                {...control.aria}
                aria-label={name}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onWheel={control.onWheel}
                onKeyDown={control.onKeyDown}
                onDoubleClick={control.reset}
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
            <ValueReadout spec={spec} value={value} set={control.set} disabled={disabled} />
        </div>
    );
}
