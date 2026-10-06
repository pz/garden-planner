import { describe, expect, it } from 'vitest';
import type { GardenPlan, PlantInstance } from '../types';
import { createPlan } from '../core/reducer';
import { conflictKey } from '../core/spacing';
import { computeWarnings, diffWarnings } from './warnings';

const plant = (id: string, cropId: string, x: number, over: Partial<PlantInstance> = {}): PlantInstance => ({
  id,
  bedId: 'bed-1',
  cropId,
  x,
  y: 10,
  groupId: id,
  ...over,
});
const planWith = (plants: PlantInstance[], over: Partial<GardenPlan> = {}): GardenPlan => ({ ...createPlan('g'), plants, ...over });

// tomato 24in + basil 12in -> required gap 18in; "problem" below 0.7 × 18 = 12.6in
const tomatoBasil = (distance: number) => planWith([plant('t', 'tomato', 0), plant('b', 'basil', distance)]);

describe('computeWarnings', () => {
  it('has none for an empty garden or well-spaced plants', () => {
    expect(computeWarnings(createPlan('g'))).toEqual([]);
    expect(computeWarnings(tomatoBasil(18))).toEqual([]);
  });

  it('describes a spacing conflict with a stable id, subjects and a fix', () => {
    expect(computeWarnings(tomatoBasil(15))).toEqual([
      {
        id: `spacing:${conflictKey('b', 't')}`,
        kind: 'spacing',
        severity: 'caution',
        bedId: 'bed-1',
        subjects: ['b', 't'],
        message: 'Basil and Tomato are 15 in apart; they want about 18 in.',
        suggestion: 'Move one of them at least 3 in further apart.',
        dismissed: false,
      },
    ]);
  });

  it('is "caution" from 0.7 of the gap up to the gap, and "problem" just below 0.7', () => {
    expect(computeWarnings(tomatoBasil(17.99))[0].severity).toBe('caution');
    expect(computeWarnings(tomatoBasil(12.6))[0].severity).toBe('caution');
    expect(computeWarnings(tomatoBasil(12.59))[0].severity).toBe('problem');
  });

  it('flags a dismissed conflict but keeps it in the list', () => {
    const plan = { ...tomatoBasil(10), dismissedConflictKeys: [conflictKey('t', 'b')] };
    expect(computeWarnings(plan).map((w) => w.dismissed)).toEqual([true]);
  });

  it('reports each pair once, in id order, regardless of plant order', () => {
    const a = planWith([plant('t', 'tomato', 0), plant('b', 'basil', 5), plant('c', 'basil', 10)]);
    const reversed = planWith([...a.plants].reverse());
    expect(computeWarnings(a).map((w) => w.id)).toEqual(computeWarnings(reversed).map((w) => w.id));
    expect(computeWarnings(a).map((w) => w.id)).toEqual([...computeWarnings(a).map((w) => w.id)].sort());
  });

  it('does not warn about close plants in different beds', () => {
    const plan = planWith([plant('t', 'tomato', 0), plant('b', 'basil', 5, { bedId: 'bed-2' })]);
    expect(computeWarnings(plan)).toEqual([]);
  });
});

describe('diffWarnings', () => {
  const none = computeWarnings(tomatoBasil(30));
  const close = computeWarnings(tomatoBasil(10));

  it('reports a warning that appears as introduced', () => {
    expect(diffWarnings(none, close)).toEqual({ introduced: close, resolved: [], unchanged: 0 });
  });

  it('reports a warning that goes away as resolved', () => {
    expect(diffWarnings(close, none)).toEqual({ introduced: [], resolved: close, unchanged: 0 });
  });

  it('counts a persisting warning as unchanged even if its wording or severity changed', () => {
    const closer = computeWarnings(tomatoBasil(5));
    expect(closer[0].id).toBe(close[0].id);
    expect(diffWarnings(close, closer)).toEqual({ introduced: [], resolved: [], unchanged: 1 });
  });

  it('ignores dismissed warnings on both sides', () => {
    const dismissed = close.map((w) => ({ ...w, dismissed: true }));
    expect(diffWarnings(none, dismissed)).toEqual({ introduced: [], resolved: [], unchanged: 0 });
    expect(diffWarnings(dismissed, none)).toEqual({ introduced: [], resolved: [], unchanged: 0 });
  });
});
