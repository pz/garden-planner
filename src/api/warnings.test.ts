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

describe('shade and companion warnings', () => {
  // The default garden's bed-1 is 96×48 with its top-left at the origin; up is north; northern hemisphere.
  const shadePlan = (extra: Partial<GardenPlan> = {}) => planWith([plant('t', 'tomato', 40), { ...plant('b', 'basil', 40), y: 30 }], extra);
  const tomatoAt = (plan: GardenPlan) => ({ ...plan, plants: plan.plants.map((p) => (p.id === 't' ? { ...p, y: 40 } : p)) });

  it('warns that a tall crop shades a full-sun crop to its north, with a fix and a stable id', () => {
    const [w] = computeWarnings(tomatoAt(shadePlan()));
    expect(w).toMatchObject({
      id: 'shade:t>b',
      kind: 'shade',
      severity: 'caution',
      bedId: 'bed-1',
      subjects: ['t', 'b'],
      dismissed: false,
    });
    expect(w.message).toBe('Tomato (about 48 in tall) shades Basil, which wants full sun, at midday.');
    expect(w.suggestion).toContain('sun side');
  });

  it('follows the garden’s compass direction and hemisphere', () => {
    expect(computeWarnings(tomatoAt(shadePlan({ northDeg: 180 }))).filter((w) => w.kind === 'shade')).toEqual([]);
    const south = shadePlan();
    const inSouth = { ...tomatoAt(south), profile: { ...south.profile, location: { lat: -35, lng: 150 } } };
    expect(computeWarnings(inSouth).filter((w) => w.kind === 'shade')).toEqual([]);
  });

  it('flags a dismissed shade warning by its id in dismissedWarnings, but keeps it listed', () => {
    const plan = tomatoAt(shadePlan({ dismissedWarnings: ['shade:t>b'] }));
    expect(computeWarnings(plan).filter((w) => w.kind === 'shade').map((w) => [w.id, w.dismissed])).toEqual([['shade:t>b', true]]);
  });

  it('warns about beans near onion, saying plainly that the advice is traditional', () => {
    const plan = planWith([plant('b', 'beans', 10), plant('o', 'onion', 20)]);
    const w = computeWarnings(plan).find((x) => x.kind === 'companion')!;
    expect(w).toMatchObject({ id: `companion:${conflictKey('b', 'o')}`, severity: 'caution', subjects: ['b', 'o'], dismissed: false });
    expect(w.message).toContain('Beans and Onion are 10 in apart.');
    expect(w.message).toContain('little research behind it');
    expect(w.suggestion).toBe('Keep them at least 24 in apart.');
  });

  it('stops warning about the pair at exactly the near distance, and dismisses by id', () => {
    expect(computeWarnings(planWith([plant('b', 'beans', 10), plant('o', 'onion', 34)])).filter((w) => w.kind === 'companion')).toEqual([]);
    const dismissed = planWith([plant('b', 'beans', 10), plant('o', 'onion', 20)], { dismissedWarnings: [`companion:${conflictKey('b', 'o')}`] });
    expect(computeWarnings(dismissed).find((w) => w.kind === 'companion')?.dismissed).toBe(true);
  });

  it('lists all kinds together in id order', () => {
    const plan = planWith([plant('b', 'beans', 10), plant('o', 'onion', 14), plant('t', 'tomato', 60), { ...plant('s', 'basil', 60), y: 0 }]);
    const ids = computeWarnings(plan).map((w) => w.id);
    expect(ids).toEqual([...ids].sort());
    expect(new Set(computeWarnings(plan).map((w) => w.kind))).toEqual(new Set(['spacing', 'companion', 'shade']));
  });
});
