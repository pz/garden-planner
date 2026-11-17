import { describe, expect, it } from 'vitest';
import type { Bed, GardenPlan, PlantInstance } from '../types';
import { createPlan } from '../core/reducer';
import { bedToGarden } from '../core/layout';
import { isInsideOutline } from '../core/geometry';
import { bedOutline } from '../core/layout';
import { loadScenario } from './catalog';
import { Evaluator } from './evaluator';
import { normalize } from './normalize';
import { solve } from './solve';
import { spacingPenalty } from './rules';
import type { PlantingSpec } from './spec';

const bed = (id: string, w: number, h: number, extra: Partial<Bed> = {}): Bed => ({ id, name: id, shape: 'rect', cx: w / 2, cy: h / 2, widthIn: w, heightIn: h, rotationDeg: 0, ...extra });
const planOf = (beds: Bed[], plants: PlantInstance[] = [], extra: Partial<GardenPlan> = {}): GardenPlan => ({ ...createPlan('t'), beds, plants, ...extra });
const plant = (id: string, bedId: string, cropId: string, x: number, y: number, groupId = id): PlantInstance => ({ id, bedId, cropId, x, y, groupId });
const fill = (...demands: PlantingSpec['demands']): PlantingSpec => ({ mode: 'fill', demands });
const opts = { year: 2026 };

/** An evaluator over a plan, to test the hard constraints directly. */
const evaluatorFor = (plan: GardenPlan, spec: PlantingSpec) => new Evaluator(normalize(plan, spec, 2026));

describe('hard constraints', () => {
  // A fixed lettuce (10 in spacing) at (20, 20); a new lettuce wants a gap of 10 and may not come closer than 7.
  const ev = () => evaluatorFor(planOf([bed('b', 96, 48)], [plant('p', 'b', 'lettuce', 20, 20)]), fill({ cropId: 'lettuce', weight: 1 }));

  it('allows exactly the required gap and a hair inside it, with a penalty only inside', () => {
    const e = ev();
    expect(e.pointOk('b', 'lettuce', 30, 20)).toBe(true);
    expect(e.previewAdd({ bedId: 'b', cropId: 'lettuce', origin: { x: 30, y: 20 }, axis: 'x', columns: 1, rows: 1, source: 'new' })).toBeGreaterThan(0);
    expect(e.pointOk('b', 'lettuce', 29.99, 20)).toBe(true);
    expect(spacingPenalty(9.99, 10)).toBeGreaterThan(0);
  });

  it('refuses the problem line (0.7 of the gap) and anything inside it, allows just outside', () => {
    const e = ev();
    expect(e.pointOk('b', 'lettuce', 26.99, 20)).toBe(false);
    expect(e.pointOk('b', 'lettuce', 27, 20)).toBe(false);
    expect(e.pointOk('b', 'lettuce', 27.01, 20)).toBe(true);
  });

  it('accepts a center flush with the outline and refuses one just past it', () => {
    const e = evaluatorFor(planOf([bed('b', 96, 48)]), fill({ cropId: 'lettuce', weight: 1 }));
    expect(e.pointOk('b', 'lettuce', 0, 0)).toBe(true);
    expect(e.pointOk('b', 'lettuce', 96, 48)).toBe(true);
    expect(e.pointOk('b', 'lettuce', -0.01, 0)).toBe(false);
    expect(e.pointOk('b', 'lettuce', 96, 48.01)).toBe(false);
  });

  it('caps a block at 1000 plants', () => {
    const e = evaluatorFor(planOf([bed('big', 600, 600)]), fill({ cropId: 'radish', weight: 1 }));
    const block = (columns: number, rows: number) => ({ bedId: 'big', cropId: 'radish', origin: { x: 0, y: 0 }, axis: 'x' as const, columns, rows, source: 'new' as const });
    expect(e.canPlace(block(25, 40))).toBe(true);
    expect(e.canPlace(block(25, 41))).toBe(false);
  });

  it('does not let one patch’s own members count against each other, but does count its neighbours', () => {
    const e = ev();
    const row = { bedId: 'b', cropId: 'lettuce', origin: { x: 40, y: 20 }, axis: 'x' as const, columns: 5, rows: 1, source: 'new' as const };
    expect(e.canPlace(row)).toBe(true);
    expect(e.canPlace({ ...row, origin: { x: 20, y: 25 } })).toBe(false); // the first plant is 5 in from the fixed one
  });
});

describe('solve', () => {
  const empty = () => planOf([bed('b', 96, 48)]);

  it('plants a single crop in an empty bed with no violations and every center inside', () => {
    const p = solve(empty(), fill({ cropId: 'lettuce', weight: 1 }), opts);
    expect(p.hardViolations).toEqual([]);
    expect(p.crops[0]).toMatchObject({ cropId: 'lettuce', status: 'met' });
    expect(p.plan.plants.length).toBe(p.crops[0].placed);
    for (const q of p.plan.plants) expect(isInsideOutline(q, bedOutline(p.plan.beds[0]))).toBe(true);
    expect(p.commands.every((c) => c.type === 'addPatch')).toBe(true);
  });

  it('does not change the plan it is given', () => {
    const plan = empty();
    const before = JSON.stringify(plan);
    solve(plan, fill({ cropId: 'tomato', weight: 1 }), opts);
    expect(JSON.stringify(plan)).toBe(before);
  });

  it('gives the same commands for the same seed', () => {
    const plan = loadScenario('fill-around-existing').plan;
    const spec = loadScenario('fill-around-existing').spec;
    expect(solve(plan, spec, { ...opts, seed: 7 }).commands).toEqual(solve(plan, spec, { ...opts, seed: 7 }).commands);
  });

  it('respects a max, and plants at least a min when it can', () => {
    const capped = solve(empty(), fill({ cropId: 'lettuce', weight: 1, max: 3 }), opts);
    expect(capped.crops[0].placed).toBeLessThanOrEqual(3);
    const floored = solve(empty(), fill({ cropId: 'tomato', weight: 0.01, min: 5 }, { cropId: 'lettuce', weight: 5 }), opts);
    expect(floored.crops.find((c) => c.cropId === 'tomato')!.placed).toBeGreaterThanOrEqual(5);
  });

  it('keeps a bed restricted crop in its beds', () => {
    const plan = planOf([bed('a', 96, 48), bed('b', 96, 48, { cy: 100 })]);
    const p = solve(plan, fill({ cropId: 'tomato', weight: 1, bedIds: ['b'] }), opts);
    expect(p.blocks.length).toBeGreaterThan(0);
    expect(p.blocks.every((x) => x.bedId === 'b')).toBe(true);
  });

  it('plants nothing outside the scope', () => {
    const plan = planOf([bed('a', 96, 48), bed('b', 96, 48, { cy: 100 })]);
    const p = solve(plan, { mode: 'fill', scope: { bedIds: ['a'] }, demands: [{ cropId: 'tomato', weight: 1 }] }, opts);
    expect(p.blocks.every((x) => x.bedId === 'a')).toBe(true);
  });

  it('works in a bed turned 30°: blocks are planned in the bed’s own frame', () => {
    const turned = bed('r', 72, 48, { rotationDeg: 30, cx: 200, cy: 100 });
    const p = solve(planOf([turned]), fill({ cropId: 'pepper', weight: 1 }), opts);
    expect(p.hardViolations).toEqual([]);
    expect(p.plan.plants.length).toBeGreaterThan(3);
    for (const q of p.plan.plants) {
      expect(q.x).toBeGreaterThanOrEqual(0);
      expect(q.x).toBeLessThanOrEqual(72);
      const at = bedToGarden(turned, q);
      expect(Number.isFinite(at.x)).toBe(true);
    }
  });

  it('never introduces a problem-level spacing warning around fixed plants', () => {
    const fixed = Array.from({ length: 4 }, (_, i) => plant(`k${i}`, 'b', 'kale', 10 + i * 20, 12, `kg${i}`));
    const p = solve(planOf([bed('b', 96, 48)], fixed), fill({ cropId: 'tomato', weight: 1 }, { cropId: 'basil', weight: 1 }), opts);
    expect(p.hardViolations).toEqual([]);
    expect(p.introducedWarnings.filter((w) => w.severity === 'problem')).toEqual([]);
    for (const k of fixed) expect(p.plan.plants.find((q) => q.id === k.id)).toEqual(k);
  });
});

describe('filters and reasons', () => {
  it('drops a crop that cannot ripen before frost (season_too_short) and keeps the others', () => {
    const plan = planOf([bed('b', 96, 48)], [], { profile: { ...createPlan('x').profile, zoneId: '3' } });
    const p = solve(plan, fill({ cropId: 'artichoke', weight: 1 }, { cropId: 'lettuce', weight: 1 }), opts);
    expect(p.crops.find((c) => c.cropId === 'artichoke')).toEqual({ cropId: 'artichoke', target: 0, placed: 0, status: 'unmet', reasons: ['season_too_short'] });
    expect(p.crops.find((c) => c.cropId === 'lettuce')!.status).toBe('met');
  });

  it('plants the same crop in a warmer zone', () => {
    const plan = planOf([bed('b', 96, 48)], [], { profile: { ...createPlan('x').profile, zoneId: '9' } });
    expect(solve(plan, fill({ cropId: 'artichoke', weight: 1 }), opts).crops[0].status).toBe('met');
  });

  it('excludes full-sun crops in a shady garden, but not in part shade', () => {
    const shade = planOf([bed('b', 96, 48)], [], { profile: { ...createPlan('x').profile, sunExposure: 'shade' } });
    const p = solve(shade, fill({ cropId: 'tomato', weight: 1 }, { cropId: 'lettuce', weight: 1 }), opts);
    expect(p.crops.find((c) => c.cropId === 'tomato')!.reasons).toEqual(['insufficient_sun']);
    expect(p.crops.find((c) => c.cropId === 'lettuce')!.status).toBe('met');
    const part = planOf([bed('b', 96, 48)], [], { profile: { ...createPlan('x').profile, sunExposure: 'part-shade' } });
    // Not excluded, but each full-sun plant costs a little, so the last plants may be traded away, and the result says why.
    const tomato = solve(part, fill({ cropId: 'tomato', weight: 1 }), opts).crops[0];
    expect(tomato.placed).toBeGreaterThan(3);
    expect(tomato.status === 'met' || tomato.reasons.includes('insufficient_sun')).toBe(true);
  });

  // A 12 in bed with a fixed kale (18 in spacing) in the middle: nothing inside it is 12.6 in from the kale.
  const crowded = () => planOf([bed('full', 12, 12), bed('free', 96, 48, { cy: 100 })], [plant('k', 'full', 'kale', 6, 6)]);

  it('reports insufficient_space when the fixed plants leave no room', () => {
    const p = solve(crowded(), { mode: 'fill', scope: { bedIds: ['full'] }, demands: [{ cropId: 'kale', weight: 1 }] }, opts);
    expect(p.crops[0]).toMatchObject({ placed: 0, status: 'unmet', reasons: ['insufficient_space'] });
    expect(p.commands).toEqual([]);
  });

  it('reports limited_by_bed_restriction when the other beds would have room', () => {
    const p = solve(crowded(), fill({ cropId: 'kale', weight: 1, bedIds: ['full'] }), opts);
    expect(p.crops[0]).toMatchObject({ placed: 0, status: 'unmet', reasons: ['limited_by_bed_restriction'] });
  });

  it('reports outcompeted when a crop would fit alone but others used the room', () => {
    const s = loadScenario('fill-tiny-bed');
    const p = solve(s.plan, s.spec, opts);
    const radish = p.crops.find((c) => c.cropId === 'radish')!;
    expect(radish.status).not.toBe('met');
    expect(radish.reasons).toEqual(['outcompeted']);
  });
});

describe('placement quality', () => {
  it('lines blocks up on the lattice inside the bed, with the best score a greedy pass finds', () => {
    const p = solve(planOf([bed('b', 96, 48)]), fill({ cropId: 'pepper', weight: 1 }), opts);
    for (const b of p.blocks) {
      expect(b.origin.x % 3).toBe(0);
      expect(b.origin.y % 3).toBe(0);
    }
    expect(p.score.total).toBeGreaterThan(0.9);
  });

  it('packs plants a full gap apart in an empty bed when it can (no spacing warnings at all)', () => {
    const p = solve(planOf([bed('b', 96, 48)]), fill({ cropId: 'tomato', weight: 1 }), opts);
    expect(p.introducedWarnings).toEqual([]);
  });
});
