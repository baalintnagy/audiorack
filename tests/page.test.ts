import { describe, expect, it } from 'vitest';
import { pagePath, parsePageParams } from '../src/ui/page';

describe('rack page parameters', () => {
    it('round-trips a tab and an item', () => {
        const path = pagePath({ tabId: 42, itemId: 'fx-1' });
        expect(path).toBe('rack.html?tab=42&item=fx-1');
        expect(parsePageParams(path.slice(path.indexOf('?')))).toEqual({
            tabId: 42,
            itemId: 'fx-1',
            sidePanel: false,
        });
    });

    it('marks the rack docked in the side panel', () => {
        const path = pagePath({ tabId: 7, sidePanel: true });
        expect(path).toBe('rack.html?tab=7&panel=side');
        expect(parsePageParams(path.slice(path.indexOf('?')))).toEqual({
            tabId: 7,
            itemId: undefined,
            sidePanel: true,
        });
    });

    it('describes the toolbar popup without parameters', () => {
        expect(pagePath({})).toBe('rack.html');
        expect(parsePageParams('')).toEqual({
            tabId: undefined,
            itemId: undefined,
            sidePanel: false,
        });
    });

    it('ignores malformed values', () => {
        expect(parsePageParams('?tab=-1&item=&panel=bottom')).toEqual({
            tabId: undefined,
            itemId: undefined,
            sidePanel: false,
        });
        expect(parsePageParams('?tab=12abc').tabId).toBeUndefined();
    });
});
