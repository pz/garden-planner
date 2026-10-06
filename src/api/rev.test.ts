import { describe, expect, it } from 'vitest';
import { createPlan } from '../core/reducer';
import { revOf, stableStringify } from './rev';

describe('stableStringify', () => {
  it('ignores key order at every level', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it('keeps array order, which is meaningful', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it('treats an undefined property like an absent one, as JSON does, and an undefined array item as null', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
    expect(stableStringify([undefined])).toBe('[null]');
  });
});

describe('revOf', () => {
  it('is a fixed-width hex token', () => {
    expect(revOf(createPlan('g'))).toMatch(/^[0-9a-f]{14}$/);
    expect(revOf('')).toMatch(/^[0-9a-f]{14}$/);
  });

  it('is equal for equal content regardless of key order', () => {
    const plan = { ...createPlan('g'), name: 'x' };
    const reversed = Object.fromEntries(Object.entries(plan).reverse());
    expect(Object.keys(reversed)).not.toEqual(Object.keys(plan));
    expect(revOf(reversed)).toBe(revOf(plan));
  });

  it('changes when anything changes, including a single coordinate or plant order', () => {
    const base = { ...createPlan('g'), plants: [
      { id: 'a', bedId: 'bed-1', cropId: 'tomato', x: 1, y: 2, groupId: 'a' },
      { id: 'b', bedId: 'bed-1', cropId: 'kale', x: 5, y: 2, groupId: 'b' },
    ] };
    const moved = { ...base, plants: [{ ...base.plants[0], x: 1.5 }, base.plants[1]] };
    const swapped = { ...base, plants: [base.plants[1], base.plants[0]] };
    const revs = new Set([revOf(base), revOf(moved), revOf(swapped), revOf({ ...base, name: 'other' })]);
    expect(revs.size).toBe(4);
  });
});
