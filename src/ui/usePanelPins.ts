import { useCallback, useEffect, useState } from 'react';
import { loadPanelPins, savePanelPins } from '../shared/storage';

/**
 * The items pinned open in a side panel, below the selected one. Pins belong to the tab and
 * survive the panel being hidden while another tab is active. `tabId` is undefined where the
 * page cannot pin.
 */
export function usePanelPins(tabId: number | undefined) {
    const [pins, setPins] = useState<string[]>([]);

    useEffect(() => {
        if (tabId === undefined) {
            return;
        }
        let current = true;
        void loadPanelPins(tabId).then((loaded) => {
            if (current) {
                setPins(loaded);
            }
        });
        return () => {
            current = false;
        };
    }, [tabId]);

    /** Pins or unpins `id`; `known` drops pins of items no longer in the rack. */
    const toggle = useCallback(
        (id: string, known: (id: string) => boolean) => {
            if (tabId === undefined) {
                return;
            }
            const kept = pins.filter((pin) => pin !== id && known(pin));
            const next = pins.includes(id) ? kept : [...kept, id];
            setPins(next);
            void savePanelPins(tabId, next);
        },
        [tabId, pins],
    );

    return { pins, toggle };
}
