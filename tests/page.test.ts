import { describe, expect, it } from 'vitest';
import { pagePath, parsePageParams } from '../src/ui/page';

describe('rack page parameters', () => {
    it('round-trips a tab and an item', () => {
        const path = pagePath({ tabId: 42, itemId: 'fx-1' });
        expect(path).toBe('rack.html?tab=42&item=fx-1');
        expect(parsePageParams(path.slice(path.indexOf('?')))).toEqual({
            tabId: 42,
            itemId: 'fx-1',
        });
    });

    it('describes the toolbar popup without parameters', () => {
        expect(pagePath({})).toBe('rack.html');
        expect(parsePageParams('')).toEqual({ tabId: undefined, itemId: undefined });
    });

    it('ignores malformed values', () => {
        expect(parsePageParams('?tab=-1&item=')).toEqual({ tabId: undefined, itemId: undefined });
        expect(parsePageParams('?tab=12abc').tabId).toBeUndefined();
    });
});
