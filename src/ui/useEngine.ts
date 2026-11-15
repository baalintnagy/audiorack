import { useEffect, useMemo, useState } from 'react';
import type { Backend, BackendStatus } from './backend';
import { TelemetryStore } from './telemetry';

export interface Engine {
    status: BackendStatus;
    setStatus: (status: BackendStatus) => void;
    /** Receives the engine's readings while it processes this page's tab. */
    store: TelemetryStore;
}

/** Follows whether the engine processes this page's tab, and streams its telemetry if so. */
export function useEngine(backend: Backend): Engine {
    const store = useMemo(() => new TelemetryStore(), []);
    const [status, setStatus] = useState<BackendStatus>({ active: false, label: '' });

    useEffect(() => {
        void backend.status().then(setStatus);
        return backend.watchStatus(setStatus);
    }, [backend]);

    useEffect(() => {
        if (status.active) {
            return backend.connect(store);
        }
        return undefined;
    }, [backend, status.active, store]);

    return { status, setStatus, store };
}
