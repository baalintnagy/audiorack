import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { countEffects } from '../../shared/chain';
import type { RackState } from '../../shared/effects';
import { normalizeRack } from '../../shared/normalize';
import {
    FACTORY_PRESETS,
    MAX_PRESET_NAME,
    moveListItem,
    nextPresetName,
    upsertPreset,
} from '../../shared/presets';
import {
    loadUserPresets,
    presetPins,
    saveUserPresets,
    type UserPreset,
} from '../../shared/storage';
import { FileArrowIcon, GripIcon, SaveIcon } from './Controls';

/** A rack as exported to a file, with the side panel pins when there are any. */
type RackFile = RackState & { pins?: string[] };

/**
 * Factory presets, user presets and files. User presets and files also keep the items pinned in
 * the side panel; loading one replaces the pins, and a preset without pins clears them.
 */
/** Drag data type of a preset being reordered in the menu. */
const PRESET_DRAG_TYPE = 'application/x-audiorack-preset';

/** Height limits of the open menu, and the room it leaves below it in the window. */
const MENU_MAX_HEIGHT = 430;
const MENU_MIN_HEIGHT = 160;
const MENU_MARGIN = 8;

export function PresetMenu({
    rack,
    pins,
    onLoad,
}: {
    rack: RackState;
    pins: string[];
    onLoad: (rack: RackState, pins: string[], name: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [current, setCurrent] = useState<string>('Custom');
    const [userPresets, setUserPresets] = useState<UserPreset[]>([]);
    const [error, setError] = useState<string>();
    const [naming, setNaming] = useState<string | undefined>(undefined);
    const ref = useRef<HTMLDivElement>(null);
    const menu = useRef<HTMLDivElement>(null);
    // Reordering your presets: the one being dragged, and where it would land (an insertion
    // point in the list).
    const dragFrom = useRef<number | undefined>(undefined);
    const [dropAt, setDropAt] = useState<number>();
    // The preset moved with the keyboard, to give it focus again in its new place.
    const refocus = useRef<string | undefined>(undefined);
    const fileInput = useRef<HTMLInputElement>(null);
    const nameInput = useRef<HTMLInputElement>(null);
    const nameShown = naming !== undefined;

    // Keep the menu within the window: in a short popup or side panel it scrolls instead of
    // running past the bottom edge, where the name field would be out of reach.
    useLayoutEffect(() => {
        const element = menu.current;
        if (!open || !element) {
            return;
        }
        const fit = () => {
            const room = window.innerHeight - element.getBoundingClientRect().top - MENU_MARGIN;
            element.style.maxHeight = `${Math.max(MENU_MIN_HEIGHT, Math.min(MENU_MAX_HEIGHT, room))}px`;
        };
        fit();
        window.addEventListener('resize', fit);
        return () => window.removeEventListener('resize', fit);
    }, [open]);

    // Select the suggested name so typing replaces it. The field stays at the bottom of the menu;
    // focusing it must not scroll the page, which would slide the header out of view.
    useEffect(() => {
        if (nameShown && open) {
            nameInput.current?.focus({ preventScroll: true });
            nameInput.current?.select();
            nameInput.current?.scrollIntoView({ block: 'nearest' });
        }
    }, [nameShown, open]);

    useEffect(() => {
        void loadUserPresets().then(setUserPresets);
    }, []);

    useEffect(() => {
        const name = refocus.current;
        refocus.current = undefined;
        if (name !== undefined) {
            menu.current
                ?.querySelector<HTMLButtonElement>(`[data-preset="${CSS.escape(name)}"]`)
                ?.focus();
        }
    }, [userPresets]);

    useEffect(() => {
        if (!open) {
            return;
        }
        const outside = (event: MouseEvent) => {
            if (!ref.current?.contains(event.target as Node)) {
                close();
            }
        };
        window.addEventListener('mousedown', outside);
        return () => window.removeEventListener('mousedown', outside);
    }, [open]);

    const persist = (presets: UserPreset[]) => {
        setUserPresets(presets);
        void saveUserPresets(presets);
    };

    // Pins of items that are no longer in the rack are left out.
    const currentPins = presetPins(rack, pins);

    /** Closes the menu and drops an unfinished preset name, so saving starts afresh next time. */
    const close = () => {
        setOpen(false);
        setNaming(undefined);
    };

    const load = (next: RackState, nextPins: string[], name: string) => {
        onLoad(next, nextPins, name);
        setCurrent(name);
        close();
    };

    const saveAs = (raw: string) => {
        const name = raw.trim().slice(0, MAX_PRESET_NAME);
        setNaming(undefined);
        if (!name) {
            return;
        }
        const preset: UserPreset =
            currentPins.length > 0 ? { name, rack, pins: currentPins } : { name, rack };
        persist(upsertPreset(userPresets, preset));
        setCurrent(name);
        close();
    };

    /** Moves your preset at `from` to the insertion point `to`, and saves the new order. */
    const reorder = (from: number, to: number) => {
        const next = moveListItem(userPresets, from, to);
        if (next !== userPresets) {
            persist(next);
        }
    };

    const endDrag = () => {
        dragFrom.current = undefined;
        setDropAt(undefined);
    };

    const startSaving = () => {
        setNaming(
            nextPresetName(current === 'Custom' ? undefined : current, [
                ...FACTORY_PRESETS.map((preset) => preset.name),
                ...userPresets.map((preset) => preset.name),
            ]),
        );
        setOpen(true);
    };

    const exportRack = () => {
        const file: RackFile = currentPins.length > 0 ? { ...rack, pins: currentPins } : rack;
        const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${current.replace(/[^\w-]+/g, '_') || 'audiorack'}.audiorack.json`;
        link.click();
        URL.revokeObjectURL(url);
        close();
    };

    const importRack = async (file: File) => {
        try {
            const parsed: unknown = JSON.parse(await file.text());
            const next = normalizeRack(parsed);
            const nextPins =
                typeof parsed === 'object' && parsed !== null
                    ? presetPins(next, (parsed as { pins?: unknown }).pins)
                    : [];
            load(next, nextPins, file.name.replace(/\.audiorack\.json$|\.json$/i, ''));
            setError(undefined);
        } catch (_) {
            setError('That file is not a valid AudioRack preset.');
        }
    };

    return (
        <div className="preset-menu" ref={ref}>
            <button
                type="button"
                className="preset-button"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => (open ? close() : setOpen(true))}
            >
                <span className="preset-caption">Preset</span>
                <span className="preset-name">{current}</span>
                <span className="caret">▾</span>
            </button>
            <div className="preset-actions">
                <button
                    type="button"
                    className="ghost icon"
                    onClick={startSaving}
                    title="Save as a preset"
                    aria-label="Save as a preset"
                >
                    <SaveIcon />
                </button>
                <button
                    type="button"
                    className="ghost icon"
                    onClick={exportRack}
                    title="Export the rack to a file"
                    aria-label="Export the rack to a file"
                >
                    <FileArrowIcon />
                </button>
                <button
                    type="button"
                    className="ghost icon"
                    onClick={() => fileInput.current?.click()}
                    title="Import a rack from a file"
                    aria-label="Import a rack from a file"
                >
                    <FileArrowIcon up />
                </button>
            </div>
            {error && <span className="preset-error">{error}</span>}
            {open && (
                <div className="menu preset-list" role="menu" ref={menu}>
                    <div className="menu-heading">Factory</div>
                    {FACTORY_PRESETS.map((preset) => (
                        <button
                            type="button"
                            role="menuitem"
                            key={preset.name}
                            className="menu-item"
                            onClick={() => load(preset.create(), [], preset.name)}
                        >
                            <span className="menu-item-text">
                                <strong>{preset.name}</strong>
                                <small>{preset.description}</small>
                            </span>
                        </button>
                    ))}
                    {userPresets.length > 0 && <div className="menu-heading">Yours</div>}
                    {userPresets.map((preset, index) => (
                        <div
                            className={[
                                'menu-item-row',
                                'reorderable',
                                dropAt === index ? 'drop-before' : '',
                                dropAt === userPresets.length && index === userPresets.length - 1
                                    ? 'drop-after'
                                    : '',
                            ].join(' ')}
                            key={preset.name}
                            draggable
                            title="Drag to reorder · Alt+↑/↓ to move"
                            onDragStart={(event) => {
                                dragFrom.current = index;
                                event.dataTransfer.effectAllowed = 'move';
                                event.dataTransfer.setData(PRESET_DRAG_TYPE, preset.name);
                            }}
                            onDragOver={(event) => {
                                if (dragFrom.current === undefined) {
                                    return;
                                }
                                event.preventDefault();
                                event.dataTransfer.dropEffect = 'move';
                                const box = event.currentTarget.getBoundingClientRect();
                                const at =
                                    event.clientY < box.top + box.height / 2 ? index : index + 1;
                                if (at !== dropAt) {
                                    setDropAt(at);
                                }
                            }}
                            onDrop={(event) => {
                                event.preventDefault();
                                if (dragFrom.current !== undefined && dropAt !== undefined) {
                                    reorder(dragFrom.current, dropAt);
                                }
                                endDrag();
                            }}
                            onDragEnd={endDrag}
                        >
                            <span className="drag-grip">
                                <GripIcon />
                            </span>
                            <button
                                type="button"
                                role="menuitem"
                                className="menu-item"
                                data-preset={preset.name}
                                onClick={() => load(preset.rack, preset.pins ?? [], preset.name)}
                                onKeyDown={(event) => {
                                    const step =
                                        event.altKey && event.key === 'ArrowUp'
                                            ? -1
                                            : event.altKey && event.key === 'ArrowDown'
                                              ? 2
                                              : 0;
                                    if (step !== 0) {
                                        event.preventDefault();
                                        refocus.current = preset.name;
                                        reorder(index, index + step);
                                    }
                                }}
                            >
                                <span className="menu-item-text">
                                    <strong>{preset.name}</strong>
                                    <small>{countEffects(preset.rack.chain)} effects</small>
                                </span>
                            </button>
                            <button
                                type="button"
                                className="ghost danger small"
                                aria-label={`Delete preset ${preset.name}`}
                                onClick={() =>
                                    persist(userPresets.filter((item) => item.name !== preset.name))
                                }
                            >
                                ×
                            </button>
                        </div>
                    ))}
                    {naming !== undefined && (
                        <form
                            className="menu-save"
                            onSubmit={(event) => {
                                event.preventDefault();
                                saveAs(naming);
                            }}
                        >
                            <input
                                ref={nameInput}
                                aria-label="Preset name"
                                value={naming}
                                maxLength={MAX_PRESET_NAME}
                                onChange={(event) => setNaming(event.target.value)}
                                onKeyDown={(event) =>
                                    event.key === 'Escape' && setNaming(undefined)
                                }
                            />
                            <button type="submit" className="ghost">
                                Save
                            </button>
                        </form>
                    )}
                </div>
            )}
            <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                        void importRack(file);
                    }
                    event.target.value = '';
                }}
            />
        </div>
    );
}
