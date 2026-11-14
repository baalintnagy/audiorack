import { useEffect, useRef, useState, type DragEvent } from 'react';
import { EFFECT_INFO, EFFECT_TYPES, type Effect, type EffectType } from '../../shared/effects';
import { MAX_CHAIN_LENGTH } from '../../shared/normalize';
import { css } from '../graph';
import { useCanvas } from '../useCanvas';
import { PowerIcon } from './Controls';

const DRAG_TYPE = 'application/x-audiorack-effect';

/** Small activity indicator: gain reduction for dynamics, otherwise nothing. */
function SlotActivity({ effect }: { effect: Effect }) {
    const shown = useRef(0);
    const ref = useCanvas(
        ({ ctx, width, height, telemetry, live }) => {
            const readings = telemetry?.meters.effects[effect.id] ?? [];
            const reduction = effect.type === 'filter' ? 0 : Math.max(0, ...readings);
            if (live) {
                shown.current = reduction > shown.current ? reduction : shown.current * 0.8;
            }
            ctx.fillStyle = css('--meter-bg');
            ctx.fillRect(0, 0, width, height);
            const fraction = Math.min(1, shown.current / 18);
            ctx.fillStyle = EFFECT_INFO[effect.type].color;
            ctx.fillRect(0, 0, width * fraction, height);
        },
        [effect.id, effect.type],
    );
    return <canvas ref={ref} className="slot-activity" />;
}

function AddMenu({ onAdd, disabled }: { onAdd: (type: EffectType) => void; disabled: boolean }) {
    // The chain scrolls horizontally, so the menu is positioned against the viewport.
    const [position, setPosition] = useState<{ left: number; top: number }>();
    const open = position !== undefined;
    const setOpen = (value: boolean) => {
        const rect = ref.current?.getBoundingClientRect();
        setPosition(
            value && rect
                ? { left: Math.min(rect.left, window.innerWidth - 290), top: rect.bottom + 6 }
                : undefined,
        );
    };
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) {
            return;
        }
        const close = (event: MouseEvent) => {
            if (!ref.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        window.addEventListener('mousedown', close);
        return () => window.removeEventListener('mousedown', close);
    }, [open]);
    return (
        <div className="add-menu" ref={ref}>
            <button
                type="button"
                className="slot add-slot"
                disabled={disabled}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
                title={disabled ? `The rack holds up to ${MAX_CHAIN_LENGTH} effects` : 'Add effect'}
            >
                <span className="add-plus">+</span>
                <span className="slot-name">Add</span>
            </button>
            {open && (
                <div className="menu add-menu-list" role="menu" style={position}>
                    {EFFECT_TYPES.map((type) => (
                        <button
                            type="button"
                            role="menuitem"
                            key={type}
                            className="menu-item"
                            onClick={() => {
                                onAdd(type);
                                setOpen(false);
                            }}
                        >
                            <span
                                className="menu-swatch"
                                style={{ background: EFFECT_INFO[type].color }}
                            />
                            <span className="menu-item-text">
                                <strong>{EFFECT_INFO[type].label}</strong>
                                <small>{EFFECT_INFO[type].description}</small>
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export function ChainStrip({
    chain,
    selectedId,
    onSelect,
    onToggle,
    onRemove,
    onMove,
    onAdd,
}: {
    chain: Effect[];
    selectedId: string | undefined;
    onSelect: (id: string) => void;
    onToggle: (id: string) => void;
    onRemove: (id: string) => void;
    onMove: (id: string, index: number) => void;
    onAdd: (type: EffectType) => void;
}) {
    const [dropIndex, setDropIndex] = useState<number | undefined>(undefined);
    const dragged = useRef<string | undefined>(undefined);

    const dropTarget = (event: DragEvent<HTMLElement>, index: number) => {
        const rect = event.currentTarget.getBoundingClientRect();
        return event.clientX - rect.left > rect.width / 2 ? index + 1 : index;
    };

    return (
        <div
            className="chain"
            role="list"
            aria-label="Effect chain"
            onWheel={(event) => {
                // Let a regular mouse wheel scroll the horizontal chain.
                if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
                    event.currentTarget.scrollLeft += event.deltaY;
                }
            }}
        >
            <div className="chain-io">IN</div>
            {chain.map((effect, index) => {
                const info = EFFECT_INFO[effect.type];
                return (
                    <div
                        key={effect.id}
                        role="listitem"
                        className={[
                            'slot',
                            effect.id === selectedId ? 'selected' : '',
                            effect.bypass ? 'bypassed' : '',
                            dropIndex === index ? 'drop-before' : '',
                            dropIndex === index + 1 && index === chain.length - 1
                                ? 'drop-after'
                                : '',
                        ].join(' ')}
                        style={{ ['--slot-color' as string]: info.color }}
                        draggable
                        onDragStart={(event) => {
                            dragged.current = effect.id;
                            event.dataTransfer.setData(DRAG_TYPE, effect.id);
                            event.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragEnd={() => {
                            dragged.current = undefined;
                            setDropIndex(undefined);
                        }}
                        onDragOver={(event) => {
                            if (dragged.current) {
                                event.preventDefault();
                                setDropIndex(dropTarget(event, index));
                            }
                        }}
                        onDrop={(event) => {
                            event.preventDefault();
                            const id = dragged.current;
                            if (id) {
                                const target = dropTarget(event, index);
                                const from = chain.findIndex((item) => item.id === id);
                                onMove(id, target > from ? target - 1 : target);
                            }
                            setDropIndex(undefined);
                        }}
                        onClick={() => onSelect(effect.id)}
                        title={`${info.label} — drag to reorder`}
                    >
                        <div className="slot-top">
                            <button
                                type="button"
                                className={`slot-power ${effect.bypass ? '' : 'on'}`}
                                aria-label={
                                    effect.bypass ? `Enable ${info.label}` : `Bypass ${info.label}`
                                }
                                aria-pressed={!effect.bypass}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onToggle(effect.id);
                                }}
                            >
                                <PowerIcon />
                            </button>
                            <span className="slot-index">{index + 1}</span>
                            <button
                                type="button"
                                className="slot-remove"
                                aria-label={`Remove ${info.label}`}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onRemove(effect.id);
                                }}
                            >
                                ×
                            </button>
                        </div>
                        <span className="slot-name">{info.short}</span>
                        <span className="slot-label">{info.label}</span>
                        <SlotActivity effect={effect} />
                    </div>
                );
            })}
            <AddMenu onAdd={onAdd} disabled={chain.length >= MAX_CHAIN_LENGTH} />
            <div className="chain-io">OUT</div>
        </div>
    );
}
