import { describe, expect, it } from 'vitest';
import type { PlantInstance } from '../types';
import { CROPS } from '../data/crops';
import { findSpacingConflicts, HARD_SPACING_FACTOR, conflictKey } from '../core/spacing';
import { gridPoints } from '../core/geometry';
import { mulberry32 } from '../core/random';
import { fastSpacingConflicts } from './fastSpacing';

// The solver's fast checks must agree with the rules in core/, which are the rules the UI and the
// API apply. These run each pair of implementations on seeded random layouts.

/** A random layout: a few beds, each with some patches (grids) and solo plants at random spots. */
export function randomPlants(seed: number): PlantInstance[] {
  const next = mulberry32(seed);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(next() * xs.length)];
  const plants: PlantInstance[] = [];
  let id = 0;
  const patches = 2 + Math.floor(next() * 10);
  for (let g = 0; g < patches; g++) {
    const crop = pick(CROPS);
    const bedId = pick(['a', 'b']);
    const origin = { x: Math.round(next() * 960) / 10, y: Math.round(next() * 480) / 10 };
    const solo = next() < 0.3;
    const cols = solo ? 1 : 1 + Math.floor(next() * 4);
    const rows = solo ? 1 : 1 + Math.floor(next() * 3);
    for (const p of gridPoints(origin, 'x', cols, rows, crop.spacingIn)) plants.push({ id: `p${id++}`, bedId, cropId: crop.id, x: p.x, y: p.y, groupId: `g${g}` });
  }
  return plants;
}

describe('fastSpacingConflicts agrees with findSpacingConflicts', () => {
  it('on 200 random layouts', () => {
    let conflicts = 0;
    let problems = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const plants = randomPlants(seed);
      const core = new Map(findSpacingConflicts(plants).map((c) => [conflictKey(c.a, c.b), c]));
      const fast = new Map(fastSpacingConflicts(plants).map((c) => [conflictKey(c.a, c.b), c]));
      expect([...fast.keys()].sort(), `seed ${seed}`).toEqual([...core.keys()].sort());
      for (const [key, c] of core) {
        const f = fast.get(key)!;
        expect(f.distanceIn).toBeCloseTo(c.distanceIn, 9);
        expect(f.requiredGapIn).toBe(c.requiredGapIn);
        expect(f.bedId).toBe(c.bedId);
        expect(f.problem).toBe(c.distanceIn < c.requiredGapIn * HARD_SPACING_FACTOR);
        conflicts++;
        if (f.problem) problems++;
      }
    }
    // The layouts are dense enough to exercise both severities.
    expect(conflicts).toBeGreaterThan(200);
    expect(problems).toBeGreaterThan(50);
  });
});
