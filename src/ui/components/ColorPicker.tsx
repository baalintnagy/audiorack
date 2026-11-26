import { useRef, useState } from 'react';
import { ACCENT_COLOR_PATTERN, ACCENT_SWATCHES } from '../../shared/effects';
import { useDismiss } from '../useDismiss';

const POPOVER_WIDTH = 188;

/**
 * A color dot that opens a palette of accent colors. `color` is the user's choice, if any;
 * `fallback` is the default it returns to.
 */
export function ColorPicker({
    color,
    fallback,
    onChange,
}: {
    color: string | undefined;
    fallback: string;
    onChange: (color: string | undefined) => void;
}) {
    // Panels clip their content, so the popover is positioned against the viewport.
    const [position, setPosition] = useState<{ left: number; top: number }>();
    const [draft, setDraft] = useState('');
    const ref = useRef<HTMLDivElement>(null);
    const current = color ?? fallback;
    const open = position !== undefined;

    useDismiss(open, ref, () => setPosition(undefined));

    const toggle = () => {
        const rect = ref.current?.getBoundingClientRect();
        if (open || !rect) {
            setPosition(undefined);
            return;
        }
        setDraft(current);
        setPosition({
            left: Math.max(4, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 4)),
            top: rect.bottom + 6,
        });
    };

    const pick = (next: string | undefined) => {
        onChange(next === fallback ? undefined : next);
        setDraft(next ?? fallback);
    };

    const commitDraft = (text: string) => {
        setDraft(text);
        const normalized = (text.startsWith('#') ? text : `#${text}`).trim().toLowerCase();
        if (ACCENT_COLOR_PATTERN.test(normalized)) {
            pick(normalized);
        }
    };

    return (
        <div className="color-picker" ref={ref}>
            <button
                type="button"
                className="color-dot"
                style={{ background: current }}
                onClick={toggle}
                title="Change the accent color"
                aria-label="Change the accent color"
                aria-expanded={open}
            />
            {position && (
                <div
                    className="menu color-popover"
                    role="dialog"
                    aria-label="Accent color"
                    style={{ left: position.left, top: position.top, width: POPOVER_WIDTH }}
                >
                    <div className="color-swatches">
                        {ACCENT_SWATCHES.map((swatch) => (
                            <button
                                key={swatch}
                                type="button"
                                className={`color-swatch ${swatch === current ? 'on' : ''}`}
                                style={{ background: swatch }}
                                onClick={() => pick(swatch)}
                                title={swatch}
                                aria-label={swatch}
                                aria-pressed={swatch === current}
                            />
                        ))}
                    </div>
                    <div className="color-custom">
                        <input
                            type="color"
                            value={current}
                            onChange={(event) => pick(event.target.value.toLowerCase())}
                            title="Pick any color"
                            aria-label="Pick any color"
                        />
                        <input
                            type="text"
                            className="color-hex"
                            value={draft}
                            maxLength={7}
                            spellCheck={false}
                            onChange={(event) => commitDraft(event.target.value)}
                            aria-label="Hex color"
                        />
                    </div>
                    <button
                        type="button"
                        className="ghost small color-default"
                        disabled={color === undefined}
                        onClick={() => pick(undefined)}
                        title="Use the default color of this effect"
                    >
                        <span className="color-swatch small" style={{ background: fallback }} />
                        Default
                    </button>
                </div>
            )}
        </div>
    );
}
