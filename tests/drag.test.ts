import { describe, expect, it } from 'vitest';
import { dropIndex, isNoOpMove } from '../src/ui/useChainDrag';

describe('chain drag targets', () => {
    const centers = [100, 200, 300];

    it('inserts after every item left of the pointer', () => {
        expect(dropIndex(centers, 20)).toBe(0);
        expect(dropIndex(centers, 150)).toBe(1);
        expect(dropIndex(centers, 299)).toBe(2);
        // Past the last item, such as over the add button or in a gap: the end of the lane.
        expect(dropIndex(centers, 500)).toBe(3);
        expect(dropIndex([], 50)).toBe(0);
    });

    it('recognizes drops that leave the item in place', () => {
        const branch = { groupId: 'g', branchId: 'b' };
        expect(isNoOpMove({ index: 1 }, { index: 1 })).toBe(true);
        expect(isNoOpMove({ index: 1 }, { index: 2 })).toBe(true);
        expect(isNoOpMove({ index: 1 }, { index: 3 })).toBe(false);
        expect(isNoOpMove({ index: 1 }, { index: 0 })).toBe(false);
        expect(isNoOpMove({ index: 1 }, { branch, index: 1 })).toBe(false);
        expect(isNoOpMove({ branch, index: 0 }, { branch, index: 1 })).toBe(true);
    });
});
