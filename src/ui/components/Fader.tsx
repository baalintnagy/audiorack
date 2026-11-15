import { useRef, type PointerEvent } from 'react';
import type { NumberSpec } from '../../shared/effects';
import { toNormalized } from '../format';
import { ValueReadout, useValueControl } from './valueControl';

const FINE_FACTOR = 5;

/**
 * Vertical mixer fader. Drag the cap (Shift for fine), click the track to jump, or use the
 * wheel and arrow keys; double-click resets. `marks` are values labeled along the scale.
 */
export function Fader({
    spec,
    value,
    onChange,
    marks,
    label,
    color = 'var(--accent)',
    defaultValue,
}: {
    spec: NumberSpec;
    value: number;
    onChange: (value: number) => void;
    marks: number[];
    label?: string;
    color?: string;
    defaultValue?: number;
}) {
    const control = useValueControl({ spec, value, onChange, defaultValue });
    const track = useRef<HTMLDivElement>(null);
    const drag = useRef<{ y: number; position: number } | undefined>(undefined);
    const name = label ?? spec.label;

    const positionAt = (clientY: number) => {
        const rect = track.current?.getBoundingClientRect();
        return rect ? 1 - (clientY - rect.top) / rect.height : control.normalized;
    };

    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) {
            return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        const onCap = (event.target as HTMLElement).classList.contains('fader-cap');
        const position = onCap ? control.normalized : positionAt(event.clientY);
        drag.current = { y: event.clientY, position };
        control.setNormalized(position);
    };

    const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
        const height = track.current?.clientHeight;
        if (!drag.current || !height) {
            return;
        }
        // Accumulate relative movement so switching to fine mode mid-drag does not jump.
        const scale = event.shiftKey ? height * FINE_FACTOR : height;
        const position = Math.min(
            1,
            Math.max(0, drag.current.position + (drag.current.y - event.clientY) / scale),
        );
        drag.current = { y: event.clientY, position };
        control.setNormalized(position);
    };

    const onPointerUp = () => {
        drag.current = undefined;
    };

    const percent = (normalized: number) => `${normalized * 100}%`;

    return (
        <div className="fader" style={{ ['--fader-color' as string]: color }}>
            <div className="fader-body">
                <div className="fader-scale" aria-hidden="true">
                    {marks.map((mark) => (
                        <span key={mark} style={{ bottom: percent(toNormalized(spec, mark)) }}>
                            {mark > 0 ? `+${mark}` : mark}
                        </span>
                    ))}
                </div>
                <div
                    ref={track}
                    className="fader-track"
                    {...control.aria}
                    aria-label={name}
                    aria-orientation="vertical"
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    onWheel={control.onWheel}
                    onKeyDown={control.onKeyDown}
                    onDoubleClick={control.reset}
                >
                    <div className="fader-fill" style={{ height: percent(control.normalized) }} />
                    <div className="fader-cap" style={{ bottom: percent(control.normalized) }} />
                </div>
            </div>
            <ValueReadout spec={spec} value={value} set={control.set} />
        </div>
    );
}
