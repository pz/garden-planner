import { describe, expect, it } from 'vitest';
import type { Bed, GardenPlan } from '../types';
import { CROPS } from '../data/crops';
import { isInsideOutline } from '../core/geometry';
import { bedOutline } from '../core/layout';
import { createPlan } from '../core/reducer';
import { validatePlan } from '../core/validatePlan';
import { applyCommands } from './apply';
import { isPlantingCommand, parseRequest, type Command } from './commands';
import { readLayout } from './layoutView';
import { revOf } from './rev';
import { computeWarnings } from './warnings';

// A headless simulation: random batches of commands (valid and not) are thrown at a growing
// garden, and the invariants that must hold no matter what the batch says are checked each time.

/** Small, fast, seedable PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OVAL: Bed = { id: 'oval', name: 'Oval', shape: 'ellipse', cx: 200, cy: 30, widthIn: 60, heightIn: 60, rotationDeg: 0 };
const START = (): GardenPlan => ({ ...createPlan('sim'), beds: [...createPlan('sim').beds, OVAL] });

function randomCommands(next: () => number, plan: GardenPlan): Command[] {
  const pick = <T,>(xs: T[]): T => xs[Math.floor(next() * xs.length)];
  /** A bed to plant in (rarely one that doesn't exist) with its size, so coordinates can be drawn to fit it. */
  const place = () => {
    const bed = next() < 0.03 ? undefined : pick(plan.beds);
    return { bedId: bed?.id ?? 'ghost-bed', w: bed?.widthIn ?? 96, h: bed?.heightIn ?? 48 };
  };
  const cropId = () => (next() < 0.03 ? 'ghost-crop' : pick(CROPS).id);
  // Mostly inside the 96×48 bed (and often inside the oval, which spans x 170–230); about one in eight is off the edge.
  const coord = (max: number) => Math.round((next() < 0.125 ? next() * (max + 40) - 20 : next() * max) * 10) / 10;
  const plantId = () => (plan.plants.length && next() < 0.95 ? pick(plan.plants).id : 'ghost-plant');
  const groupId = () => (plan.plants.length && next() < 0.95 ? pick(plan.plants).groupId : 'ghost-group');
  /** A layout command: sometimes with a bad size, a missing polygon corner list, or a bed that doesn't exist. */
  const layoutCommand = (): Command => {
    const bed = next() < 0.05 ? { id: 'ghost-bed', shape: 'rect' as const, widthIn: 48, heightIn: 48 } : pick(plan.beds);
    const size = () => Math.round(next() < 0.1 ? next() * 12 : 12 + next() * 90);
    const r = next();
    if (r < 0.25) {
      const w = size();
      const h = size();
      const shape = pick(['rect', 'ellipse', 'polygon'] as const);
      const points = shape === 'polygon' && next() < 0.9 ? [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w / 2, y: h }] : undefined;
      return { type: 'addBed', shape, cx: 400 + Math.floor(next() * 400), cy: Math.floor(next() * 200), widthIn: w, heightIn: h, ...(points && { points }) };
    }
    if (r < 0.4) return { type: 'moveBed', id: bed.id, dx: Math.round(next() * 40 - 20), dy: Math.round(next() * 40 - 20) };
    if (r < 0.5) return { type: 'rotateBed', id: bed.id, rotationDeg: Math.round(next() * 720 - 360) };
    if (r < 0.75) {
      const w = size();
      const h = size();
      const triangle = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w / 2, y: h }];
      return { type: 'reshapeBed', id: bed.id, cx: Math.round(next() * 100), cy: Math.round(next() * 100), widthIn: w, heightIn: h, ...(bed.shape === 'polygon' && next() < 0.9 && { points: triangle }) };
    }
    if (r < 0.85 && plan.beds.length > 1) return { type: 'removeBed', id: bed.id };
    if (r < 0.95) return { type: 'renameBed', id: bed.id, name: next() < 0.2 ? '' : `Bed ${Math.floor(next() * 9)}` };
    return { type: 'setGardenName', name: `Garden ${Math.floor(next() * 9)}` };
  };
  const n = 1 + Math.floor(next() * 3);
  const out: Command[] = [];
  for (let i = 0; i < n; i++) {
    if (next() < 0.2) {
      out.push(layoutCommand());
      continue;
    }
    const r = next();
    if (r < 0.3) {
      const b = place();
      out.push({ type: 'addPlant', ref: next() < 0.3 ? `r${i}` : undefined, bedId: b.bedId, cropId: cropId(), x: coord(b.w), y: coord(b.h) });
    } else if (r < 0.5) {
      const b = place();
      out.push({
        type: 'addPatch',
        bedId: b.bedId,
        cropId: cropId(),
        clip: next() < 0.5,
        grid: { origin: { x: coord(b.w), y: coord(b.h) }, axis: next() < 0.5 ? 'x' : 'y', columns: 1 + Math.floor(next() * 6), rows: 1 + Math.floor(next() * 4) },
      });
    } else if (r < 0.62) out.push({ type: 'removePlant', id: plantId() });
    else if (r < 0.7) out.push({ type: 'removePatch', groupId: groupId() });
    else if (r < 0.85) out.push({ type: 'movePatch', groupId: groupId(), dx: coord(30) / 2, dy: coord(20) / 2 });
    else if (r < 0.92) out.push({ type: 'setVariety', id: plantId(), variety: next() < 0.5 ? 'V' : null });
    else {
      const warnings = computeWarnings(plan);
      const id = warnings.length ? pick(warnings).id : 'spacing:x::y';
      out.push({ type: next() < 0.5 ? 'dismissWarning' : 'restoreWarning', id });
    }
  }
  return out;
}

describe('simulation: random command batches never break the garden', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`seed ${seed}`, () => {
      const next = rng(seed);
      let plan = START();
      let accepted = 0;
      let rejected = 0;
      for (let step = 0; step < 120; step++) {
        const commands = randomCommands(next, plan);
        const before = JSON.stringify(plan);
        let n1 = 0;
        let n2 = 0;
        const result = applyCommands(plan, commands, { newId: () => `a${++n1}-${step}` });
        const again = applyCommands(plan, commands, { newId: () => `a${++n2}-${step}` });

        // Pure and deterministic.
        expect(JSON.stringify(plan)).toBe(before);
        expect(again).toEqual(result);
        // Anything that is a valid request round-trips through the parser (what an HTTP layer would see).
        expect(parseRequest(JSON.parse(JSON.stringify({ commands }))).ok).toBe(true);
        // An agent-scoped request is refused exactly when it contains a layout command, and never changes anything.
        const scoped = applyCommands(plan, commands, { newId: () => `s${step}`, scope: 'planting' });
        if (commands.some((c) => !isPlantingCommand(c))) {
          expect(scoped.ok).toBe(false);
          expect(!scoped.ok && scoped.errors.some((e) => e.code === 'forbidden')).toBe(true);
        }

        if (!result.ok) {
          rejected++;
          expect(result.errors.length).toBeGreaterThan(0);
          for (const e of result.errors) {
            expect(e.code).toBeTruthy();
            expect(e.path).toMatch(/^\/commands\/\d+/);
            expect(e.commandIndex).toBeGreaterThanOrEqual(0);
            expect(e.commandIndex).toBeLessThan(commands.length);
          }
          continue;
        }
        accepted++;

        const after = result.plan;
        // A valid plan: same checks an imported file gets.
        expect(validatePlan(JSON.parse(JSON.stringify(after)))).toEqual([]);
        // Every plant center is inside its bed's shape.
        for (const p of after.plants) {
          const bed = after.beds.find((b) => b.id === p.bedId)!;
          expect(isInsideOutline({ x: p.x, y: p.y }, bedOutline(bed))).toBe(true);
        }
        // Ids are unique; a patch is one crop in one bed.
        expect(new Set(after.plants.map((p) => p.id)).size).toBe(after.plants.length);
        const groups = new Map<string, string>();
        for (const p of after.plants) {
          const sig = `${p.bedId}/${p.cropId}`;
          expect(groups.get(p.groupId) ?? sig).toBe(sig);
          groups.set(p.groupId, sig);
        }
        // Reported revision and warnings agree with the plan.
        expect(result.rev).toBe(revOf(after));
        const live = computeWarnings(after).filter((w) => !w.dismissed);
        const liveIds = new Set(live.map((w) => w.id));
        for (const w of result.warnings.introduced) expect(liveIds.has(w.id)).toBe(true);
        for (const w of result.warnings.resolved) expect(liveIds.has(w.id)).toBe(false);
        expect(result.warnings.unchanged + result.warnings.introduced.length).toBe(live.length);
        // A dry run says the same and asks not to be committed.
        const dry = applyCommands(plan, commands, { newId: () => `a${++n2}-${step}`, dryRun: true });
        expect(dry.ok && dry.committed).toBe(false);
        // A removal is reported for exactly the plants that are gone (other than by an explicit remove command).
        const gone = plan.plants.filter((p) => !after.plants.some((q) => q.id === p.id)).map((p) => p.id);
        const reported = new Set(result.results.flatMap((r) => r.removed ?? []));
        for (const id of gone) expect(reported.has(id)).toBe(true);
        // The layout view can always be drawn for what we produced.
        expect(readLayout(after).ok).toBe(true);

        plan = after;
        // Keep the garden from filling up: occasionally clear it.
        if (plan.plants.length > 150) plan = { ...plan, plants: [], dismissedConflictKeys: [] };
      }
      // The simulation exercised both outcomes, so the checks above weren't vacuous.
      expect(accepted).toBeGreaterThan(10);
      expect(rejected).toBeGreaterThan(10);
    });
  }
});
