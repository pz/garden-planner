import { describe, expect, it } from 'vitest';
import type { PlantInstance } from '../types';
import {
  MAX_TARGET,
  NO_REQUESTS,
  addCrop,
  adjustRows,
  changeCount,
  clearRow,
  cropCounts,
  parseTarget,
  pressArrow,
  resetRequests,
  typeTarget,
  wantsOf,
  type AdjustRequests,
} from './adjust';

const plant = (id: string, cropId: string, bedId = 'a'): PlantInstance => ({ id, bedId, cropId, x: 0, y: 0, groupId: id });
const plants = [
  ...Array.from({ length: 6 }, (_, i) => plant(`t${i}`, 'tomato')),
  ...Array.from({ length: 8 }, (_, i) => plant(`b${i}`, 'basil')),
  ...Array.from({ length: 8 }, (_, i) => plant(`l${i}`, 'lettuce', 'b')),
  plant('k0', 'kale', 'b'),
];

describe('cropCounts', () => {
  it('counts plants per crop, most first, then by name', () => {
    expect(cropCounts(plants)).toEqual([
      { cropId: 'basil', count: 8 },
      { cropId: 'lettuce', count: 8 },
      { cropId: 'tomato', count: 6 },
      { cropId: 'kale', count: 1 },
    ]);
  });
  it('can be limited to one bed, and leaves out crops with no plants there', () => {
    expect(cropCounts(plants, 'a').map((c) => c.cropId)).toEqual(['basil', 'tomato']);
    expect(cropCounts(plants, 'nowhere')).toEqual([]);
  });
});

describe('pressArrow', () => {
  it('marks a soft direction without changing the count', () => {
    expect(pressArrow(NO_REQUESTS, 'tomato', 6, 'more').requests).toEqual({ tomato: { kind: 'more' } });
    expect(pressArrow(NO_REQUESTS, 'tomato', 6, 'fewer').requests).toEqual({ tomato: { kind: 'fewer' } });
  });
  it('leaves a soft request on the same arrow and clears it on the other', () => {
    const more = pressArrow(NO_REQUESTS, 'tomato', 6, 'more');
    expect(pressArrow(more, 'tomato', 6, 'more')).toBe(more);
    expect(pressArrow(more, 'tomato', 6, 'fewer').requests).toEqual({});
  });
  it('has nothing to take away from a crop with no plants', () => {
    expect(pressArrow(NO_REQUESTS, 'kale', 0, 'fewer')).toBe(NO_REQUESTS);
    expect(pressArrow(NO_REQUESTS, 'kale', 0, 'more').requests).toEqual({ kale: { kind: 'more' } });
  });
  it('steps a target by one, and no request is left when it comes back to the count', () => {
    const exact = typeTarget(NO_REQUESTS, 'tomato', 6, '10');
    expect(pressArrow(exact, 'tomato', 6, 'more').requests.tomato).toEqual({ kind: 'exact', target: 11 });
    expect(pressArrow(exact, 'tomato', 6, 'fewer').requests.tomato).toEqual({ kind: 'exact', target: 9 });
    expect(pressArrow(typeTarget(NO_REQUESTS, 'tomato', 6, '7'), 'tomato', 6, 'fewer').requests).toEqual({});
  });
  it('stops a target at 0 and at the most that can be typed', () => {
    expect(pressArrow(typeTarget(NO_REQUESTS, 'tomato', 6, '0'), 'tomato', 6, 'fewer').requests.tomato).toEqual({ kind: 'exact', target: 0 });
    expect(pressArrow(typeTarget(NO_REQUESTS, 'tomato', 6, String(MAX_TARGET)), 'tomato', 6, 'more').requests.tomato).toEqual({ kind: 'exact', target: MAX_TARGET });
  });
  it('does not change the state it was given', () => {
    const before = pressArrow(NO_REQUESTS, 'tomato', 6, 'more');
    const snapshot = JSON.stringify(before);
    pressArrow(before, 'tomato', 6, 'fewer');
    pressArrow(before, 'basil', 8, 'more');
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(NO_REQUESTS).toEqual({ requests: {}, added: [] });
  });
});

describe('parseTarget', () => {
  it('reads whole numbers from 0 to the largest allowed, with spaces around them', () => {
    expect(parseTarget('0')).toBe(0);
    expect(parseTarget(' 12 ')).toBe(12);
    expect(parseTarget(String(MAX_TARGET))).toBe(MAX_TARGET);
  });
  it('rejects the rest', () => {
    for (const bad of ['', '-1', '1.5', 'ten', '1e3', String(MAX_TARGET + 1), '12345', '1 2']) expect(parseTarget(bad), bad).toBeNull();
  });
});

describe('typeTarget', () => {
  it('sets an exact target, replacing a soft request', () => {
    const soft = pressArrow(NO_REQUESTS, 'tomato', 6, 'more');
    expect(typeTarget(soft, 'tomato', 6, '10').requests).toEqual({ tomato: { kind: 'exact', target: 10 } });
  });
  it('treats 0 as a request to take the crop out', () => {
    expect(typeTarget(NO_REQUESTS, 'basil', 8, '0').requests).toEqual({ basil: { kind: 'exact', target: 0 } });
  });
  it('asks for nothing when the current count is typed, and ignores what is not a number', () => {
    const exact = typeTarget(NO_REQUESTS, 'tomato', 6, '10');
    expect(typeTarget(exact, 'tomato', 6, '6').requests).toEqual({});
    expect(typeTarget(exact, 'tomato', 6, 'x')).toBe(exact);
  });
});

describe('clearRow and addCrop', () => {
  it('clears a request on a crop that is planted', () => {
    const s = typeTarget(NO_REQUESTS, 'tomato', 6, '10');
    expect(clearRow(s, 'tomato', 6)).toEqual({ requests: {}, added: [] });
  });
  it('adds a crop as a row that already asks for more, once', () => {
    const s = addCrop(addCrop(NO_REQUESTS, 'marigold'), 'marigold');
    expect(s).toEqual({ requests: { marigold: { kind: 'more' } }, added: ['marigold'] });
  });
  it('removes a crop that was only added, row and all, but keeps the row of one that is planted', () => {
    const s = addCrop(NO_REQUESTS, 'marigold');
    expect(clearRow(s, 'marigold', 0)).toEqual({ requests: {}, added: [] });
  });
  it('resets everything', () => {
    expect(resetRequests()).toEqual({ requests: {}, added: [] });
  });
});

describe('adjustRows', () => {
  it('lists the crops in the scope, then the added ones, with their requests', () => {
    let s: AdjustRequests = typeTarget(NO_REQUESTS, 'tomato', 6, '10');
    s = addCrop(s, 'marigold');
    const rows = adjustRows(plants, s, 'a');
    expect(rows.map((r) => [r.cropId, r.count, r.request?.kind ?? null, r.isNew])).toEqual([
      ['basil', 8, null, false],
      ['tomato', 6, 'exact', false],
      ['marigold', 0, 'more', true],
    ]);
  });
  it('shows a crop added to the request as a normal row once it is planted in the scope', () => {
    const s = addCrop(NO_REQUESTS, 'kale');
    expect(adjustRows(plants, s, 'a').find((r) => r.cropId === 'kale')).toMatchObject({ count: 0, isNew: true });
    expect(adjustRows(plants, s, 'b').find((r) => r.cropId === 'kale')).toMatchObject({ count: 1, isNew: false });
  });
});

describe('changeCount and wantsOf', () => {
  it('counts the rows that carry a request, new ones included, and not the ones that are only listed', () => {
    let s = typeTarget(NO_REQUESTS, 'tomato', 6, '10');
    s = pressArrow(s, 'basil', 8, 'fewer');
    s = addCrop(s, 'marigold');
    const rows = adjustRows(plants, s, 'a');
    expect(changeCount(rows)).toBe(3);
    expect(wantsOf(rows).map((w) => [w.cropId, w.request.kind])).toEqual([
      ['basil', 'fewer'],
      ['tomato', 'exact'],
      ['marigold', 'more'],
    ]);
    expect(changeCount(adjustRows(plants, NO_REQUESTS, 'a'))).toBe(0);
  });
});
