import { describe, expect, it } from 'vitest';
import type { PlantInstance } from '../types';
import { conflictKey, findOverlapConflicts, fitsAt } from './spacing';

function plant(overrides: Partial<PlantInstance> & Pick<PlantInstance, 'id' | 'cropId' | 'x' | 'y'>): PlantInstance {
  return { groupId: overrides.id, ...overrides };
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
    expect(fitsAt(48, 24, 24, bedW, bedH, [])).toBe(true);
  });

  it('accepts a placement near an edge as long as its own center stays in the bed', () => {
    // spacing ring (r=12) would overflow the left/top edge, but only the center matters.
    expect(fitsAt(5, 24, 24, bedW, bedH, [])).toBe(true);
    expect(fitsAt(48, 5, 24, bedW, bedH, [])).toBe(true);
  });

  it('rejects a placement whose center itself would leave the bed', () => {
    expect(fitsAt(-1, 24, 24, bedW, bedH, [])).toBe(false);
    expect(fitsAt(48, bedH + 1, 24, bedW, bedH, [])).toBe(false);
  });

  it('accepts a placement exactly flush with an edge', () => {
    expect(fitsAt(0, 24, 24, bedW, bedH, [])).toBe(true);
    expect(fitsAt(bedW, 24, 24, bedW, bedH, [])).toBe(true);
  });

  it('rejects a new plant that would crowd an existing one', () => {
    const existing = [plant({ id: 'a', cropId: 'tomato', x: 48, y: 24 })];
    expect(fitsAt(48.1, 24, 24, bedW, bedH, existing)).toBe(false);
  });

  it('accepts a new plant placed far enough from existing ones', () => {
    const existing = [plant({ id: 'a', cropId: 'tomato', x: 48, y: 24 })];
    expect(fitsAt(80, 24, 24, bedW, bedH, existing)).toBe(true);
  });
});
