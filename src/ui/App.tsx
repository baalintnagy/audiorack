import { useEffect, useRef, useState } from 'react';
import {
    countEffects,
    findItem,
    insertionPoint,
    panelOrder,
    type ChainPosition,
} from '../shared/chain';
import {
    SPECS,
    createEffect,
    createParallelGroup,
    type ChainItem,
    type Effect,
} from '../shared/effects';
import { MAX_CHAIN_LENGTH } from '../shared/normalize';
import { createBackend, type Backend, type BackendStatus } from './backend';
import { AddMenu, type AddKind } from './components/AddMenu';
import { ChainStrip } from './components/ChainStrip';
import { PopOutIcon, PowerIcon, Segmented, SidePanelIcon, Toggle } from './components/Controls';
import { ItemPanel } from './components/ItemPanel';
import { Knob } from './components/Knob';
import { LevelMeter } from './components/Meters';
import { PresetMenu } from './components/PresetMenu';
import { ItemWindow } from './ItemWindow';
import { pageParams } from './page';
import { TelemetryContext } from './telemetry';
import { useEngine } from './useEngine';
import { usePanelPins } from './usePanelPins';
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

/** A single browser tab. */
function ThisTabIcon() {
    return (
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path
                d="M1.5 13.5V5.5h5l1-2h3.5v2h3.5v8z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
            />
        </svg>
    );
}

/** A stack of browser tabs. */
function AllTabsIcon() {
    return (
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path
                d="M1.5 14.5v-6h4l.8-1.5h3v1.5h3v6z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
            />
            <path
                d="M3.5 5V3.5h3l.8-1.5h3v1.5h4.2V11H13.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
            />
        </svg>
    );
}

export function App() {
    const [backend, setBackend] = useState<Backend>();

    useEffect(() => {
        void createBackend().then(setBackend);
    }, []);

    if (!backend) {
        return <div className="loading">Loading rack…</div>;
    }
    // Only backends that can open item windows show them; elsewhere the page is the whole rack.
    const { itemId } = pageParams();
    if (itemId !== undefined && backend.popOutItem) {
        return <ItemWindow backend={backend} itemId={itemId} />;
    }
    return <RackWindow backend={backend} />;
}

function RackWindow({ backend }: { backend: Backend }) {
    const { status, setStatus, store } = useEngine(backend);
    const { rack, scope, canScopeToTab, actions } = useRack(backend);
    const [busy, setBusy] = useState(false);
    const [selectedId, setSelectedId] = useState<string>();
    // Counts picks in the chain strip, so picking the selected item again still scrolls to it.
    const [picks, setPicks] = useState(0);
    const fileInput = useRef<HTMLInputElement>(null);
    const isPopup = backend.kind === 'extension' && pageParams().tabId === undefined;
    const isSidePanel = pageParams().sidePanel === true;
    // Outside the extension there is no tab; the demo pins under a placeholder id. Every rack
    // window of the tab reads the pins, so presets can save and restore them, but only the side
    // panel shows them.
    const { pins, toggle: togglePin, replace: replacePins } = usePanelPins(backend.tabId ?? -1);

    useEffect(() => {
        document.documentElement.classList.toggle('popup', isPopup);
        document.documentElement.classList.toggle('side-panel', isSidePanel);
    }, [isPopup, isSidePanel]);

    // With several panels open, scroll the one picked in the chain strip to the top, just below
    // the chain strip that stays at the top of the side panel.
    useEffect(() => {
        const main = document.querySelector<HTMLElement>('.main.stacked');
        if (selectedId === undefined || !main) {
            return;
        }
        const frame = main.querySelector<HTMLElement>('.chain-frame');
        main.style.setProperty('--chain-height', `${frame?.offsetHeight ?? 0}px`);
        main.querySelector(`.panel[data-item-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({
            block: 'start',
            behavior: 'smooth',
        });
    }, [selectedId, picks]);

    if (!rack) {
        return <div className="loading">Loading rack…</div>;
    }

    const selected: ChainItem | undefined =
        (selectedId === undefined ? undefined : findItem(rack.chain, selectedId)) ?? rack.chain[0];

    // In the side panel, pinned items stay open with the selection placed among them, all in
    // chain order. Panels there keep their stacked size even when only one is open.
    const known = (id: string) => findItem(rack.chain, id) !== undefined;
    const pinnedIds = new Set(isSidePanel ? panelOrder(rack.chain, pins) : []);
    const stacked = isSidePanel;
    const panels: (ChainItem | undefined)[] =
        pinnedIds.size > 0
            ? panelOrder(rack.chain, [...pinnedIds, selected?.id]).map((id) =>
                  findItem(rack.chain, id),
              )
            : [selected];

    const select = (id: string) => {
        setSelectedId(id);
        setPicks((count) => count + 1);
    };

    const add = (kind: AddKind, position?: ChainPosition) => {
        const item: ChainItem =
            kind === 'parallel' ? createParallelGroup() : (createEffect(kind) as Effect);
        if (actions.addItem(item, position ?? insertionPoint(rack.chain, item, selected?.id))) {
            setSelectedId(item.id);
        }
    };

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
                        title={`${status.active ? 'Stop processing' : 'Process the audio of this tab'}${status.label ? `: ${status.label}` : ''}`}
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
                    <AddMenu
                        variant="header"
                        disabled={countEffects(rack.chain) >= MAX_CHAIN_LENGTH}
                        disabledReason={`The rack holds up to ${MAX_CHAIN_LENGTH} effects`}
                        onAdd={(kind) => add(kind)}
                    />
                    {canScopeToTab && (
                        <div className="scope-switch">
                            <Segmented
                                value={scope}
                                options={[
                                    {
                                        value: 'tab',
                                        label: 'This tab',
                                        icon: <ThisTabIcon />,
                                        title: 'This tab: a rack of its own, started from a copy of the All tabs rack',
                                    },
                                    {
                                        value: 'shared',
                                        label: 'All tabs',
                                        icon: <AllTabsIcon />,
                                        title: 'All tabs: follow the rack shared by every tab set to it',
                                    },
                                ]}
                                onChange={(next) => void actions.setScope(next)}
                            />
                        </div>
                    )}
                    <PresetMenu
                        rack={rack}
                        pins={pins}
                        onLoad={(next, nextPins) => {
                            actions.setRack(next);
                            replacePins(nextPins);
                        }}
                    />
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
                    {!isSidePanel && backend.dockToSidePanel && (
                        <button
                            type="button"
                            className="ghost icon"
                            onClick={() => backend.dockToSidePanel?.()}
                            title="Dock in the side panel"
                            aria-label="Dock in the side panel"
                        >
                            <SidePanelIcon />
                        </button>
                    )}
                    {(isPopup || isSidePanel) && backend.popOut && (
                        <button
                            type="button"
                            className="ghost icon"
                            onClick={() => backend.popOut?.()}
                            title="Open in a larger window"
                            aria-label="Open in a larger window"
                        >
                            <PopOutIcon />
                        </button>
                    )}
                </header>
                <div className="body">
                    <main className={`main ${stacked ? 'stacked' : ''}`}>
                        <ChainStrip
                            chain={rack.chain}
                            selectedId={selected?.id}
                            pinnedIds={pinnedIds}
                            full={countEffects(rack.chain) >= MAX_CHAIN_LENGTH}
                            handlers={{
                                onSelect: select,
                                onToggle: actions.toggleBypass,
                                onRemove: actions.removeItem,
                                onMove: actions.moveItem,
                                onAdd: add,
                            }}
                        />
                        {panels.map((item, index) => (
                            <ItemPanel
                                key={item?.id ?? 'empty'}
                                item={item}
                                selected={
                                    pinnedIds.size > 0 && item !== undefined && item === selected
                                }
                                placement={{
                                    kind: 'rack',
                                    onPopOut:
                                        backend.popOutItem && item
                                            ? () => void backend.popOutItem?.(item.id)
                                            : undefined,
                                    pin:
                                        isSidePanel && item
                                            ? {
                                                  pinned: pins.includes(item.id),
                                                  onToggle: () => togglePin(item.id, known),
                                              }
                                            : undefined,
                                }}
                                actions={actions}
                                hint={
                                    index > 0 || status.active
                                        ? undefined
                                        : backend.kind === 'local'
                                          ? 'Press “Play demo” to hear the rack'
                                          : 'Press “Process tab” to route this tab through the rack'
                                }
                            />
                        ))}
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
