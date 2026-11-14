import { useEffect, useMemo, useRef, useState } from 'react';
import { EFFECT_INFO, SPECS, defaultParams, type Effect } from '../shared/effects';
import { createBackend, type Backend, type BackendStatus } from './backend';
import { ChainStrip } from './components/ChainStrip';
import { PowerIcon, Toggle } from './components/Controls';
import { Knob } from './components/Knob';
import { LevelMeter } from './components/Meters';
import { PresetMenu } from './components/PresetMenu';
import { EffectEditor } from './editors';
import { TelemetryContext, TelemetryStore } from './telemetry';
import { useRack } from './useRack';

function Logo() {
    return (
        <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
            <defs>
                <linearGradient id="logo-gradient" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#ffb347" />
                    <stop offset="1" stopColor="#ff5e7a" />
                </linearGradient>
            </defs>
            <rect x="1" y="1" width="30" height="30" rx="8" fill="#1a1e25" />
            <rect
                x="1"
                y="1"
                width="30"
                height="30"
                rx="8"
                fill="none"
                stroke="url(#logo-gradient)"
                strokeWidth="2"
            />
            <path
                d="M6 19 C9 19 9 9 12 9 S15 23 18 23 S21 13 24 13 S26 16 27 16"
                fill="none"
                stroke="url(#logo-gradient)"
                strokeWidth="2.4"
                strokeLinecap="round"
            />
        </svg>
    );
}

export function App() {
    const [backend, setBackend] = useState<Backend>();
    const store = useMemo(() => new TelemetryStore(), []);
    const [rack, actions] = useRack(backend);
    const [status, setStatus] = useState<BackendStatus>({ active: false, label: '' });
    const [busy, setBusy] = useState(false);
    const [selectedId, setSelectedId] = useState<string>();
    const fileInput = useRef<HTMLInputElement>(null);
    const isPopup =
        backend?.kind === 'extension' && !new URLSearchParams(location.search).has('tab');

    useEffect(() => {
        void createBackend().then(setBackend);
    }, []);

    useEffect(() => {
        document.documentElement.classList.toggle('popup', isPopup);
    }, [isPopup]);

    useEffect(() => {
        if (!backend) {
            return;
        }
        void backend.status().then(setStatus);
    }, [backend]);

    useEffect(() => {
        if (backend && status.active) {
            return backend.connect(store);
        }
        return undefined;
    }, [backend, status.active, store]);

    if (!backend || !rack) {
        return <div className="loading">Loading rack…</div>;
    }

    const selected = rack.chain.find((effect) => effect.id === selectedId) ?? rack.chain[0];

    const run = async (action: () => Promise<BackendStatus>) => {
        setBusy(true);
        try {
            setStatus(await action());
        } finally {
            setBusy(false);
        }
    };

    return (
        <TelemetryContext.Provider value={store}>
            <div className={`app ${rack.bypass ? 'rack-bypassed' : ''}`}>
                <header className="header">
                    <div className="brand">
                        <Logo />
                        <span className="brand-name">
                            Audio<strong>Rack</strong>
                        </span>
                    </div>
                    <button
                        type="button"
                        className={`capture ${status.active ? 'on' : ''}`}
                        disabled={busy}
                        onClick={() =>
                            run(() => (status.active ? backend.stop() : backend.start()))
                        }
                        title={status.active ? 'Stop processing' : 'Process the audio of this tab'}
                    >
                        <PowerIcon />
                        <span className="capture-text">
                            <span className="capture-state">
                                {status.active
                                    ? 'Processing'
                                    : backend.kind === 'local'
                                      ? 'Play demo'
                                      : 'Process tab'}
                            </span>
                            <span className="capture-label">{status.label}</span>
                        </span>
                    </button>
                    {backend.loadFile && (
                        <>
                            <button
                                type="button"
                                className="ghost"
                                onClick={() => fileInput.current?.click()}
                            >
                                Load audio…
                            </button>
                            <input
                                ref={fileInput}
                                type="file"
                                accept="audio/*"
                                hidden
                                onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (file && backend.loadFile) {
                                        void run(() => backend.loadFile!(file));
                                    }
                                    event.target.value = '';
                                }}
                            />
                        </>
                    )}
                    {status.error && (
                        <span className="status-error" title={status.error}>
                            {status.error}
                        </span>
                    )}
                    <div className="header-spacer" />
                    <PresetMenu rack={rack} onLoad={(next) => actions.setRack(next)} />
                    <Toggle
                        className="bypass-all"
                        active={rack.bypass}
                        onChange={(bypass) =>
                            actions.update((previous) => ({ ...previous, bypass }))
                        }
                        color="#ff5e7a"
                        title="Compare with the unprocessed signal"
                    >
                        Bypass
                    </Toggle>
                    {isPopup && backend.popOut && (
                        <button
                            type="button"
                            className="ghost icon"
                            onClick={() => backend.popOut?.()}
                            title="Open in a larger window"
                            aria-label="Open in a larger window"
                        >
                            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                                <path
                                    d="M9 2h5v5M14 2 7.5 8.5M12 9.5V14H2V4h4.5"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.6"
                                />
                            </svg>
                        </button>
                    )}
                </header>
                <div className="body">
                    <main className="main">
                        <ChainStrip
                            chain={rack.chain}
                            selectedId={selected?.id}
                            onSelect={setSelectedId}
                            onToggle={(id) =>
                                actions.updateEffect(id, (effect) => ({
                                    ...effect,
                                    bypass: !effect.bypass,
                                }))
                            }
                            onRemove={actions.removeEffect}
                            onMove={actions.moveEffect}
                            onAdd={(type) => {
                                const index = selected
                                    ? rack.chain.indexOf(selected) + 1
                                    : undefined;
                                const added = actions.addEffect(type, index);
                                if (added) {
                                    setSelectedId(added.id);
                                }
                            }}
                        />
                        <section
                            className={`panel ${selected?.bypass ? 'effect-bypassed' : ''}`}
                            style={
                                selected
                                    ? {
                                          ['--effect-color' as string]:
                                              EFFECT_INFO[selected.type].color,
                                      }
                                    : undefined
                            }
                        >
                            {selected ? (
                                <>
                                    <div className="panel-header">
                                        <span className="panel-title">
                                            {EFFECT_INFO[selected.type].label}
                                        </span>
                                        <span className="panel-description">
                                            {EFFECT_INFO[selected.type].description}
                                        </span>
                                        {selected.bypass && <span className="badge">Bypassed</span>}
                                        <div className="header-spacer" />
                                        <button
                                            type="button"
                                            className="ghost small"
                                            onClick={() =>
                                                actions.updateEffect(
                                                    selected.id,
                                                    (effect) =>
                                                        ({
                                                            ...effect,
                                                            params: defaultParams(effect.type),
                                                        }) as Effect,
                                                )
                                            }
                                        >
                                            Reset
                                        </button>
                                    </div>
                                    <EffectEditor
                                        key={selected.id}
                                        effect={selected}
                                        setParams={(patch) => actions.setParams(selected.id, patch)}
                                    />
                                </>
                            ) : (
                                <div className="empty">
                                    <p>The rack is empty.</p>
                                    <p>Use “+ Add” to insert an effect, or pick a preset.</p>
                                </div>
                            )}
                            {!status.active && (
                                <div className="idle-hint">
                                    {backend.kind === 'local'
                                        ? 'Press “Play demo” to hear the rack'
                                        : 'Press “Process tab” to route this tab through the rack'}
                                </div>
                            )}
                        </section>
                    </main>
                    <aside className="master">
                        <div className="master-meters">
                            <LevelMeter
                                label="IN"
                                source={(telemetry) => ({
                                    peak: telemetry.meters.inputPeak,
                                    rms: telemetry.meters.inputRms,
                                })}
                            />
                            <LevelMeter
                                label="OUT"
                                source={(telemetry) => ({
                                    peak: telemetry.meters.outputPeak,
                                    rms: telemetry.meters.outputRms,
                                })}
                            />
                        </div>
                        <Knob
                            spec={SPECS.masterDb}
                            label="Input"
                            value={rack.inputDb}
                            size={40}
                            onChange={(inputDb) =>
                                actions.update((previous) => ({ ...previous, inputDb }))
                            }
                        />
                        <Knob
                            spec={SPECS.masterDb}
                            label="Output"
                            value={rack.outputDb}
                            size={40}
                            onChange={(outputDb) =>
                                actions.update((previous) => ({ ...previous, outputDb }))
                            }
                        />
                    </aside>
                </div>
            </div>
        </TelemetryContext.Provider>
    );
}
