import { useEffect, useRef, useState } from 'react';
import { EFFECT_INFO, EFFECT_TYPES, PARALLEL_INFO, type EffectType } from '../../shared/effects';

/** What the add menu can create: an effect, or a parallel group in the main chain. */
export type AddKind = EffectType | 'parallel';

const MENU_WIDTH = 290;

function MenuItem({
    label,
    description,
    color,
    onClick,
}: {
    label: string;
    description: string;
    color: string;
    onClick: () => void;
}) {
    return (
        <button type="button" role="menuitem" className="menu-item" onClick={onClick}>
            <span className="menu-swatch" style={{ background: color }} />
            <span className="menu-item-text">
                <strong>{label}</strong>
                <small>{description}</small>
            </span>
        </button>
    );
}

/**
 * The "+ Add" button. `header` is the button in the app header, which adds to the main chain at
 * the selection; `lane` is the small one at the end of a parallel branch, which only offers
 * effects.
 */
export function AddMenu({
    onAdd,
    disabled,
    disabledReason,
    variant,
}: {
    onAdd: (kind: AddKind) => void;
    disabled: boolean;
    disabledReason: string;
    variant: 'header' | 'lane';
}) {
    // Branches scroll with the chain, so the menu is positioned against the viewport.
    const [position, setPosition] = useState<{ left: number; top: number }>();
    const ref = useRef<HTMLDivElement>(null);
    const open = position !== undefined;
    const setOpen = (value: boolean) => {
        const rect = ref.current?.getBoundingClientRect();
        setPosition(
            value && rect
                ? {
                      left: Math.min(rect.left, window.innerWidth - MENU_WIDTH),
                      top: rect.bottom + 6,
                  }
                : undefined,
        );
    };
    useEffect(() => {
        if (!open) {
            return;
        }
        const close = (event: MouseEvent) => {
            if (!ref.current?.contains(event.target as Node)) {
                setPosition(undefined);
            }
        };
        window.addEventListener('mousedown', close);
        return () => window.removeEventListener('mousedown', close);
    }, [open]);
    const choose = (kind: AddKind) => {
        onAdd(kind);
        setOpen(false);
    };
    const title = disabled ? disabledReason : variant === 'lane' ? 'Add to branch' : 'Add effect';
    return (
        <div className={`add-menu add-menu-${variant}`} ref={ref}>
            <button
                type="button"
                className={variant === 'header' ? 'ghost add-button' : 'lane-add'}
                disabled={disabled}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={title}
                onClick={(event) => {
                    event.stopPropagation();
                    setOpen(!open);
                }}
                title={title}
            >
                <span className="add-plus">+</span>
                {variant === 'header' && <span>Add</span>}
            </button>
            {open && (
                <div
                    className="menu add-menu-list"
                    role="menu"
                    style={position}
                    onClick={(event) => event.stopPropagation()}
                >
                    {(['effect', 'analyzer'] as const).map((category) => (
                        <div key={category} role="group">
                            <div className="menu-heading">
                                {category === 'effect' ? 'Effects' : 'Analyzers'}
                            </div>
                            {EFFECT_TYPES.filter(
                                (type) => EFFECT_INFO[type].category === category,
                            ).map((type) => (
                                <MenuItem
                                    key={type}
                                    label={EFFECT_INFO[type].label}
                                    description={EFFECT_INFO[type].description}
                                    color={EFFECT_INFO[type].color}
                                    onClick={() => choose(type)}
                                />
                            ))}
                        </div>
                    ))}
                    {variant === 'header' && (
                        <div role="group">
                            <div className="menu-heading">Routing</div>
                            <MenuItem
                                label={PARALLEL_INFO.label}
                                description={PARALLEL_INFO.description}
                                color={PARALLEL_INFO.color}
                                onClick={() => choose('parallel')}
                            />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
