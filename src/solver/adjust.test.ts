import { describe, expect, it } from 'vitest';
import type { Bed, GardenPlan, PlantInstance } from '../types';
import { applyCommands } from '../api/apply';
import { gridPoints } from '../core/geometry';
import { createPlan } from '../core/reducer';
import type { Command } from '../api/commands';
import { loadScenario } from './catalog';
import { checkInvariants } from './check';
import { solve } from './solve';
import type { PlantingSpec } from './spec';

const bed = (id: string, w: number, h: number, cy = h / 2): Bed => ({ id, name: id, shape: 'rect', cx: w / 2, cy, widthIn: w, heightIn: h, rotationDeg: 0 });
const planOf = (beds: Bed[], plants: PlantInstance[] = []): GardenPlan => ({ ...createPlan('t'), beds, plants });
const patch = (groupId: string, bedId: string, cropId: string, x: number, y: number, cols: number, rows: number): PlantInstance[] => {
  const s = { lettuce: 10, tomato: 24, kale: 18, pepper: 18, beans: 4, onion: 4, basil: 12, radish: 2 }[cropId] ?? 10;
  return gridPoints({ x, y }, 'x', cols, rows, s).map((p, i) => ({ id: `${groupId}-${i}`, bedId, cropId, x: p.x, y: p.y, groupId }));
};
const opts = { year: 2026, iterations: 400 };
const types = (cs: Command[]) => cs.map((c) => c.type);

describe('adjust mode', () => {
  it('leaves a patch alone when nothing asks for a change (stability 1, a spec that wants what is there)', () => {
    const before = planOf([bed('b', 96, 48)]);
    const filled = solve(before, { mode: 'fill', demands: [{ cropId: 'lettuce', weight: 1 }, { cropId: 'pepper', weight: 1 }] }, opts);
    const spec: PlantingSpec = { mode: 'adjust', prefs: { stability: 1 }, demands: [{ cropId: 'lettuce', weight: 1 }, { cropId: 'pepper', weight: 1 }] };
    const again = solve(filled.plan, spec, opts);
    expect(again.commands).toEqual([]);
    expect(again.hardViolations).toEqual([]);
  });

  it('moves a patch with movePatch (keeping its plants) and resizes with remove + add', () => {
    // A lettuce patch hard against a tomato demand that needs its spot.
    const plan = planOf([bed('b', 60, 24)], [...patch('old', 'b', 'lettuce', 0, 12, 2, 1)]);
    const spec: PlantingSpec = { mode: 'adjust', prefs: { stability: 0 }, demands: [{ cropId: 'tomato', weight: 3, min: 3 }, { cropId: 'lettuce', weight: 1 }] };
    const p = solve(plan, spec, { ...opts, iterations: 1500 });
    expect(p.hardViolations).toEqual([]);
    const order = types(p.commands);
    // Removals first, then moves, then adds.
    expect(order).toEqual([...order].sort((a, b) => ['removePatch', 'movePatch', 'addPatch'].indexOf(a) - ['removePatch', 'movePatch', 'addPatch'].indexOf(b)));
    expect(p.crops.find((c) => c.cropId === 'tomato')!.placed).toBeGreaterThanOrEqual(3);
  });

  it('with a stability of 1 touches no existing patch, however much the search would like to reshuffle', () => {
    const s = loadScenario('adjust-more-tomatoes');
    const keep = solve(s.plan, { ...s.spec, prefs: { stability: 1 } }, { year: 2026, iterations: 1500 });
    expect(keep.commands.filter((c) => c.type === 'removePatch' || c.type === 'movePatch')).toEqual([]);
    expect(keep.score.change).toBe(0);
  });

  it('counts existing patches of a demanded crop toward its demand', () => {
    const plan = planOf([bed('b', 96, 48)], patch('have', 'b', 'tomato', 12, 12, 2, 1));
    const p = solve(plan, { mode: 'adjust', demands: [{ cropId: 'tomato', weight: 1, max: 2 }] }, opts);
    expect(p.crops[0]).toMatchObject({ placed: 2, status: 'met' });
    expect(p.commands.filter((c) => c.type === 'addPatch')).toEqual([]);
  });

  it('removes patches of an excluded crop, grid-shaped or not, and nothing else', () => {
    const crooked = [...patch('bean', 'b', 'beans', 4, 4, 2, 1), { id: 'odd', bedId: 'b', cropId: 'beans', x: 10, y: 20, groupId: 'bean' }];
    const plan = planOf([bed('b', 96, 48)], [...crooked, ...patch('keep', 'b', 'lettuce', 40, 4, 2, 1)]);
    const p = solve(plan, { mode: 'adjust', exclude: ['beans'], demands: [{ cropId: 'pepper', weight: 1 }] }, opts);
    expect(p.commands.filter((c) => c.type === 'removePatch')).toEqual([{ type: 'removePatch', groupId: 'bean' }]);
    expect(p.plan.plants.filter((q) => q.groupId === 'keep')).toHaveLength(2);
    expect(p.plan.plants.some((q) => q.cropId === 'beans')).toBe(false);
  });

  it('leaves a non-grid patch of a demanded crop, a crop nobody asked about, and a locked patch fixed', () => {
    const l = [...patch('L', 'b', 'lettuce', 0, 0, 2, 1), { id: 'extra', bedId: 'b', cropId: 'lettuce', x: 40, y: 40, groupId: 'L' }]; // not a grid
    const plan = planOf([bed('b', 96, 48)], [...l, ...patch('K', 'b', 'kale', 60, 4, 2, 1), ...patch('T', 'b', 'tomato', 4, 28, 2, 1)]);
    const spec: PlantingSpec = { mode: 'adjust', locked: ['T'], prefs: { stability: 0 }, demands: [{ cropId: 'lettuce', weight: 1 }, { cropId: 'tomato', weight: 1 }, { cropId: 'basil', weight: 1 }] };
    const p = solve(plan, spec, { ...opts, iterations: 800 });
    for (const g of ['L', 'K', 'T']) expect(p.plan.plants.filter((q) => q.groupId === g)).toEqual(plan.plants.filter((q) => q.groupId === g));
    expect(p.commands.some((c) => 'groupId' in c && ['L', 'K', 'T'].includes(c.groupId ?? ''))).toBe(false);
  });

  it('does not move a patch of a crop out of beds the demand allows', () => {
    const plan = planOf([bed('a', 96, 48), bed('b', 96, 48, 100)], patch('P', 'a', 'pepper', 4, 4, 2, 1));
    const p = solve(plan, { mode: 'adjust', prefs: { stability: 0 }, demands: [{ cropId: 'pepper', weight: 1, bedIds: ['b'] }] }, opts);
    expect(p.plan.plants.filter((q) => q.groupId === 'P')).toHaveLength(2);
    expect(p.plan.plants.filter((q) => q.groupId === 'P').every((q) => q.bedId === 'a')).toBe(true);
  });

  it('keeps outside-scope beds untouched', () => {
    const plan = planOf([bed('a', 96, 48), bed('b', 96, 48, 100)], [...patch('A', 'a', 'lettuce', 4, 4, 2, 2), ...patch('B', 'b', 'lettuce', 4, 4, 2, 2)]);
    const p = solve(plan, { mode: 'adjust', scope: { bedIds: ['b'] }, prefs: { stability: 0 }, demands: [{ cropId: 'lettuce', weight: 1 }, { cropId: 'kale', weight: 1 }] }, opts);
    expect(p.plan.plants.filter((q) => q.groupId === 'A')).toEqual(plan.plants.filter((q) => q.groupId === 'A'));
  });
});

describe('replace mode', () => {
  it('removes everything in scope that is not locked, whatever the crop, and plants from scratch', () => {
    const plan = planOf([bed('a', 96, 48), bed('b', 96, 48, 100)], [...patch('A', 'a', 'lettuce', 4, 4, 2, 2), ...patch('B', 'b', 'kale', 4, 4, 2, 1), ...patch('Lk', 'b', 'tomato', 60, 4, 1, 1)]);
    const spec: PlantingSpec = { mode: 'replace', scope: { bedIds: ['b'] }, locked: ['Lk'], demands: [{ cropId: 'pepper', weight: 1 }] };
    const p = solve(plan, spec, opts);
    expect(p.hardViolations).toEqual([]);
    expect(p.commands.filter((c) => c.type === 'removePatch')).toEqual([{ type: 'removePatch', groupId: 'B' }]);
    expect(p.commands.filter((c) => c.type === 'movePatch')).toEqual([]);
    expect(p.plan.plants.filter((q) => q.groupId === 'A')).toHaveLength(4);
    expect(p.plan.plants.filter((q) => q.groupId === 'Lk')).toHaveLength(1);
    expect(p.plan.plants.some((q) => q.cropId === 'kale')).toBe(false);
    expect(p.blocks.every((b) => b.cropId === 'pepper' && b.bedId === 'b')).toBe(true);
  });

  it('may put the new plants where the removed ones were', () => {
    const plan = planOf([bed('b', 48, 48)], patch('old', 'b', 'tomato', 0, 0, 2, 2));
    const p = solve(plan, { mode: 'replace', demands: [{ cropId: 'tomato', weight: 1 }] }, opts);
    expect(p.crops[0].placed).toBeGreaterThanOrEqual(3);
    expect(p.hardViolations).toEqual([]);
  });
});

describe('commands round trip', () => {
  it('apply cleanly to the original plan and give the planned plan', () => {
    for (const name of ['adjust-more-tomatoes', 'adjust-swap-beans', 'replace-bed-2']) {
      const s = loadScenario(name);
      const p = solve(s.plan, s.spec, { year: 2026, iterations: 500 });
      let n = 0;
      const applied = applyCommands(s.plan, p.commands, { newId: () => `x${++n}`, scope: 'planting' });
      expect(applied.ok, name).toBe(true);
      if (applied.ok) expect(applied.plan.plants.length).toBe(p.plan.plants.length);
      expect(checkInvariants(s, p, solve(s.plan, s.spec, { year: 2026, iterations: 500 })), name).toEqual([]);
    }
  });
});
