import { describe, expect, it } from 'vitest';
import type { Bed, GardenPlan, PlantInstance } from '../types';
import { getCrop } from '../data/crops';
import { bedArea } from './allocate';
import { blockPoints, minShape } from './block';
import { loadScenario } from './catalog';
import { createPlan } from '../core/reducer';
import { bedOutline } from '../core/layout';
import { solve } from './solve';
import { insideWithClearance } from './rules';
import type { PlantingSpec } from './spec';

const bed = (id: string, w: number, h: number, extra: Partial<Bed> = {}): Bed => ({ id, name: id, shape: 'rect', cx: w / 2, cy: h / 2, widthIn: w, heightIn: h, rotationDeg: 0, ...extra });
const planOf = (beds: Bed[], plants: PlantInstance[] = []): GardenPlan => ({ ...createPlan('t'), beds, plants });
const opts = { year: 2026, iterations: 1500 };

describe('edge clearance', () => {
  const tomatoes: PlantingSpec = { mode: 'fill', demands: [{ cropId: 'tomato', weight: 5 }, { cropId: 'pepper', weight: 1 }, { cropId: 'lettuce', weight: 0.5 }] };
  /** The nearest a plant's center is to a side of the 96 × 48 bed, in inches. */
  const edgeGap = (q: { x: number; y: number }) => Math.min(q.x, q.y, 96 - q.x, 48 - q.y);

  it('keeps a plant’s center half a growing-room radius in from the edge by default, so about a quarter of it overhangs', () => {
    const p = solve(planOf([bed('b', 96, 48)]), tomatoes, opts);
    expect(p.plan.plants.length).toBeGreaterThan(8);
    for (const q of p.plan.plants) expect(edgeGap(q), q.cropId).toBeGreaterThanOrEqual(getCrop(q.cropId).spacingIn / 4 - 1e-9);
    // Not right on the edge, as before the option existed.
    expect(p.plan.plants.some((q) => edgeGap(q) < 1)).toBe(false);
  });

  it('is relative to the plant: a big plant stays further in than a small one', () => {
    const p = solve(planOf([bed('b', 96, 48)]), { mode: 'fill', demands: [{ cropId: 'tomato', weight: 1 }, { cropId: 'radish', weight: 1 }] }, opts);
    const nearest = (id: string) => Math.min(...p.plan.plants.filter((q) => q.cropId === id).map(edgeGap));
    expect(nearest('tomato')).toBeGreaterThanOrEqual(6 - 1e-9); // 0.5 × a 12 in radius
    expect(nearest('radish')).toBeGreaterThanOrEqual(0.5 - 1e-9); // 0.5 × a 1 in radius
    expect(nearest('radish')).toBeLessThan(nearest('tomato'));
  });

  it('takes 1 for the whole growing room inside the bed, 0 for right on the edge, above 1 for a margin', () => {
    const plan = planOf([bed('b', 96, 48)]);
    const room = solve(plan, { ...tomatoes, edgeClearance: 1 }, opts);
    for (const q of room.plan.plants) expect(edgeGap(q), q.cropId).toBeGreaterThanOrEqual(getCrop(q.cropId).spacingIn / 2 - 1e-9);
    expect(room.score.spill).toBe(0);
    const edge = solve(plan, { ...tomatoes, edgeClearance: 0 }, opts);
    expect(edge.plan.plants.some((q) => edgeGap(q) === 0)).toBe(true);
    const margin = solve(plan, { ...tomatoes, edgeClearance: 1.5 }, opts);
    for (const q of margin.plan.plants) expect(edgeGap(q), q.cropId).toBeGreaterThanOrEqual(getCrop(q.cropId).spacingIn * 0.75 - 1e-9);
  });

  it('applies in an ellipse, a triangle and a rounded bed', () => {
    const beds = [
      bed('e', 72, 60, { shape: 'ellipse' }),
      bed('t', 72, 60, { shape: 'polygon', points: [{ x: 36, y: 0 }, { x: 72, y: 60 }, { x: 0, y: 60 }], cx: 150 }),
      bed('r', 96, 48, { cornerRadiusIn: 16, cy: 150 }),
    ];
    const p = solve(planOf(beds), tomatoes, opts);
    expect(p.plan.plants.length).toBeGreaterThan(8);
    for (const q of p.plan.plants) {
      const b = beds.find((x) => x.id === q.bedId)!;
      expect(insideWithClearance(q, getCrop(q.cropId).spacingIn / 4 - 1e-6, bedOutline(b)), `${q.cropId} in ${b.id}`).toBe(true);
    }
  });

  it('leaves a crop out when its room cannot fit in the bed at all (a clearance of 1)', () => {
    const squash = (edgeClearance?: number): PlantingSpec => ({ mode: 'fill', ...(edgeClearance === undefined ? {} : { edgeClearance }), demands: [{ cropId: 'squash', weight: 1 }] });
    const whole = solve(planOf([bed('b', 24, 24)]), squash(1), opts);
    expect(whole.crops[0]).toMatchObject({ placed: 0, status: 'unmet', reasons: ['insufficient_space'] });
    // With the default, a squash (36 in) may overhang a 24 in bed: its center only has to be 9 in from the edge.
    expect(solve(planOf([bed('b', 24, 24)]), squash(), opts).crops[0].placed).toBe(1);
    expect(solve(planOf([bed('b', 24, 24)]), squash(0), opts).crops[0].placed).toBe(1);
  });
});

describe('weight 0', () => {
  const plan = () => planOf([bed('b', 96, 48)]);
  it('ignores the crop: nothing planted, nothing missing', () => {
    const p = solve(plan(), { mode: 'fill', demands: [{ cropId: 'tomato', weight: 1 }, { cropId: 'lettuce', weight: 0 }] }, opts);
    expect(p.blocks.some((b) => b.cropId === 'lettuce')).toBe(false);
    expect(p.crops.find((c) => c.cropId === 'lettuce')).toEqual({ cropId: 'lettuce', target: 0, placed: 0, status: 'met', reasons: [] });
    expect(p.crops.find((c) => c.cropId === 'tomato')!.status).toBe('met');
  });
  it('gives the others the ignored crop’s share', () => {
    const withZero = solve(plan(), { mode: 'fill', demands: [{ cropId: 'tomato', weight: 1 }, { cropId: 'lettuce', weight: 0 }] }, opts);
    const alone = solve(plan(), { mode: 'fill', demands: [{ cropId: 'tomato', weight: 1 }] }, opts);
    expect(withZero.crops[0].target).toBe(alone.crops[0].target);
  });
  it('plants nothing when every weight is 0, and does not divide by zero', () => {
    const p = solve(plan(), { mode: 'fill', demands: [{ cropId: 'tomato', weight: 0 }, { cropId: 'pepper', weight: 0 }] }, opts);
    expect(p.commands).toEqual([]);
    expect(p.hardViolations).toEqual([]);
    expect(p.score.total).toBeCloseTo(0, 9);
  });
  it('leaves an existing patch of the crop alone in adjust mode', () => {
    const existing: PlantInstance[] = [0, 1, 2, 3].map((i) => ({ id: `l${i}`, bedId: 'b', cropId: 'lettuce', x: 12 + 10 * i, y: 12, groupId: 'L' }));
    const p = solve(planOf([bed('b', 96, 48)], existing), { mode: 'adjust', prefs: { stability: 0 }, demands: [{ cropId: 'lettuce', weight: 0 }, { cropId: 'pepper', weight: 1 }] }, opts);
    expect(p.plan.plants.filter((q) => q.groupId === 'L')).toEqual(existing);
    expect(p.commands.some((c) => 'groupId' in c && c.groupId === 'L')).toBe(false);
  });
});

describe('minimum group size', () => {
  const garden = () => planOf([bed('a', 96, 48), bed('b', 96, 48, { cy: 100 })]);
  it('never plants a block of corn smaller than 3 by 3', () => {
    const p = solve(garden(), { mode: 'fill', demands: [{ cropId: 'corn', weight: 1 }, { cropId: 'pepper', weight: 1 }] }, opts);
    const corn = p.blocks.filter((b) => b.cropId === 'corn');
    expect(corn.length).toBeGreaterThan(0);
    for (const b of corn) {
      expect(b.columns).toBeGreaterThanOrEqual(3);
      expect(b.rows).toBeGreaterThanOrEqual(3);
    }
  });
  it('drops a crop whose target is below its smallest group, with a reason, and gives its share to the others', () => {
    const spec: PlantingSpec = { mode: 'fill', demands: [{ cropId: 'tomato', weight: 1 }, { cropId: 'corn', weight: 0.05 }] };
    const p = solve(garden(), spec, opts);
    expect(p.crops.find((c) => c.cropId === 'corn')).toEqual({ cropId: 'corn', target: 0, placed: 0, status: 'unmet', reasons: ['below_minimum_group'] });
    expect(p.blocks.some((b) => b.cropId === 'corn')).toBe(false);
    const alone = solve(garden(), { mode: 'fill', demands: [{ cropId: 'tomato', weight: 1 }] }, opts);
    expect(p.crops.find((c) => c.cropId === 'tomato')!.target).toBe(alone.crops[0].target);
  });
  it('plants corn when the demand’s own minimum asks for a whole block', () => {
    const p = solve(garden(), { mode: 'fill', demands: [{ cropId: 'tomato', weight: 1 }, { cropId: 'corn', weight: 0.05, min: 9 }] }, opts);
    expect(p.crops.find((c) => c.cropId === 'corn')!.placed).toBeGreaterThanOrEqual(9);
  });
  it('never plants a stray one or two of a crop grown in patches', () => {
    for (const name of ['fill-north-row', 'fill-odd-shapes', 'fill-around-existing', 'fill-salad-garden']) {
      const s = loadScenario(name);
      const p = solve(s.plan, s.spec, { year: 2026, iterations: 800 });
      for (const b of p.blocks) {
        const m = minShape(b.cropId);
        expect(b.columns * b.rows, `${name}: ${b.cropId}`).toBeGreaterThanOrEqual(m.plants);
        expect(Math.min(b.columns, b.rows), `${name}: ${b.cropId}`).toBeGreaterThanOrEqual(m.side);
      }
    }
  });
  it('leaves an existing small patch alone and may still slide it', () => {
    const lone = [{ id: 'c1', bedId: 'a', cropId: 'corn', x: 40, y: 20, groupId: 'C' }];
    const p = solve(planOf([bed('a', 96, 48)], lone), { mode: 'adjust', prefs: { stability: 1 }, demands: [{ cropId: 'corn', weight: 1 }] }, opts);
    expect(p.hardViolations).toEqual([]);
    expect(p.plan.plants.some((q) => q.groupId === 'C')).toBe(true);
  });
  it('counts a block’s plants through blockPoints so the minimum is about plants, not cells', () => {
    expect(blockPoints({ bedId: 'a', cropId: 'corn', origin: { x: 0, y: 0 }, axis: 'x', columns: 3, rows: 3, source: 'new' })).toHaveLength(9);
  });
});

describe('coverage and tidiness', () => {
  it('plants every bed of the odd-shapes garden to a fair share, not just the easy rectangle', () => {
    const s = loadScenario('fill-odd-shapes');
    const p = solve(s.plan, s.spec, { year: 2026 });
    for (const b of p.plan.beds) {
      const area = p.plan.plants.filter((q) => q.bedId === b.id).reduce((n, q) => n + getCrop(q.cropId).spacingIn ** 2, 0);
      expect(area / bedArea(b), b.id).toBeGreaterThan(0.45);
    }
  });

  it('with coverage valued, the emptiest bed is no emptier than with it ignored', () => {
    const s = loadScenario('fill-odd-shapes');
    const emptiest = (coverage: number) => {
      const p = solve(s.plan, { ...s.spec, prefs: { coverage } }, { year: 2026, iterations: 800 });
      return Math.min(...p.plan.beds.map((b) => p.plan.plants.filter((q) => q.bedId === b.id).reduce((n, q) => n + getCrop(q.cropId).spacingIn ** 2, 0) / bedArea(b)));
    };
    expect(emptiest(1)).toBeGreaterThanOrEqual(emptiest(0) - 1e-9);
  });

  it('sorts the north row into one crop per bed with no shade conflict', () => {
    const s = loadScenario('fill-north-row');
    const p = solve(s.plan, s.spec, { year: 2026 });
    for (const id of ['bed-n', 'bed-m', 'bed-s']) expect(new Set(p.plan.plants.filter((q) => q.bedId === id).map((q) => q.cropId)).size, id).toBe(1);
    expect(p.score.mixing).toBe(0);
    expect(p.introducedWarnings.filter((w) => w.kind === 'shade')).toEqual([]);
  });

  it('mixes crops in a bed less when tidiness is high than when it is ignored', () => {
    const plan = planOf([bed('b', 96, 48)]);
    const spec: PlantingSpec = { mode: 'fill', demands: [{ cropId: 'tomato', weight: 1 }, { cropId: 'pepper', weight: 1 }, { cropId: 'lettuce', weight: 1 }, { cropId: 'basil', weight: 1 }] };
    const distinct = (tidiness: number) => new Set(solve(plan, { ...spec, prefs: { tidiness } }, opts).plan.plants.map((q) => q.cropId)).size;
    expect(distinct(1)).toBeLessThanOrEqual(distinct(0));
  });
});
