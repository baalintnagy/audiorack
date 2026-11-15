import { defaultRack, type RackState } from '../shared/effects';
import type { RackScope } from '../shared/storage';

/** Decides which rack each processed tab plays through. */
export class RackRouting {
    private shared: RackState = defaultRack();
    private readonly own = new Map<number, RackState>();

    /**
     * Records a rack for `tabId` and returns the tabs whose rack changed: only that tab for a
     * rack of its own, every tab following the shared rack otherwise.
     */
    assign(tabId: number, rack: RackState, scope: RackScope, tabs: Iterable<number>): number[] {
        if (scope === 'tab') {
            this.own.set(tabId, rack);
            return [tabId];
        }
        this.own.delete(tabId);
        this.shared = rack;
        return [...tabs].filter((tab) => !this.own.has(tab));
    }

    rackFor(tabId: number): RackState {
        return this.own.get(tabId) ?? this.shared;
    }

    forget(tabId: number) {
        this.own.delete(tabId);
    }
}
