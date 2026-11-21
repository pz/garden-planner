import { describe, expect, it } from 'vitest';
import { applyCommands } from '../api/apply';
import { gridPoints, isInsideOutline } from '../core/geometry';
import { bedOutline } from '../core/layout';
import { createPlan } from '../core/reducer';
import { getCrop } from '../data/crops';
import type { Bed, GardenPlan, PlantInstance } from '../types';
import { placeholderSuggest, startCount, targetOf } from './placeholderSuggest';
import { bedFullness } from './suggestion';

const bed = (id: string, w: number, h: number, extra: Partial<Bed> = {}): Bed => ({ id, name: id, shape: 'rect', cx: w / 2, cy: h / 2, widthIn: w, heightIn: h, rotationDeg: 0, ...extra });
const patch = (groupId: string, bedId: string, cropId: string, x: number, y: number, cols: number, rows: number): PlantInstance[] =>
  gridPoints({ x, y }, 'x', cols, rows, getCrop(cropId).spacingIn).map((p, i) => ({ id: `${groupId}-${i}`, bedId, cropId, x: p.x, y: p.y, groupId }));
const garden = (): GardenPlan => ({
  ...createPlan('g'),
  beds: [bed('a', 96, 48), bed('b', 96, 48, { cy: 100 })],
  plants: [...patch('T', 'a', 'tomato', 12, 12, 3, 1), ...patch('B', 'a', 'basil', 12, 36, 6, 1), ...patch('L', 'b', 'lettuce', 8, 8, 4, 2)],
});
const exact = (target: number) => ({ kind: 'exact' as const, target });

describe('targetOf', () => {
  it('uses an exact target as given', () => {
    expect(targetOf(exact(10), 6, 'tomato')).toBe(10);
  });
  it('moves a soft request by a quarter of what is there, at least one, never below 0', () => {
    expect(targetOf({ kind: 'more' }, 8, 'basil')).toBe(10);
    expect(targetOf({ kind: 'more' }, 1, 'basil')).toBe(2);
    expect(targetOf({ kind: 'fewer' }, 8, 'basil')).toBe(6);
    expect(targetOf({ kind: 'fewer' }, 1, 'basil')).toBe(0);
  });
  it('starts a crop with nothing planted at a few plants: more for a crop grown in patches than for a solo one', () => {
    expect(targetOf({ kind: 'more' }, 0, 'marigold')).toBe(startCount('marigold'));
    expect(startCount('marigold')).toBeGreaterThan(startCount('tomato'));
  });
});

describe('placeholderSuggest', () => {
  it('adds plants in free spots: inside the bed, off the others, and valid for the API', () => {
    const plan = garden();
    const s = placeholderSuggest(plan, { wants: [{ cropId: 'tomato', request: exact(6) }], attempt: 0 });
    expect(s.rows).toEqual([{ cropId: 'tomato', before: 3, after: 6 }]);
    expect(s.adds).toHaveLength(3);
    for (const a of s.adds) {
      const b = plan.beds.find((x) => x.id === a.bedId)!;
      expect(isInsideOutline(a, bedOutline(b))).toBe(true);
    }
    const r = applyCommands(plan, s.commands, { newId: (() => { let n = 0; return () => `n${++n}`; })(), scope: 'planting' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.plants.filter((p) => p.cropId === 'tomato')).toHaveLength(6);
      expect(r.warnings.introduced.filter((w) => w.severity === 'problem')).toEqual([]);
    }
  });

  it('takes plants out, the newest first, and sends only removals', () => {
    const plan = garden();
    const s = placeholderSuggest(plan, { wants: [{ cropId: 'basil', request: exact(4) }], attempt: 0 });
    expect(s.removed).toEqual(['B-5', 'B-4']);
    expect(s.commands).toEqual([{ type: 'removePlant', id: 'B-5' }, { type: 'removePlant', id: 'B-4' }]);
    expect(s.rows[0]).toEqual({ cropId: 'basil', before: 6, after: 4 });
    expect(s.reasoning).toMatch(/Removed 2 basil/);
  });

  it('reports what it could not do, in words, instead of failing', () => {
    const plan = garden();
    const s = placeholderSuggest(plan, { bedId: 'a', wants: [{ cropId: 'tomato', request: exact(40) }], attempt: 0 });
    const row = s.rows[0];
    expect(row.after).toBeGreaterThan(3);
    expect(row.after).toBeLessThan(40);
    expect(row.note).toBe(`only room for ${row.after}`);
    expect(s.reasoning).toContain(`only room for ${row.after}`);
  });

  it('stays in the scoped bed', () => {
    const plan = garden();
    const s = placeholderSuggest(plan, { bedId: 'b', wants: [{ cropId: 'pepper', request: { kind: 'more' } }], attempt: 0 });
    expect(s.adds.length).toBeGreaterThan(0);
    expect(s.adds.every((a) => a.bedId === 'b')).toBe(true);
    expect(s.reasoning).toContain('in b');
    // Plants outside the scope are not counted or touched.
    const out = placeholderSuggest(plan, { bedId: 'b', wants: [{ cropId: 'tomato', request: { kind: 'fewer' } }], attempt: 0 });
    expect(out.rows[0]).toEqual({ cropId: 'tomato', before: 0, after: 0, note: 'nothing to take out' });
    expect(out.commands).toEqual([]);
  });

  it('plants a new crop as one patch in each bed it lands in, and counts it', () => {
    const s = placeholderSuggest(garden(), { wants: [{ cropId: 'marigold', request: { kind: 'more' } }], attempt: 0 });
    expect(s.rows[0].before).toBe(0);
    expect(s.rows[0].after).toBe(startCount('marigold'));
    expect(s.commands.filter((c) => c.type === 'addPatch')).toHaveLength(new Set(s.adds.map((a) => a.bedId)).size);
    expect(s.commands.flatMap((c) => (c.type === 'addPatch' ? c.points ?? [] : []))).toHaveLength(startCount('marigold'));
  });

  it('is deterministic, and a new attempt gives a different arrangement of the same request', () => {
    const plan = garden();
    const ask = (attempt: number) => placeholderSuggest(plan, { wants: [{ cropId: 'pepper', request: exact(4) }], attempt });
    expect(ask(0)).toEqual(ask(0));
    expect(JSON.stringify(ask(1).adds)).not.toBe(JSON.stringify(ask(0).adds));
    expect(ask(1).rows).toEqual(ask(0).rows);
  });

  it('has nothing to change when the request is already met', () => {
    const s = placeholderSuggest(garden(), { wants: [{ cropId: 'tomato', request: exact(3) }], attempt: 0 });
    expect(s.commands).toEqual([]);
    expect(s.reasoning).toBe('Nothing needed to change.');
  });

  it('reports how full the beds are before and after', () => {
    const plan = garden();
    const s = placeholderSuggest(plan, { bedId: 'a', wants: [{ cropId: 'tomato', request: exact(8) }], attempt: 0 });
    expect(s.fullness.before).toBeCloseTo(bedFullness([plan.beds[0]], plan.plants), 9);
    expect(s.fullness.after).toBeGreaterThan(s.fullness.before);
  });
});

describe('bedFullness', () => {
  it('is the growing-room area planted over the bed area, capped at 1', () => {
    const b = bed('a', 48, 48);
    const plants = patch('T', 'a', 'tomato', 12, 12, 2, 2);
    expect(bedFullness([b], plants)).toBeCloseTo((4 * 24 * 24) / (48 * 48), 9);
    expect(bedFullness([b], [])).toBe(0);
    expect(bedFullness([bed('c', 12, 12)], patch('T', 'c', 'tomato', 0, 0, 3, 3))).toBe(1);
  });
});
