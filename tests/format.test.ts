import { describe, expect, it } from 'vitest';
import { shortTabTitle } from '../src/ui/format';

describe('shortTabTitle', () => {
    it('drops unread counts and trailing site names', () => {
        expect(shortTabTitle('(3) Lofi beats to relax - YouTube')).toBe('Lofi beats to relax');
        expect(shortTabTitle('Daily Mix 1 | Spotify')).toBe('Daily Mix 1');
        expect(shortTabTitle('Track – Artist – SoundCloud')).toBe('Track');
    });

    it('keeps titles it cannot shorten', () => {
        expect(shortTabTitle('Radio Paradise')).toBe('Radio Paradise');
        expect(shortTabTitle('A-ha - Take On Me')).toBe('A-ha');
        expect(shortTabTitle('TV - Live stream')).toBe('TV - Live stream');
        expect(shortTabTitle('')).toBe('');
    });
});
