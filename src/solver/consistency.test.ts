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
export function randomPlants(seed: number, favor: string[] = []): PlantInstance[] {
  const next = mulberry32(seed);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(next() * xs.length)];
  const plants: PlantInstance[] = [];
  let id = 0;
  const patches = 2 + Math.floor(next() * 10);
  for (let g = 0; g < patches; g++) {
    const favored = favor.length && next() < 0.4 ? pick(favor) : undefined;
    const crop = favored ? CROPS.find((c) => c.id === favored)! : pick(CROPS);
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

// Shade and companion rules, across beds that are turned and a garden whose north is anywhere.
import type { Bed } from '../types';
import { findCompanionConflicts } from '../core/companions';
import { findShadeConflicts, shadowDirection } from '../core/shade';
import { bedOutline } from '../core/layout';
import { makeGroup, patches } from './groups';
import type { BedInfo } from './model';
import { companionWeight, shades } from './pairRules';

function randomGarden(seed: number) {
  const next = mulberry32(seed * 7919);
  const beds: Bed[] = ['a', 'b'].map((id, i) => ({ id, name: id, shape: 'rect', cx: 60 + next() * 40, cy: 30 + i * 90 + next() * 20, widthIn: 96, heightIn: 48, rotationDeg: next() < 0.5 ? 0 : Math.round(next() * 360) }));
  // The only crop pair the data says to keep apart is beans and onion, so favor them.
  const plants = randomPlants(seed, ['beans', 'onion']);
  const northDeg = [0, 90, 180, 270, Math.round(next() * 360)][Math.floor(next() * 5)];
  const lat = next() < 0.3 ? -30 : next() < 0.1 ? undefined : 40;
  return { beds, plants, northDeg, lat };
}

describe('shade and companion rules agree with core', () => {
  it('on 200 random gardens', () => {
    let shaded = 0;
    let companions = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { beds, plants, northDeg, lat } = randomGarden(seed);
      const bedInfo = new Map<string, BedInfo>(beds.map((bed) => [bed.id, { bed, outline: bedOutline(bed), inScope: true }]));
      const groups = [...patches(plants)].map(([id, ps]) => makeGroup(id, ps[0].bedId, ps[0].cropId, ps.map((p) => ({ x: p.x, y: p.y })), bedInfo, true));
      const dir = shadowDirection(northDeg, lat);

      const coreShade = new Set(findShadeConflicts(plants, beds, northDeg, lat).map((c) => `${c.caster}>${c.shaded}`));
      const mineShade = new Set<string>();
      for (const a of groups) for (const b of groups) if (shades(a, b, dir)) mineShade.add(`${a.id}>${b.id}`);
      expect([...mineShade].sort(), `shade, seed ${seed}`).toEqual([...coreShade].sort());
      shaded += coreShade.size;

      const coreCompanion = new Map(findCompanionConflicts(plants).map((c) => [conflictKey(c.a, c.b), c.evidence === 'anecdotal' ? 0.5 : 1]));
      const mineCompanion = new Map<string, number>();
      for (let i = 0; i < groups.length; i++) {
        for (let j = i + 1; j < groups.length; j++) {
          const w = companionWeight(groups[i], groups[j]);
          expect(w).toBe(companionWeight(groups[j], groups[i]));
          if (w > 0) mineCompanion.set(conflictKey(groups[i].id, groups[j].id), w);
        }
      }
      expect([...mineCompanion].sort(), `companion, seed ${seed}`).toEqual([...coreCompanion].sort());
      companions += coreCompanion.size;
    }
    // The layouts produce both kinds of conflict often enough to mean something.
    expect(shaded).toBeGreaterThan(40);
    expect(companions).toBeGreaterThan(5);
  });
});
