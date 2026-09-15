import { describe, expect, it } from 'vitest';
import type { PlantInstance } from '../types';
import { findOverlapWarnings, fitsAt } from './spacing';

function plant(overrides: Partial<PlantInstance> & Pick<PlantInstance, 'id' | 'cropId' | 'x' | 'y'>): PlantInstance {
  return { groupId: overrides.id, ...overrides };
}

describe('findOverlapWarnings', () => {
  it('returns no warnings for a single plant', () => {
    const plants = [plant({ id: 'a', cropId: 'tomato', x: 10, y: 10 })];
    expect(findOverlapWarnings(plants)).toEqual(new Set());
  });

  it('flags two plants of different groups closer than their required gap', () => {
    // tomato spacing 24in, basil spacing 12in -> required gap = (24+12)/2 = 18in
    const plants = [
      plant({ id: 'a', cropId: 'tomato', x: 0, y: 0 }),
      plant({ id: 'b', cropId: 'basil', x: 10, y: 0 }),
    ];
    expect(findOverlapWarnings(plants)).toEqual(new Set(['a', 'b']));
  });

  it('does not flag plants exactly at or beyond the required gap', () => {
    const plants = [
      plant({ id: 'a', cropId: 'tomato', x: 0, y: 0 }),
      plant({ id: 'b', cropId: 'basil', x: 18, y: 0 }),
    ];
    expect(findOverlapWarnings(plants)).toEqual(new Set());
  });

  it('never flags members of the same patch, regardless of distance', () => {
    const plants = [
      plant({ id: 'a', cropId: 'carrot', x: 0, y: 0, groupId: 'patch-1' }),
      plant({ id: 'b', cropId: 'carrot', x: 1, y: 0, groupId: 'patch-1' }),
    ];
    expect(findOverlapWarnings(plants)).toEqual(new Set());
  });

  it('flags a plant that is too close to any one of several neighbors', () => {
    const plants = [
      plant({ id: 'a', cropId: 'lettuce', x: 0, y: 0 }),
      plant({ id: 'b', cropId: 'lettuce', x: 100, y: 100 }), // far away, fine
      plant({ id: 'c', cropId: 'lettuce', x: 1, y: 0 }), // too close to a
    ];
    const warned = findOverlapWarnings(plants);
    expect(warned.has('a')).toBe(true);
    expect(warned.has('c')).toBe(true);
    expect(warned.has('b')).toBe(false);
  });
});

describe('fitsAt', () => {
  const bedW = 96;
  const bedH = 48;

  it('accepts a placement well inside the bed with no neighbors', () => {
    expect(fitsAt(48, 24, 24, bedW, bedH, [])).toBe(true);
  });

  it('rejects a placement that would cross the left/top edge', () => {
    expect(fitsAt(5, 24, 24, bedW, bedH, [])).toBe(false); // 5 - 12 < 0
    expect(fitsAt(48, 5, 24, bedW, bedH, [])).toBe(false); // 5 - 12 < 0
  });

  it('rejects a placement that would cross the right/bottom edge', () => {
    expect(fitsAt(90, 24, 24, bedW, bedH, [])).toBe(false); // 90 + 12 > 96
    expect(fitsAt(48, 44, 24, bedW, bedH, [])).toBe(false); // 44 + 12 > 48
  });

  it('accepts a placement exactly flush with an edge', () => {
    expect(fitsAt(12, 24, 24, bedW, bedH, [])).toBe(true); // 12 - 12 == 0
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
