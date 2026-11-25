import { useEffect, useRef, useState } from 'react';
import { countEffects } from '../../shared/chain';
import type { RackState } from '../../shared/effects';
import { normalizeRack } from '../../shared/normalize';
import { FACTORY_PRESETS, MAX_PRESET_NAME, nextPresetName } from '../../shared/presets';
import {
    loadUserPresets,
    presetPins,
    saveUserPresets,
    type UserPreset,
} from '../../shared/storage';
import { FileArrowIcon, SaveIcon } from './Controls';

/** A rack as exported to a file, with the side panel pins when there are any. */
type RackFile = RackState & { pins?: string[] };

/**
 * Factory presets, user presets and files. User presets and files also keep the items pinned in
 * the side panel; loading one replaces the pins, and a preset without pins clears them.
 */
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
    const fileInput = useRef<HTMLInputElement>(null);
    const nameInput = useRef<HTMLInputElement>(null);
    const nameShown = naming !== undefined;

    // Select the suggested name so typing replaces it.
    useEffect(() => {
        if (nameShown) {
            nameInput.current?.focus();
            nameInput.current?.select();
        }
    }, [nameShown]);

    useEffect(() => {
        void loadUserPresets().then(setUserPresets);
    }, []);

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

    const persist = (presets: UserPreset[]) => {
        setUserPresets(presets);
        void saveUserPresets(presets);
    };

    // Pins of items that are no longer in the rack are left out.
    const currentPins = presetPins(rack, pins);

    const load = (next: RackState, nextPins: string[], name: string) => {
        onLoad(next, nextPins, name);
        setCurrent(name);
        setOpen(false);
    };

    const saveAs = (raw: string) => {
        const name = raw.trim().slice(0, MAX_PRESET_NAME);
        setNaming(undefined);
        if (!name) {
            return;
        }
        const preset: UserPreset =
            currentPins.length > 0 ? { name, rack, pins: currentPins } : { name, rack };
        persist([...userPresets.filter((item) => item.name !== name), preset]);
        setCurrent(name);
        setOpen(false);
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
        setOpen(false);
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
                onClick={() => setOpen(!open)}
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
                <div className="menu preset-list" role="menu">
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
                    {userPresets.map((preset) => (
                        <div className="menu-item-row" key={preset.name}>
                            <button
                                type="button"
                                role="menuitem"
                                className="menu-item"
                                onClick={() => load(preset.rack, preset.pins ?? [], preset.name)}
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
