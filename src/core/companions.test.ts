import { describe, expect, it } from 'vitest';
import type { PlantInstance } from '../types';
import { COMPANION_NEAR_IN, avoidanceBetween, findCompanionConflicts } from './companions';

const plant = (id: string, cropId: string, x: number, y = 10, over: Partial<PlantInstance> = {}): PlantInstance => ({ id, bedId: 'b1', cropId, x, y, groupId: id, ...over });

describe('avoidanceBetween', () => {
  it('finds a listed pair from either side, with its reason and evidence', () => {
    for (const [a, b] of [['beans', 'onion'], ['onion', 'beans']]) {
      expect(avoidanceBetween(a, b)).toMatchObject({ cropId: 'onion', evidence: 'anecdotal' });
    }
    expect(avoidanceBetween('beans', 'onion')?.reason).toBeTruthy();
  });

  it('is undefined for unlisted pairs, a crop with itself and unknown crops', () => {
    expect(avoidanceBetween('tomato', 'basil')).toBeUndefined();
    expect(avoidanceBetween('beans', 'beans')).toBeUndefined();
    expect(avoidanceBetween('beans', 'nope')).toBeUndefined();
  });
});

describe('findCompanionConflicts', () => {
  it('flags beans and onion that are close, naming the patches in canonical order', () => {
    const [c] = findCompanionConflicts([plant('o', 'onion', 0), plant('b', 'beans', 10)]);
    expect(c).toMatchObject({ a: 'b', b: 'o', bedId: 'b1', cropIds: ['beans', 'onion'], distanceIn: 10, evidence: 'anecdotal' });
    expect(c.reason).toBeTruthy();
  });

  it('counts as near only strictly inside the distance', () => {
    expect(findCompanionConflicts([plant('o', 'onion', 0), plant('b', 'beans', COMPANION_NEAR_IN - 0.01)])).toHaveLength(1);
    expect(findCompanionConflicts([plant('o', 'onion', 0), plant('b', 'beans', COMPANION_NEAR_IN)])).toEqual([]);
  });

  it('uses the closest pair of plants in two patches, and reports the pair once', () => {
    const plants = [plant('o1', 'onion', 0, 10, { groupId: 'o' }), plant('o2', 'onion', 20, 10, { groupId: 'o' }), plant('b', 'beans', 30)];
    const r = findCompanionConflicts(plants);
    expect(r).toHaveLength(1);
    expect(r[0].distanceIn).toBe(10);
  });

  it('ignores other beds, the same patch, and crops with nothing against each other', () => {
    expect(findCompanionConflicts([plant('o', 'onion', 0), plant('b', 'beans', 5, 10, { bedId: 'b2' })])).toEqual([]);
    expect(findCompanionConflicts([plant('o', 'onion', 0, 10, { groupId: 'g' }), plant('b', 'beans', 5, 10, { groupId: 'g' })])).toEqual([]);
    expect(findCompanionConflicts([plant('t', 'tomato', 0), plant('b', 'basil', 5)])).toEqual([]);
  });
});
