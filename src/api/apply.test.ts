import { describe, expect, it } from 'vitest';
import type { Bed, GardenPlan, PlantInstance } from '../types';
import { createPlan } from '../core/reducer';
import { applyCommands, type ApplyResult } from './apply';
import type { Command } from './commands';
import { revOf } from './rev';
import { computeWarnings } from './warnings';

/** Predictable ids: n1, n2, … */
const counter = () => {
  let n = 0;
  return () => `n${++n}`;
};
const apply = (plan: GardenPlan, commands: Command[], more: { ifRev?: string; dryRun?: boolean } = {}) =>
  applyCommands(plan, commands, { newId: counter(), ...more });

const plantOf = (id: string, over: Partial<PlantInstance> = {}): PlantInstance => ({
  id,
  bedId: 'bed-1',
  cropId: 'tomato',
  x: 10,
  y: 10,
  groupId: id,
  ...over,
});
// createPlan: one 96×48 in rect bed "bed-1" with square corners.
const planWith = (plants: PlantInstance[], over: Partial<GardenPlan> = {}): GardenPlan => ({ ...createPlan('g'), plants, ...over });
const ellipseBed: Bed = { id: 'oval', name: 'Oval', shape: 'ellipse', cx: 200, cy: 24, widthIn: 40, heightIn: 40, rotationDeg: 0 };

function ok(r: ApplyResult) {
  if (!r.ok) throw new Error('expected success, got ' + JSON.stringify(r.errors));
  return r;
}
function errorsOf(r: ApplyResult) {
  if (r.ok) throw new Error('expected errors');
  return r.errors;
}
const codes = (r: ApplyResult) => errorsOf(r).map((e) => e.code);

describe('addPlant', () => {
  it('adds a plant in its own patch and reports its ids', () => {
    const r = ok(apply(createPlan('g'), [{ type: 'addPlant', ref: 'a', bedId: 'bed-1', cropId: 'kale', x: 20, y: 30, variety: 'Lacinato' }]));
    expect(r.plan.plants).toEqual([{ id: 'n1', bedId: 'bed-1', cropId: 'kale', x: 20, y: 30, variety: 'Lacinato', groupId: 'n2' }]);
    expect(r.results).toEqual([{ type: 'addPlant', ref: 'a', plantIds: ['n1'], groupId: 'n2' }]);
    expect(r.rev).toBe(revOf(r.plan));
    expect(r.committed).toBe(true);
  });

  it('does not mutate the plan it was given', () => {
    const plan = planWith([plantOf('a')]);
    const snapshot = JSON.parse(JSON.stringify(plan));
    ok(apply(plan, [{ type: 'addPlant', bedId: 'bed-1', cropId: 'kale', x: 50, y: 30 }, { type: 'removePlant', id: 'a' }]));
    expect(plan).toEqual(snapshot);
  });

  it('accepts a center exactly on the bed edge and corner, and rejects one just past it', () => {
    const edge = (x: number, y: number) => apply(createPlan('g'), [{ type: 'addPlant', bedId: 'bed-1', cropId: 'basil', x, y }]);
    for (const [x, y] of [[0, 0], [96, 48], [96, 0], [0, 48]]) expect(edge(x, y).ok).toBe(true);
    for (const [x, y] of [[96.01, 10], [-0.01, 10], [10, 48.01], [10, -0.01]]) expect(codes(edge(x, y))).toEqual(['outside_bed']);
  });

  it('explains an outside placement and suggests the nearest valid point', () => {
    const [e] = errorsOf(apply(createPlan('g'), [{ type: 'addPlant', bedId: 'bed-1', cropId: 'basil', x: 101, y: 20 }]));
    expect(e).toMatchObject({
      code: 'outside_bed',
      commandIndex: 0,
      path: '/commands/0',
      details: { bedId: 'bed-1', point: { x: 101, y: 20 } },
      suggestion: { nearestValidPoint: { x: 96, y: 20 } },
    });
    expect(e.message).toContain('(101, 20)');
    expect(e.message).toContain('Bed 1');
  });

  it("respects a bed's shape, not just its bounding box", () => {
    const plan = planWith([], { beds: [ellipseBed] });
    // The ellipse's box corner (180, 4) is outside the curve; its center is inside.
    const at = (x: number, y: number) => apply(plan, [{ type: 'addPlant', bedId: 'oval', cropId: 'basil', x, y }]);
    expect(at(20, 20).ok).toBe(true);
    expect(codes(at(1, 1))).toEqual(['outside_bed']);
  });

  it('rejects an unknown bed and an unknown crop, reporting both', () => {
    const r = apply(createPlan('g'), [{ type: 'addPlant', bedId: 'nope', cropId: 'kale2', x: 1, y: 1 }]);
    expect(errorsOf(r).map((e) => [e.code, e.path])).toEqual([
      ['unknown_bed', '/commands/0/bedId'],
      ['unknown_crop', '/commands/0/cropId'],
    ]);
  });

  it('uses a client-supplied id and groupId (e.g. to restore a plant) and rejects collisions', () => {
    const plan = planWith([plantOf('old')]);
    const restored = ok(apply(plan, [{ type: 'addPlant', bedId: 'bed-1', cropId: 'kale', x: 60, y: 30, id: 'back', groupId: 'g-back' }]));
    expect(restored.plan.plants.at(-1)).toMatchObject({ id: 'back', groupId: 'g-back' });
    expect(codes(apply(plan, [{ type: 'addPlant', bedId: 'bed-1', cropId: 'kale', x: 60, y: 30, id: 'old' }]))).toEqual(['duplicate_id']);
  });

  it('lets a client-supplied groupId join an existing patch of the same bed and crop, but not another crop', () => {
    const plan = planWith([plantOf('a', { cropId: 'carrot', groupId: 'row' })]);
    expect(ok(apply(plan, [{ type: 'addPlant', bedId: 'bed-1', cropId: 'carrot', x: 13, y: 10, groupId: 'row' }])).plan.plants).toHaveLength(2);
    expect(codes(apply(plan, [{ type: 'addPlant', bedId: 'bed-1', cropId: 'kale', x: 60, y: 10, groupId: 'row' }]))).toEqual(['duplicate_id']);
  });
});

describe('addPatch', () => {
  it('plants a block on the grid at the crop spacing, in one patch', () => {
    // carrot spacing is 3 in
    const r = ok(apply(createPlan('g'), [{ type: 'addPatch', ref: 'row', bedId: 'bed-1', cropId: 'carrot', grid: { origin: { x: 6, y: 6 }, axis: 'x', columns: 3, rows: 2 } }]));
    expect(r.plan.plants.map((p) => [p.x, p.y])).toEqual([[6, 6], [9, 6], [12, 6], [6, 9], [9, 9], [12, 9]]);
    expect(new Set(r.plan.plants.map((p) => p.groupId)).size).toBe(1);
    expect(r.results[0]).toMatchObject({ type: 'addPatch', ref: 'row', plantIds: r.plan.plants.map((p) => p.id), groupId: r.plan.plants[0].groupId });
  });

  it('plants explicit points', () => {
    const r = ok(apply(createPlan('g'), [{ type: 'addPatch', bedId: 'bed-1', cropId: 'beans', points: [{ x: 5, y: 5 }, { x: 40, y: 20 }] }]));
    expect(r.plan.plants.map((p) => [p.x, p.y])).toEqual([[5, 5], [40, 20]]);
  });

  it('rejects the whole command when any point is outside, naming each point', () => {
    const r = apply(createPlan('g'), [{ type: 'addPatch', bedId: 'bed-1', cropId: 'beans', points: [{ x: 5, y: 5 }, { x: 97, y: 5 }, { x: 5, y: 49 }] }]);
    expect(errorsOf(r).map((e) => [e.code, e.path])).toEqual([
      ['outside_bed', '/commands/0/points/1'],
      ['outside_bed', '/commands/0/points/2'],
    ]);
  });

  it('with clip, drops outside points, reports them, and plants the rest', () => {
    const r = ok(apply(createPlan('g'), [{ type: 'addPatch', bedId: 'bed-1', cropId: 'beans', clip: true, points: [{ x: 5, y: 5 }, { x: 97, y: 5 }] }]));
    expect(r.plan.plants.map((p) => p.x)).toEqual([5]);
    expect(r.results[0].skipped).toEqual([{ x: 97, y: 5 }]);
  });

  it('with clip, a grid hanging off the bed edge keeps only the part inside', () => {
    // 5 columns of carrots 3 in apart from x=90: 90, 93, 96 are inside (96 is the edge), 99 and 102 are not.
    const r = ok(apply(createPlan('g'), [{ type: 'addPatch', bedId: 'bed-1', cropId: 'carrot', clip: true, grid: { origin: { x: 90, y: 10 }, axis: 'x', columns: 5, rows: 1 } }]));
    expect(r.plan.plants.map((p) => p.x)).toEqual([90, 93, 96]);
    expect(r.results[0].skipped).toHaveLength(2);
  });

  it('is an empty patch error when there is nothing to plant', () => {
    expect(codes(apply(createPlan('g'), [{ type: 'addPatch', bedId: 'bed-1', cropId: 'beans', points: [] }]))).toEqual(['empty_patch']);
    expect(codes(apply(createPlan('g'), [{ type: 'addPatch', bedId: 'bed-1', cropId: 'beans', clip: true, points: [{ x: 200, y: 5 }] }]))).toEqual(['empty_patch']);
  });

  it('rejects bad grids: non-positive or fractional counts, and more than a patch can hold', () => {
    const grid = (columns: number, rows: number): Command => ({ type: 'addPatch', bedId: 'bed-1', cropId: 'beans', grid: { origin: { x: 1, y: 1 }, axis: 'x', columns, rows } });
    for (const [c, r] of [[0, 1], [1, 0], [-1, 2], [1.5, 1]]) expect(codes(apply(createPlan('g'), [grid(c, r)]))).toEqual(['invalid_grid']);
    expect(codes(apply(createPlan('g'), [grid(1001, 1)]))).toEqual(['invalid_grid']);
  });

  it('caps the per-command outside-bed errors and says how many more there were', () => {
    const r = apply(createPlan('g'), [{ type: 'addPatch', bedId: 'bed-1', cropId: 'carrot', grid: { origin: { x: 200, y: 10 }, axis: 'x', columns: 30, rows: 1 } }]);
    const errors = errorsOf(r);
    expect(errors).toHaveLength(21);
    expect(errors.at(-1)?.message).toContain('10 more');
  });
});

describe('batches', () => {
  it('applies commands in order, each seeing the ones before', () => {
    const r = ok(apply(createPlan('g'), [
      { type: 'addPatch', ref: 'row', bedId: 'bed-1', cropId: 'carrot', points: [{ x: 10, y: 10 }, { x: 13, y: 10 }] },
      { type: 'movePatch', groupId: '$row', dx: 20, dy: 5 },
      { type: 'addPlant', ref: 'k', bedId: 'bed-1', cropId: 'kale', x: 70, y: 30 },
      { type: 'setVariety', id: '$k', variety: 'Red Russian' },
    ]));
    expect(r.plan.plants.map((p) => [p.cropId, p.x, p.y, p.variety])).toEqual([
      ['carrot', 30, 15, undefined],
      ['carrot', 33, 15, undefined],
      ['kale', 70, 30, 'Red Russian'],
    ]);
  });

  it('is all or nothing: errors in any command mean no plan, and every error is reported with its command index', () => {
    const r = apply(createPlan('g'), [
      { type: 'addPlant', bedId: 'bed-1', cropId: 'kale', x: 50, y: 20 }, // fine
      { type: 'addPlant', bedId: 'bed-1', cropId: 'nope', x: 50, y: 20 },
      { type: 'removePlant', id: 'ghost' },
    ]);
    expect(r.ok).toBe(false);
    expect(errorsOf(r).map((e) => [e.commandIndex, e.code])).toEqual([[1, 'unknown_crop'], [2, 'unknown_id']]);
  });

  it('rejects an unknown or duplicate ref, and quietly skips commands that depend on a failed one', () => {
    const r = apply(createPlan('g'), [
      { type: 'addPlant', ref: 'bad', bedId: 'bed-1', cropId: 'kale', x: 500, y: 0 }, // fails
      { type: 'setVariety', id: '$bad', variety: 'x' }, // depends on it: no extra error
      { type: 'removePlant', id: '$never' }, // unknown ref
      { type: 'addPlant', ref: 'a', bedId: 'bed-1', cropId: 'kale', x: 5, y: 5 },
      { type: 'addPlant', ref: 'a', bedId: 'bed-1', cropId: 'kale', x: 60, y: 5 }, // duplicate ref
    ]);
    expect(errorsOf(r).map((e) => [e.commandIndex, e.code])).toEqual([[0, 'outside_bed'], [2, 'unknown_id'], [4, 'duplicate_ref']]);
  });

  it('does not let a plant command take a patch ref', () => {
    const r = apply(createPlan('g'), [
      { type: 'addPatch', ref: 'p', bedId: 'bed-1', cropId: 'carrot', points: [{ x: 5, y: 5 }, { x: 8, y: 5 }] },
      { type: 'removePlant', id: '$p' },
    ]);
    expect(errorsOf(r)[0]).toMatchObject({ commandIndex: 1, code: 'unknown_id' });
    expect(errorsOf(r)[0].message).toContain('patch');
  });

  it('accepts an empty batch, changing nothing', () => {
    const plan = planWith([plantOf('a')]);
    const r = ok(apply(plan, []));
    expect(r.plan).toBe(plan);
    expect(r.results).toEqual([]);
    expect(r.warnings).toEqual({ introduced: [], resolved: [], unchanged: 0 });
  });
});

describe('removing, moving and editing', () => {
  const patchPlan = () =>
    planWith([
      plantOf('c1', { cropId: 'carrot', x: 90, y: 20, groupId: 'row' }),
      plantOf('c2', { cropId: 'carrot', x: 93, y: 20, groupId: 'row' }),
      plantOf('k', { cropId: 'kale', x: 30, y: 30 }),
    ]);

  it('removePlant removes one plant and reports it', () => {
    const r = ok(apply(patchPlan(), [{ type: 'removePlant', id: 'c1' }]));
    expect(r.plan.plants.map((p) => p.id)).toEqual(['c2', 'k']);
    expect(r.results[0]).toEqual({ type: 'removePlant', removed: ['c1'], groupId: 'row' });
  });

  it('removePatch removes every member and only them', () => {
    const r = ok(apply(patchPlan(), [{ type: 'removePatch', groupId: 'row' }]));
    expect(r.plan.plants.map((p) => p.id)).toEqual(['k']);
    expect(r.results[0]).toEqual({ type: 'removePatch', groupId: 'row', removed: ['c1', 'c2'] });
  });

  it('names an id that does not exist', () => {
    expect(codes(apply(patchPlan(), [{ type: 'removePatch', groupId: 'nope' }, { type: 'movePatch', groupId: 'nope', dx: 1, dy: 1 }, { type: 'setVariety', id: 'nope', variety: 'x' }]))).toEqual(['unknown_id', 'unknown_id', 'unknown_id']);
  });

  it('movePatch moves every member by the same amount, allowing a move that ends exactly on the edge', () => {
    const r = ok(apply(patchPlan(), [{ type: 'movePatch', groupId: 'row', dx: 3, dy: -20 }])); // c2 lands on (96, 0): a corner, inside
    expect(r.plan.plants.filter((p) => p.groupId === 'row').map((p) => [p.x, p.y])).toEqual([[93, 0], [96, 0]]);
  });

  it('movePatch refuses a move that puts any member outside, and suggests the furthest fit', () => {
    const [e] = errorsOf(apply(patchPlan(), [{ type: 'movePatch', groupId: 'row', dx: 3.01, dy: 0 }]));
    expect(e.code).toBe('outside_bed');
    expect(e.suggestion).toEqual({ dx: 3, dy: 0 });
  });

  it('setVariety sets and clears', () => {
    const set = ok(apply(patchPlan(), [{ type: 'setVariety', id: 'k', variety: 'Lacinato' }]));
    expect(set.plan.plants.find((p) => p.id === 'k')?.variety).toBe('Lacinato');
    const cleared = ok(apply(set.plan, [{ type: 'setVariety', id: 'k', variety: null }]));
    expect(cleared.plan.plants.find((p) => p.id === 'k')?.variety).toBeUndefined();
  });
});

describe('warnings', () => {
  // tomato 24 in + basil 12 in → gap 18 in
  const tomato = () => planWith([plantOf('t', { x: 20, y: 24 })]);

  it('reports a warning a batch introduces, but still applies the batch', () => {
    const r = ok(apply(tomato(), [{ type: 'addPlant', bedId: 'bed-1', cropId: 'basil', x: 30, y: 24 }]));
    expect(r.plan.plants).toHaveLength(2);
    expect(r.warnings.introduced).toEqual([expect.objectContaining({ kind: 'spacing', severity: 'problem', message: expect.stringContaining('10 in apart') })]);
    expect(r.warnings.resolved).toEqual([]);
  });

  it('reports a warning the batch resolves, and ones it leaves alone', () => {
    const crowded = ok(apply(tomato(), [
      { type: 'addPlant', ref: 'b', bedId: 'bed-1', cropId: 'basil', x: 30, y: 24 },
      { type: 'addPlant', bedId: 'bed-1', cropId: 'kale', x: 80, y: 24 },
      { type: 'addPlant', bedId: 'bed-1', cropId: 'kale', x: 85, y: 24 }, // a second, separate crowding
    ])).plan;
    const r = ok(apply(crowded, [{ type: 'movePatch', groupId: crowded.plants[1].groupId, dx: 25, dy: 0 }]));
    expect(r.warnings.resolved).toHaveLength(1);
    expect(r.warnings.resolved[0].subjects).toContain('t');
    expect(r.warnings.unchanged).toBe(1);
    expect(r.warnings.introduced).toEqual([]);
  });

  it('dismisses and restores a warning by id', () => {
    const crowded = ok(apply(tomato(), [{ type: 'addPlant', bedId: 'bed-1', cropId: 'basil', x: 30, y: 24 }])).plan;
    const [{ id }] = computeWarnings(crowded);
    const dismissed = ok(apply(crowded, [{ type: 'dismissWarning', id }])).plan;
    expect(dismissed.dismissedConflictKeys).toEqual([id.slice('spacing:'.length)]);
    const restored = ok(apply(dismissed, [{ type: 'restoreWarning', id }])).plan;
    expect(restored.dismissedConflictKeys).toEqual([]);
  });

  it('does not count a dismissed warning as newly introduced', () => {
    const dismissedKey = ['t', 'n2'].sort().join('::');
    const plan = { ...tomato(), dismissedConflictKeys: [dismissedKey] };
    const r = ok(apply(plan, [{ type: 'addPlant', bedId: 'bed-1', cropId: 'basil', x: 30, y: 24 }])); // n1 = plant id, n2 = group id
    expect(r.warnings.introduced).toEqual([]);
  });

  it('rejects dismissing a warning that does not exist', () => {
    expect(codes(apply(tomato(), [{ type: 'dismissWarning', id: 'spacing:a::b' }, { type: 'restoreWarning', id: 'nope' }]))).toEqual(['unknown_id', 'unknown_id']);
  });
});

describe('revisions and dry runs', () => {
  const plan = () => planWith([plantOf('a')]);
  const add: Command[] = [{ type: 'addPlant', bedId: 'bed-1', cropId: 'kale', x: 60, y: 30 }];

  it('applies when ifRev matches and rejects with the current rev when it does not', () => {
    expect(apply(plan(), add, { ifRev: revOf(plan()) }).ok).toBe(true);
    const [e] = errorsOf(apply(plan(), add, { ifRev: 'stale' }));
    expect(e).toMatchObject({ code: 'stale_revision', details: { rev: revOf(plan()) } });
  });

  it('checks ifRev before looking at the commands', () => {
    expect(codes(apply(plan(), [{ type: 'removePlant', id: 'ghost' }], { ifRev: 'stale' }))).toEqual(['stale_revision']);
  });

  it('a dry run reports exactly what a real run would, and says not to commit', () => {
    const real = ok(apply(plan(), add));
    const dry = ok(apply(plan(), add, { dryRun: true }));
    expect(dry.committed).toBe(false);
    expect({ ...dry, committed: true }).toEqual(real);
  });

  it('a dry run still reports errors', () => {
    expect(codes(apply(plan(), [{ type: 'removePlant', id: 'ghost' }], { dryRun: true }))).toEqual(['unknown_id']);
  });

  it('gives the same result for the same inputs', () => {
    expect(apply(plan(), add)).toEqual(apply(plan(), add));
  });
});
