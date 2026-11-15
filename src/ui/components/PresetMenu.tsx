import { useEffect, useRef, useState } from 'react';
import { countEffects } from '../../shared/chain';
import type { RackState } from '../../shared/effects';
import { normalizeRack } from '../../shared/normalize';
import { FACTORY_PRESETS } from '../../shared/presets';
import { loadUserPresets, saveUserPresets, type UserPreset } from '../../shared/storage';

export function PresetMenu({
    rack,
    onLoad,
}: {
    rack: RackState;
    onLoad: (rack: RackState, name: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [current, setCurrent] = useState<string>('Custom');
    const [userPresets, setUserPresets] = useState<UserPreset[]>([]);
    const [error, setError] = useState<string>();
    const [naming, setNaming] = useState<string | undefined>(undefined);
    const ref = useRef<HTMLDivElement>(null);
    const fileInput = useRef<HTMLInputElement>(null);

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

    const load = (next: RackState, name: string) => {
        onLoad(next, name);
        setCurrent(name);
        setOpen(false);
    };

    const saveAs = (raw: string) => {
        const name = raw.trim().slice(0, 60);
        setNaming(undefined);
        if (!name) {
            return;
        }
        persist([...userPresets.filter((preset) => preset.name !== name), { name, rack }]);
        setCurrent(name);
        setOpen(false);
    };

    const exportRack = () => {
        const blob = new Blob([JSON.stringify(rack, null, 2)], { type: 'application/json' });
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
            load(normalizeRack(parsed), file.name.replace(/\.audiorack\.json$|\.json$/i, ''));
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
                            onClick={() => load(preset.create(), preset.name)}
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
                                onClick={() => load(preset.rack, preset.name)}
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
                                autoFocus
                                aria-label="Preset name"
                                value={naming}
                                maxLength={60}
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
                    <div className="menu-actions">
                        <button
                            type="button"
                            className="ghost"
                            onClick={() => setNaming(current === 'Custom' ? 'My preset' : current)}
                        >
                            Save as…
                        </button>
                        <button type="button" className="ghost" onClick={exportRack}>
                            Export
                        </button>
                        <button
                            type="button"
                            className="ghost"
                            onClick={() => fileInput.current?.click()}
                        >
                            Import
                        </button>
                    </div>
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
