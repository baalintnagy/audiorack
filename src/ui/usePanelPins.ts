import { useCallback, useEffect, useState } from 'react';
import { loadPanelPins, savePanelPins, subscribePanelPins } from '../shared/storage';

/**
 * The items pinned open in the tab's side panel. Pins belong to the tab, survive the panel being
 * hidden while another tab is active, and follow changes made by the tab's other pages: loading a
 * preset in the popup also replaces the pins of an open side panel.
 */
export function usePanelPins(tabId: number) {
    const [pins, setPins] = useState<string[]>([]);

    useEffect(() => {
        let current = true;
        void loadPanelPins(tabId).then((loaded) => {
            if (current) {
                setPins(loaded);
            }
        });
        const unsubscribe = subscribePanelPins(tabId, setPins);
        return () => {
            current = false;
            unsubscribe();
        };
    }, [tabId]);

    /** Replaces all pins, for example with those saved in a preset. */
    const replace = useCallback(
        (ids: string[]) => {
            setPins(ids);
            void savePanelPins(tabId, ids);
        },
        [tabId],
    );

    /** Pins or unpins `id`; `known` drops pins of items no longer in the rack. */
    const toggle = useCallback(
        (id: string, known: (id: string) => boolean) => {
            const kept = pins.filter((pin) => pin !== id && known(pin));
            replace(pins.includes(id) ? kept : [...kept, id]);
        },
        [pins, replace],
    );

    return { pins, toggle, replace };
}
