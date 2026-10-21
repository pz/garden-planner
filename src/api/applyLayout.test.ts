import { describe, expect, it } from 'vitest';
import type { Bed, GardenPlan, PlantInstance } from '../types';
import { createPlan } from '../core/reducer';
import { applyCommands, type ApplyResult } from './apply';
import type { Command } from './commands';

let n = 0;
const apply = (plan: GardenPlan, commands: Command[], more: { dryRun?: boolean; scope?: 'all' | 'planting' } = {}) => {
  n = 0;
  return applyCommands(plan, commands, { newId: () => `n${++n}`, ...more });
};
function ok(r: ApplyResult) {
  if (!r.ok) throw new Error('expected success, got ' + JSON.stringify(r.errors));
  return r;
}
const errorsOf = (r: ApplyResult) => {
  if (r.ok) throw new Error('expected errors');
  return r.errors;
};
const codes = (r: ApplyResult) => errorsOf(r).map((e) => e.code);

const plant = (id: string, over: Partial<PlantInstance> = {}): PlantInstance => ({ id, bedId: 'bed-1', cropId: 'kale', x: 10, y: 10, groupId: id, ...over });
// createPlan: bed-1, a 96×48 rect centered at (48, 24).
const bed2: Bed = { id: 'bed-2', name: 'Second', shape: 'rect', cx: 200, cy: 24, widthIn: 48, heightIn: 48, rotationDeg: 0 };
const planWith = (plants: PlantInstance[] = [], extraBeds: Bed[] = []): GardenPlan => {
  const base = createPlan('g');
  return { ...base, beds: [...base.beds, ...extraBeds], plants };
};

describe('scope', () => {
  const layoutCommands: Command[] = [
    { type: 'addBed', shape: 'rect', cx: 0, cy: 0, widthIn: 24, heightIn: 24 },
    { type: 'renameBed', id: 'bed-1', name: 'x' },
    { type: 'moveBed', id: 'bed-1', dx: 1, dy: 1 },
    { type: 'reshapeBed', id: 'bed-1', cx: 48, cy: 24, widthIn: 96, heightIn: 48 },
    { type: 'rotateBed', id: 'bed-1', rotationDeg: 90 },
    { type: 'removeBed', id: 'bed-1' },
    { type: 'pasteBed', bed: bed2, plants: [] },
    { type: 'restoreLayout', beds: [], plants: [] },
    { type: 'setGardenName', name: 'x' },
    { type: 'setNorth', northDeg: 90 },
    { type: 'setProfile', profile: { zoneId: '6', sunExposure: 'shade', onboarded: true } },
  ];

  it('with scope "planting", refuses every bed or profile command, each with its own error', () => {
    const r = apply(planWith(), layoutCommands, { scope: 'planting' });
    expect(errorsOf(r).map((e) => [e.commandIndex, e.code])).toEqual(layoutCommands.map((_, i) => [i, 'forbidden']));
  });

  it('with scope "planting", still allows planting commands, and reports forbidden ones next to other errors', () => {
    const plan = planWith();
    expect(apply(plan, [{ type: 'addPlant', bedId: 'bed-1', cropId: 'kale', x: 5, y: 5 }], { scope: 'planting' }).ok).toBe(true);
    const r = apply(plan, [{ type: 'removePlant', id: 'ghost' }, { type: 'renameBed', id: 'bed-1', name: 'x' }], { scope: 'planting' });
    expect(codes(r)).toEqual(['unknown_id', 'forbidden']);
  });

  it('allows everything by default', () => {
    for (const c of layoutCommands.slice(1, 5)) expect(apply(planWith(), [c]).ok).toBe(true);
  });
});

describe('addBed', () => {
  it('adds a bed with a generated id, the next default name and no rotation', () => {
    const r = ok(apply(planWith(), [{ type: 'addBed', shape: 'ellipse', cx: 300, cy: 40, widthIn: 36, heightIn: 24 }]));
    expect(r.plan.beds.at(-1)).toEqual({ id: 'n1', name: 'Bed 2', shape: 'ellipse', cx: 300, cy: 40, widthIn: 36, heightIn: 24, rotationDeg: 0 });
    expect(r.results[0]).toMatchObject({ type: 'addBed', bedId: 'n1' });
  });

  it('keeps a supplied id, name, rotation, polygon corners and corner radius', () => {
    const poly = ok(apply(planWith(), [{ type: 'addBed', id: 'p', name: 'Tri', shape: 'polygon', cx: 300, cy: 40, widthIn: 48, heightIn: 48, rotationDeg: 45, points: [{ x: 0, y: 0 }, { x: 48, y: 0 }, { x: 24, y: 48 }] }]));
    expect(poly.plan.beds.at(-1)).toMatchObject({ id: 'p', name: 'Tri', rotationDeg: 45, points: [{ x: 0, y: 0 }, { x: 48, y: 0 }, { x: 24, y: 48 }] });
    const round = ok(apply(planWith(), [{ type: 'addBed', shape: 'rect', cx: 300, cy: 40, widthIn: 48, heightIn: 24, cornerRadiusIn: 12 }]));
    expect(round.plan.beds.at(-1)?.cornerRadiusIn).toBe(12);
  });

  it('accepts a side of exactly 12 in and rejects one just under, naming the problem', () => {
    const bed = (w: number): Command => ({ type: 'addBed', shape: 'rect', cx: 0, cy: 0, widthIn: w, heightIn: 12 });
    expect(apply(planWith(), [bed(12)]).ok).toBe(true);
    const [e] = errorsOf(apply(planWith(), [bed(11.99)]));
    expect(e).toMatchObject({ code: 'invalid_bed', path: '/commands/0' });
    expect(e.message).toContain('width must be at least 12');
  });

  it('reports each problem separately, plus a duplicate id', () => {
    const r = apply(planWith(), [{ type: 'addBed', id: 'bed-1', shape: 'polygon', cx: 0, cy: 0, widthIn: 5, heightIn: 24 }]);
    expect(codes(r).sort()).toEqual(['duplicate_id', 'invalid_bed', 'invalid_bed']); // too narrow; a polygon without corners
  });
});

describe('renaming, moving and rotating a bed', () => {
  const plan = () => planWith([plant('a', { x: 20, y: 20 })], [bed2]);

  it('changes only that bed, and never the plants', () => {
    const r = ok(apply(plan(), [{ type: 'renameBed', id: 'bed-2', name: 'Herbs' }, { type: 'moveBed', id: 'bed-2', dx: 10, dy: -5 }, { type: 'rotateBed', id: 'bed-2', rotationDeg: 370 }]));
    expect(r.plan.beds[1]).toMatchObject({ name: 'Herbs', cx: 210, cy: 19, rotationDeg: 10 });
    expect(r.plan.beds[0]).toEqual(plan().beds[0]);
    expect(r.plan.plants).toEqual(plan().plants);
  });

  it('is an unknown_bed error for a bed that does not exist', () => {
    const r = apply(plan(), [{ type: 'renameBed', id: 'x', name: 'a' }, { type: 'moveBed', id: 'x', dx: 1, dy: 1 }, { type: 'rotateBed', id: 'x', rotationDeg: 1 }, { type: 'removeBed', id: 'x' }]);
    expect(errorsOf(r).map((e) => [e.code, e.path])).toEqual([0, 1, 2, 3].map((i) => ['unknown_bed', `/commands/${i}/id`]));
  });

  it('allows any name, including an empty one', () => {
    expect(ok(apply(plan(), [{ type: 'renameBed', id: 'bed-1', name: '' }])).plan.beds[0].name).toBe('');
  });
});

describe('reshapeBed', () => {
  // bed-1 is 96 wide; the kale at x = 80 sits 16 in from the right edge.
  const plan = () => planWith([plant('left', { x: 20, y: 24 }), plant('right', { x: 80, y: 24 }), plant('other', { bedId: 'bed-2', x: 40, y: 24 })], [bed2]);
  const shrink = (widthIn: number): Command => ({ type: 'reshapeBed', id: 'bed-1', cx: 48 - (96 - widthIn) / 2, cy: 24, widthIn, heightIn: 48 }); // keeps the left edge fixed

  it('keeps plants where they were in the garden when a bed grows or its left edge moves', () => {
    const r = ok(apply(plan(), [{ type: 'reshapeBed', id: 'bed-1', cx: 60, cy: 24, widthIn: 120, heightIn: 48 }])); // left edge now at 0, was 0: grows right by 24
    expect(r.plan.plants.find((p) => p.id === 'left')).toMatchObject({ x: 20 + 0, y: 24 });
    const slid = ok(apply(plan(), [{ type: 'reshapeBed', id: 'bed-1', cx: 58, cy: 24, widthIn: 96, heightIn: 48 }])); // slides the bed 10 in right
    expect(slid.plan.plants.find((p) => p.id === 'left')).toMatchObject({ x: 10, y: 24 }); // same spot in the garden
    expect(slid.results[0].removed).toEqual([]);
  });

  it('removes plants the new shape no longer contains and reports them, but not one exactly on the edge', () => {
    const exact = ok(apply(plan(), [shrink(80)])); // the kale at x = 80 is exactly on the new right edge
    expect(exact.plan.plants.map((p) => p.id)).toEqual(['left', 'right', 'other']);
    expect(exact.results[0].removed).toEqual([]);
    const past = ok(apply(plan(), [shrink(79.99)]));
    expect(past.results[0]).toMatchObject({ type: 'reshapeBed', bedId: 'bed-1', removed: ['right'] });
    expect(past.plan.plants.map((p) => p.id)).toEqual(['left', 'other']);
  });

  it('a dry run reports what would be removed and says not to commit', () => {
    const dry = ok(apply(plan(), [shrink(60)], { dryRun: true }));
    expect(dry.committed).toBe(false);
    expect(dry.results[0].removed).toEqual(['right']);
  });

  it('reports the spacing warnings that removing plants resolves', () => {
    const crowded = planWith([plant('a', { cropId: 'tomato', x: 20, y: 24 }), plant('b', { cropId: 'tomato', x: 28, y: 24 })]); // 8 in apart
    expect(ok(apply(crowded, [shrink(30)])).warnings.resolved).toHaveLength(0); // both still fit
    expect(ok(apply(crowded, [shrink(25)])).warnings.resolved).toHaveLength(1); // the one at 28 goes
  });

  it('refuses a polygon reshaped without its corners, and corners on a non-polygon', () => {
    const tri: Bed = { id: 'tri', name: 'Tri', shape: 'polygon', cx: 300, cy: 40, widthIn: 48, heightIn: 48, rotationDeg: 0, points: [{ x: 0, y: 0 }, { x: 48, y: 0 }, { x: 24, y: 48 }] };
    const withTri = planWith([], [tri]);
    expect(codes(apply(withTri, [{ type: 'reshapeBed', id: 'tri', cx: 300, cy: 40, widthIn: 60, heightIn: 48 }]))).toEqual(['invalid_bed']);
    expect(codes(apply(planWith(), [{ type: 'reshapeBed', id: 'bed-1', cx: 48, cy: 24, widthIn: 96, heightIn: 48, points: tri.points }]))).toEqual(['invalid_bed']);
  });

  it('refuses a size under the minimum', () => {
    expect(codes(apply(plan(), [shrink(11)]))).toEqual(['invalid_bed']);
  });
});

describe('removeBed', () => {
  it('removes the bed and its plants, reports them, and leaves the other bed alone', () => {
    const plan = planWith([plant('a'), plant('b'), plant('c', { bedId: 'bed-2' })], [bed2]);
    const r = ok(apply(plan, [{ type: 'removeBed', id: 'bed-1' }]));
    expect(r.plan.beds.map((b) => b.id)).toEqual(['bed-2']);
    expect(r.plan.plants.map((p) => p.id)).toEqual(['c']);
    expect(r.results[0]).toEqual({ type: 'removeBed', bedId: 'bed-1', removed: ['a', 'b'] });
  });
});

describe('pasteBed', () => {
  const pasted: Bed = { ...bed2, id: 'copy' };
  const inCopy = (id: string, x = 10, y = 10): PlantInstance => plant(id, { bedId: 'copy', x, y });

  it('adds the bed and its plants together', () => {
    const r = ok(apply(planWith(), [{ type: 'pasteBed', bed: pasted, plants: [inCopy('c1'), inCopy('c2', 20, 20)] }]));
    expect(r.plan.beds.map((b) => b.id)).toEqual(['bed-1', 'copy']);
    expect(r.plan.plants.map((p) => p.id)).toEqual(['c1', 'c2']);
    expect(r.results[0]).toMatchObject({ bedId: 'copy', plantIds: ['c1', 'c2'] });
  });

  it('rejects a taken bed id, plants in another bed, unknown crops, taken or repeated plant ids, and plants outside the bed', () => {
    const plan = planWith([plant('taken')]);
    const r = apply(plan, [{ type: 'pasteBed', bed: { ...pasted, id: 'bed-1' }, plants: [] }]);
    expect(codes(r)).toEqual(['duplicate_id']);
    const bad = apply(plan, [{ type: 'pasteBed', bed: pasted, plants: [plant('x', { bedId: 'bed-1' }), inCopy('y', 10, 10), { ...inCopy('z'), cropId: 'nope' }, inCopy('taken'), inCopy('y'), inCopy('far', 49, 10)] }]);
    expect(errorsOf(bad).map((e) => [e.code, e.path])).toEqual([
      ['unknown_bed', '/commands/0/plants/0/bedId'],
      ['unknown_crop', '/commands/0/plants/2/cropId'],
      ['duplicate_id', '/commands/0/plants/3/id'],
      ['duplicate_id', '/commands/0/plants/4/id'],
      ['outside_bed', '/commands/0/plants/5'],
    ]);
  });

  it('accepts a plant exactly on the pasted bed\'s edge', () => {
    expect(apply(planWith(), [{ type: 'pasteBed', bed: pasted, plants: [inCopy('edge', 48, 48)] }]).ok).toBe(true);
  });
});

describe('restoreLayout', () => {
  it('undoes a bed removal exactly: the same beds and plants come back', () => {
    const before = planWith([plant('a'), plant('b', { bedId: 'bed-2' })], [bed2]);
    const removed = ok(apply(before, [{ type: 'removeBed', id: 'bed-2' }])).plan;
    const restored = ok(apply(removed, [{ type: 'restoreLayout', beds: before.beds, plants: before.plants }])).plan;
    expect(restored).toEqual(before);
  });

  it('leaves the garden name, profile and dismissals alone', () => {
    const plan = { ...planWith([plant('a')]), name: 'Mine', dismissedConflictKeys: ['x::y'] };
    const r = ok(apply(plan, [{ type: 'restoreLayout', beds: plan.beds, plants: [] }])).plan;
    expect(r).toMatchObject({ name: 'Mine', dismissedConflictKeys: ['x::y'], profile: plan.profile, plants: [] });
  });

  it('does not insist plants sit inside their beds, since a snapshot may predate that rule', () => {
    expect(apply(planWith(), [{ type: 'restoreLayout', beds: createPlan('g').beds, plants: [plant('legacy', { x: 500, y: 500 })] }]).ok).toBe(true);
  });

  it('rejects a layout with a plant in a missing bed or of an unknown crop, with paths into the request', () => {
    const r = apply(planWith(), [{ type: 'restoreLayout', beds: createPlan('g').beds, plants: [plant('a', { bedId: 'ghost' }), plant('b', { cropId: 'nope' })] }]);
    expect(errorsOf(r).map((e) => [e.code, e.path])).toEqual([
      ['unknown_bed', '/commands/0/plants/0/bedId'],
      ['unknown_crop', '/commands/0/plants/1/cropId'],
    ]);
  });
});

describe('setNorth', () => {
  it('turns north, normalizing the angle, and changes nothing else', () => {
    const r = ok(apply(planWith(), [{ type: 'setNorth', northDeg: -90 }]));
    expect(r.plan.northDeg).toBe(270);
    expect(r.plan.beds).toEqual(planWith().beds);
    expect(r.plan.plants).toEqual(planWith().plants);
  });

  it('is accepted as a no-op when north is already there, and changes the revision only when it moves', () => {
    const base = ok(apply(planWith(), [{ type: 'setNorth', northDeg: 0 }]));
    expect(base.plan.northDeg).toBeUndefined();
    expect(ok(apply(planWith(), [{ type: 'setNorth', northDeg: 45 }])).rev).not.toBe(base.rev);
  });

  it('can change which plants shade which, reported as warnings resolved', () => {
    // A tomato with a basil 10 in north of it shades it; turning the garden so north points down removes that.
    const plan = planWith([plant('t', { cropId: 'tomato', x: 40, y: 40 }), plant('b', { cropId: 'basil', x: 40, y: 30 })]);
    const turned = ok(apply(plan, [{ type: 'setNorth', northDeg: 180 }]));
    expect(turned.warnings.resolved.map((w) => w.id)).toEqual(['shade:t>b']);
  });

  it('is refused for a planting-only scope', () => {
    expect(codes(apply(planWith(), [{ type: 'setNorth', northDeg: 10 }], { scope: 'planting' }))).toEqual(['forbidden']);
  });
});

describe('setGardenName and setProfile', () => {
  it('sets the name to any string', () => {
    expect(ok(apply(planWith(), [{ type: 'setGardenName', name: '' }])).plan.name).toBe('');
    expect(ok(apply(planWith(), [{ type: 'setGardenName', name: 'Back yard' }])).plan.name).toBe('Back yard');
  });

  it('sets the profile, normalizing the location', () => {
    const r = ok(apply(planWith(), [{ type: 'setProfile', profile: { zoneId: '8', sunExposure: 'part-shade', onboarded: true, location: { lat: 45, lng: 190, label: '  Portland ' } } }]));
    expect(r.plan.profile).toEqual({ zoneId: '8', sunExposure: 'part-shade', onboarded: true, location: { lat: 45, lng: -170, label: 'Portland' } });
  });

  it('rejects an unknown zone and an unusable location, each with its path', () => {
    const r = apply(planWith(), [{ type: 'setProfile', profile: { zoneId: '99', sunExposure: 'shade', onboarded: false, location: { lat: 91, lng: 0 } } }]);
    expect(errorsOf(r).map((e) => [e.code, e.path])).toEqual([
      ['invalid_profile', '/commands/0/profile/zoneId'],
      ['invalid_profile', '/commands/0/profile/location'],
    ]);
  });

  it('accepts latitude exactly ±90 and rejects just past it', () => {
    const at = (lat: number): Command => ({ type: 'setProfile', profile: { zoneId: '6', sunExposure: 'shade', onboarded: true, location: { lat, lng: 0 } } });
    expect(apply(planWith(), [at(90)]).ok).toBe(true);
    expect(apply(planWith(), [at(-90)]).ok).toBe(true);
    expect(apply(planWith(), [at(90.01)]).ok).toBe(false);
  });
});
