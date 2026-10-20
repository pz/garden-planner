import { describe, expect, it } from 'vitest';
import type { PlantInstance } from '../types';
import { HARD_SPACING_FACTOR, conflictKey, duplicateSpot, findOverlapConflicts, findSpacingConflicts, fitsAt } from './spacing';
import { rectOutline } from './geometry';

function plant(overrides: Partial<PlantInstance> & Pick<PlantInstance, 'id' | 'cropId' | 'x' | 'y'>): PlantInstance {
  return { groupId: overrides.id, bedId: 'b1', ...overrides };
}

describe('conflictKey', () => {
  it('is order-independent', () => {
    expect(conflictKey('a', 'b')).toBe(conflictKey('b', 'a'));
  });
});

describe('findOverlapConflicts', () => {
  it('returns no conflicts for a single plant', () => {
    const plants = [plant({ id: 'a', cropId: 'tomato', x: 10, y: 10, groupId: 'g1' })];
    expect(findOverlapConflicts(plants)).toEqual([]);
  });

  it('flags two entities of different groups closer than their required gap', () => {
    // tomato spacing 24in, basil spacing 12in -> required gap = (24+12)/2 = 18in
    const plants = [
      plant({ id: 'a', cropId: 'tomato', x: 0, y: 0, groupId: 'g1' }),
      plant({ id: 'b', cropId: 'basil', x: 10, y: 0, groupId: 'g2' }),
    ];
    expect(findOverlapConflicts(plants)).toEqual([{ a: 'g1', b: 'g2' }]);
  });

  it('does not flag entities exactly at or beyond the required gap', () => {
    const plants = [
      plant({ id: 'a', cropId: 'tomato', x: 0, y: 0, groupId: 'g1' }),
      plant({ id: 'b', cropId: 'basil', x: 18, y: 0, groupId: 'g2' }),
    ];
    expect(findOverlapConflicts(plants)).toEqual([]);
  });

  it('never flags plants in different beds, even at the same local coordinates', () => {
    const plants = [
      plant({ id: 'a', cropId: 'tomato', x: 5, y: 5, groupId: 'g1', bedId: 'b1' }),
      plant({ id: 'b', cropId: 'tomato', x: 5, y: 5, groupId: 'g2', bedId: 'b2' }),
    ];
    expect(findOverlapConflicts(plants)).toEqual([]);
  });

  it('never flags members of the same patch against each other, regardless of distance', () => {
    const plants = [
      plant({ id: 'a', cropId: 'carrot', x: 0, y: 0, groupId: 'patch-1' }),
      plant({ id: 'b', cropId: 'carrot', x: 1, y: 0, groupId: 'patch-1' }),
    ];
    expect(findOverlapConflicts(plants)).toEqual([]);
  });

  it('reports one conflict per group pair even when several members are close', () => {
    const plants = [
      plant({ id: 'a', cropId: 'carrot', x: 0, y: 0, groupId: 'patch' }),
      plant({ id: 'b', cropId: 'carrot', x: 3, y: 0, groupId: 'patch' }),
      plant({ id: 'c', cropId: 'tomato', x: 5, y: 0, groupId: 'solo' }), // close to both patch members
    ];
    const conflicts = findOverlapConflicts(plants);
    expect(conflicts).toEqual([{ a: 'patch', b: 'solo' }]);
  });

  it('flags an entity that is too close to any one of several neighbors', () => {
    const plants = [
      plant({ id: 'a', cropId: 'lettuce', x: 0, y: 0, groupId: 'g1' }),
      plant({ id: 'b', cropId: 'lettuce', x: 100, y: 100, groupId: 'g2' }), // far away, fine
      plant({ id: 'c', cropId: 'lettuce', x: 1, y: 0, groupId: 'g3' }), // too close to a
    ];
    const conflicts = findOverlapConflicts(plants);
    expect(conflicts).toEqual([{ a: 'g1', b: 'g3' }]);
  });
});

describe('fitsAt', () => {
  const bedW = 96;
  const bedH = 48;

  it('accepts a placement well inside the bed with no neighbors', () => {
    expect(fitsAt(48, 24, 24, rectOutline(bedW, bedH), [])).toBe(true);
  });

  it('accepts a placement near an edge as long as its own center stays in the bed', () => {
    // spacing ring (r=12) would overflow the left/top edge, but only the center matters.
    expect(fitsAt(5, 24, 24, rectOutline(bedW, bedH), [])).toBe(true);
    expect(fitsAt(48, 5, 24, rectOutline(bedW, bedH), [])).toBe(true);
  });

  it('rejects a placement whose center itself would leave the bed', () => {
    expect(fitsAt(-1, 24, 24, rectOutline(bedW, bedH), [])).toBe(false);
    expect(fitsAt(48, bedH + 1, 24, rectOutline(bedW, bedH), [])).toBe(false);
  });

  it('accepts a placement exactly flush with an edge', () => {
    expect(fitsAt(0, 24, 24, rectOutline(bedW, bedH), [])).toBe(true);
    expect(fitsAt(bedW, 24, 24, rectOutline(bedW, bedH), [])).toBe(true);
  });

  it('rejects a placement in a rounded corner past the arc, but accepts one on the straight edge beside it', () => {
    expect(fitsAt(0, 0, 24, rectOutline(bedW, bedH, 4), [])).toBe(false);
    expect(fitsAt(bedW, bedH, 24, rectOutline(bedW, bedH, 4), [])).toBe(false);
    expect(fitsAt(4, 0, 24, rectOutline(bedW, bedH, 4), [])).toBe(true);
  });

  it('rejects a new plant that would crowd an existing one', () => {
    const existing = [plant({ id: 'a', cropId: 'tomato', x: 48, y: 24 })];
    expect(fitsAt(48.1, 24, 24, rectOutline(bedW, bedH), existing)).toBe(false);
  });

  it('accepts a new plant placed far enough from existing ones', () => {
    const existing = [plant({ id: 'a', cropId: 'tomato', x: 48, y: 24 })];
    expect(fitsAt(80, 24, 24, rectOutline(bedW, bedH), existing)).toBe(true);
  });
});

describe('fitsAt with a non-rectangular outline', () => {
  it('rejects a spot inside the bounding box but outside an ellipse', () => {
    const ellipse = { shape: 'ellipse' as const, widthIn: 96, heightIn: 48 };
    expect(fitsAt(48, 24, 12, ellipse, [])).toBe(true);
    expect(fitsAt(2, 2, 12, ellipse, [])).toBe(false);
  });
});

describe('findSpacingConflicts', () => {
  // tomato 24in + basil 12in -> required gap 18in; 0.7 × 18 = 12.6in
  const pair = (distance: number) => [
    plant({ id: 'a', cropId: 'tomato', x: 0, y: 0, groupId: 'g1' }),
    plant({ id: 'b', cropId: 'basil', x: distance, y: 0, groupId: 'g2' }),
  ];

  it('reports distance, required gap, bed and crops for a conflict', () => {
    expect(findSpacingConflicts(pair(10))).toEqual([
      { a: 'g1', b: 'g2', bedId: 'b1', distanceIn: 10, requiredGapIn: 18, cropIds: ['tomato', 'basil'] },
    ]);
  });

  it('is not a conflict exactly at the required gap, and is one just inside it', () => {
    expect(findSpacingConflicts(pair(18))).toEqual([]);
    expect(findSpacingConflicts(pair(17.99))).toHaveLength(1);
  });

  it('keeps the closest approach of a patch to a neighbor as the representative', () => {
    const plants = [
      plant({ id: 'a', cropId: 'tomato', x: 0, y: 0, groupId: 'g1' }),
      plant({ id: 'c1', cropId: 'basil', x: 16, y: 0, groupId: 'g2' }),
      plant({ id: 'c2', cropId: 'basil', x: 6, y: 0, groupId: 'g2' }),
      plant({ id: 'c3', cropId: 'basil', x: 17, y: 0, groupId: 'g2' }),
    ];
    const [conflict, ...rest] = findSpacingConflicts(plants);
    expect(rest).toEqual([]);
    expect(conflict.distanceIn).toBe(6);
  });

  it('orders a and b canonically and keeps crop ids aligned with them', () => {
    const plants = [
      plant({ id: 'a', cropId: 'basil', x: 0, y: 0, groupId: 'z' }),
      plant({ id: 'b', cropId: 'tomato', x: 5, y: 0, groupId: 'm' }),
    ];
    expect(findSpacingConflicts(plants)[0]).toMatchObject({ a: 'm', b: 'z', cropIds: ['tomato', 'basil'] });
  });

  it('ignores plants in different beds and members of one patch', () => {
    const plants = [
      plant({ id: 'a', cropId: 'tomato', x: 0, y: 0, groupId: 'g1', bedId: 'b1' }),
      plant({ id: 'b', cropId: 'tomato', x: 1, y: 0, groupId: 'g2', bedId: 'b2' }),
      plant({ id: 'c', cropId: 'tomato', x: 1, y: 1, groupId: 'g1', bedId: 'b1' }),
    ];
    expect(findSpacingConflicts(plants)).toEqual([]);
  });

  it('agrees with fitsAt: the planting UI refuses exactly the placements below HARD_SPACING_FACTOR of the gap', () => {
    const outline = rectOutline(96, 48);
    const existing = [plant({ id: 'a', cropId: 'tomato', x: 40, y: 24 })];
    const refusedAt = (d: number) => !fitsAt(40 + d, 24, 12, outline, existing); // basil is 12in
    expect(refusedAt(18 * HARD_SPACING_FACTOR - 0.01)).toBe(true);
    expect(refusedAt(18 * HARD_SPACING_FACTOR)).toBe(false);
  });
});

describe('duplicateSpot', () => {
  const outline = rectOutline(96, 48);

  it('puts the copy 0.8 spacings to the right of the original', () => {
    const original = plant({ id: 'a', cropId: 'kale', x: 20, y: 24 }); // kale spacing 18 in
    expect(duplicateSpot(original, outline, [original])).toEqual({ x: 20 + 14.4, y: 24 });
  });

  it('pulls the copy back inside the bed when the original is near the edge', () => {
    const original = plant({ id: 'a', cropId: 'kale', x: 90, y: 24 });
    // Nothing else in the bed: the only thing that moves the spot from 90 + 14.4 is the bed's edge.
    expect(duplicateSpot(original, outline, [])).toEqual({ x: 96, y: 24 });
    // With the original counted, 6 in away is too close (kale refuses within 0.7 × 18 = 12.6 in).
    expect(duplicateSpot(original, outline, [original])).toBeNull();
  });

  it('is null when the spot is too close to another plant, and fine just outside that distance', () => {
    const original = plant({ id: 'a', cropId: 'basil', x: 20, y: 24 }); // basil spacing 12: spot at x = 29.6
    // basil + basil gap is 12, refused below 0.7 × 12 = 8.4 in from the new spot.
    const near = plant({ id: 'n', cropId: 'basil', x: 29.6 + 8.39, y: 24 });
    const far = plant({ id: 'f', cropId: 'basil', x: 29.6 + 8.4, y: 24 });
    expect(duplicateSpot(original, outline, [original, near])).toBeNull();
    expect(duplicateSpot(original, outline, [original, far])).toEqual({ x: 29.6, y: 24 });
  });

  it('is null when the clamped spot lands on the original itself', () => {
    const original = plant({ id: 'a', cropId: 'kale', x: 96, y: 24 }); // can't move right at all
    expect(duplicateSpot(original, outline, [original])).toBeNull();
  });
});
