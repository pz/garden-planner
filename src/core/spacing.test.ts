import { describe, expect, it } from 'vitest';
import type { PlantInstance } from '../types';
import { conflictKey, findOverlapConflicts, findSpacingConflicts } from './spacing';

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
});
