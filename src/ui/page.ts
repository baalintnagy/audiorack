/**
 * What a rack page shows, from its URL. Without parameters it is the toolbar popup for the
 * active tab; `tab` opens the whole rack of that tab in a window of its own, and `item` narrows
 * such a window to one effect or parallel group of the rack.
 */
export interface PageParams {
    tabId?: number;
    itemId?: string;
}

const PAGE = 'rack.html';

export function parsePageParams(search: string): PageParams {
    const params = new URLSearchParams(search);
    const tab = params.get('tab');
    const item = params.get('item');
    return {
        tabId: tab !== null && /^\d+$/.test(tab) ? Number(tab) : undefined,
        itemId: item || undefined,
    };
}

export function pageParams(): PageParams {
    return parsePageParams(location.search);
}

/** The path of the rack page showing `params`, relative to the extension root. */
export function pagePath({ tabId, itemId }: PageParams): string {
    const params = new URLSearchParams();
    if (tabId !== undefined) {
        params.set('tab', String(tabId));
    }
    if (itemId !== undefined) {
        params.set('item', itemId);
    }
    const query = params.toString();
    return query ? `${PAGE}?${query}` : PAGE;
}
