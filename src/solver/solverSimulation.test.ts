import { describe, expect, it } from 'vitest';
import type { Bed, GardenPlan, PlantInstance } from '../types';
import { CROPS } from '../data/crops';
import { gridPoints, isInsideOutline } from '../core/geometry';
import { bedOutline } from '../core/layout';
import { mulberry32 } from '../core/random';
import { createPlan } from '../core/reducer';
import { checkInvariants } from './check';
import { solve } from './solve';
import { parseSpec, type PlantingSpec, type SolveMode } from './spec';

// In the style of api/simulation.test.ts: random gardens and random valid specs, seeded, with the
// invariants asserted for every run.

const MODES: SolveMode[] = ['fill'];

function randomGarden(next: () => number): GardenPlan {
  const pick = <T,>(xs: T[]): T => xs[Math.floor(next() * xs.length)];
  const beds: Bed[] = Array.from({ length: 1 + Math.floor(next() * 3) }, (_, i) => {
    const w = 24 + Math.floor(next() * 72);
    const h = 24 + Math.floor(next() * 48);
    const shape = pick(['rect', 'rect', 'ellipse', 'polygon'] as const);
    const bed: Bed = { id: `bed${i}`, name: `Bed ${i}`, shape, cx: 60 + i * 120, cy: 40 + Math.floor(next() * 40), widthIn: w, heightIn: h, rotationDeg: next() < 0.3 ? Math.floor(next() * 360) : 0 };
    if (shape === 'polygon') bed.points = [{ x: w / 2, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
    else if (shape === 'rect' && next() < 0.3) bed.cornerRadiusIn = 8;
    return bed;
  });
  const plants: PlantInstance[] = [];
  const patches = Math.floor(next() * 5);
  for (let g = 0; g < patches; g++) {
    const bed = pick(beds);
    const crop = pick(CROPS);
    const outline = bedOutline(bed);
    const origin = { x: Math.round(next() * bed.widthIn), y: Math.round(next() * bed.heightIn) };
    for (const p of gridPoints(origin, 'x', 1 + Math.floor(next() * 3), 1 + Math.floor(next() * 2), crop.spacingIn)) {
      if (isInsideOutline(p, outline)) plants.push({ id: `e${plants.length}`, bedId: bed.id, cropId: crop.id, x: p.x, y: p.y, groupId: `eg${g}` });
    }
  }
  return {
    ...createPlan('sim'),
    beds,
    plants,
    northDeg: pick([0, 90, 180, 270, 33]),
    profile: { ...createPlan('sim').profile, zoneId: pick(['3', '5', '6', '8', '9']), sunExposure: pick(['full-sun', 'full-sun', 'part-shade', 'shade'] as const) },
  };
}

function randomSpec(next: () => number, plan: GardenPlan, mode: SolveMode): PlantingSpec {
  const pick = <T,>(xs: T[]): T => xs[Math.floor(next() * xs.length)];
  const crops = [...CROPS].sort(() => next() - 0.5).slice(0, 1 + Math.floor(next() * 5));
  const scoped = next() < 0.3 && plan.beds.length > 1 ? [plan.beds[0].id] : undefined;
  const spec: PlantingSpec = {
    mode,
    demands: crops.map((c) => {
      const d: PlantingSpec['demands'][number] = { cropId: c.id, weight: Math.round((0.2 + next() * 2) * 10) / 10 };
      if (next() < 0.2) d.max = 1 + Math.floor(next() * 10);
      if (next() < 0.15) d.min = 1 + Math.floor(next() * 3);
      if (d.min !== undefined && d.max !== undefined && d.min > d.max) d.min = d.max;
      if (next() < 0.2) d.bedIds = [pick(scoped ?? plan.beds.map((b) => b.id))];
      return d;
    }),
  };
  if (scoped) spec.scope = { bedIds: scoped };
  if (next() < 0.3) spec.fillRatio = Math.round((0.3 + next() * 0.7) * 100) / 100;
  if (next() < 0.3) spec.prefs = { spacing: next() < 0.5 ? 1 : 0.5, shade: next(), clustering: next() };
  return spec;
}

describe('solver simulation', () => {
  for (const mode of MODES) {
    it(`${mode}: 30 random gardens and specs hold every invariant`, () => {
      let planted = 0;
      for (let seed = 1; seed <= 30; seed++) {
        const next = mulberry32(seed * 101 + mode.length);
        const plan = randomGarden(next);
        const parsed = parseSpec(randomSpec(next, plan, mode), plan);
        expect(parsed.ok, `seed ${seed}: ${!parsed.ok ? JSON.stringify(parsed.errors) : ''}`).toBe(true);
        if (!parsed.ok) continue;
        const options = { seed, iterations: 250, year: 2026 };
        const p = solve(plan, parsed.spec, options);
        const problems = checkInvariants({ plan, spec: parsed.spec }, p, solve(plan, parsed.spec, options));
        expect(problems, `seed ${seed}`).toEqual([]);
        planted += p.blocks.length;
      }
      // The runs plant things: a simulation that placed nothing would pass every invariant.
      expect(planted).toBeGreaterThan(40);
    }, 120_000);
  }
});
