import { afterEach, describe, expect, it } from 'vitest';
import { CROPS, makeCustomCrop, setCustomCrops } from '../data/crops';
import { createPlan } from './reducer';
import { gardenFileName, parseGardenFile, serializeGardenFile } from './gardenFile';
import type { Bed, GardenPlan } from '../types';

const meta = { commit: 'abc1234', exportedAt: '2026-10-06T12:00:00.000Z' };

const ellipse: Bed = { id: 'bed-2', name: 'Round', shape: 'ellipse', cx: 200, cy: 60, widthIn: 60, heightIn: 40, rotationDeg: 30 };
const polygon: Bed = {
  id: 'bed-3',
  name: 'Wedge',
  shape: 'polygon',
  cx: 300,
  cy: 100,
  widthIn: 50,
  heightIn: 50,
  rotationDeg: 0,
  points: [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 0, y: 50 },
  ],
};

/** A multi-bed garden: the default rectangle, an ellipse, and a polygon, with a plant in two of them. */
function samplePlan(): GardenPlan {
  const base = createPlan('g1');
  return {
    ...base,
    name: 'Back yard',
    beds: [...base.beds, ellipse, polygon],
    plants: [
      { id: 'p1', bedId: base.beds[0].id, cropId: CROPS[0].id, x: 10, y: 20, groupId: 'grp1', variety: 'Cherry' },
      { id: 'p2', bedId: 'bed-2', cropId: CROPS[0].id, x: 5, y: 5, groupId: 'grp2' },
    ],
    dismissedConflictKeys: ['a::b'],
  };
}

/** The pre-multi-bed (v2) shape: one fixed bed, plants with no bedId. */
function legacyV2() {
  return {
    version: 2,
    id: 'old',
    profile: { zoneId: '6', sunExposure: 'full-sun', onboarded: true },
    bed: { id: 'bed-1', name: 'Old bed', widthIn: 96, heightIn: 48 },
    plants: [{ id: 'p1', cropId: CROPS[0].id, x: 10, y: 20, groupId: 'grp1' }],
    dismissedConflictKeys: [],
  };
}

const fileOf = (plan: unknown) => JSON.stringify({ format: 'garden-planner-export', formatVersion: 1, meta, plan });
const errorOf = (text: string) => {
  const r = parseGardenFile(text);
  if (r.ok) throw new Error('expected failure');
  return r.error;
};

describe('serializeGardenFile / parseGardenFile', () => {
  it('round-trips a plan and its metadata', () => {
    const plan = samplePlan();
    const result = parseGardenFile(serializeGardenFile(plan, meta));
    expect(result).toEqual({ ok: true, plan, meta, customCrops: [] });
  });

  it('preserves every bed with its shape, rotation and polygon corners', () => {
    const r = parseGardenFile(serializeGardenFile(samplePlan(), meta));
    expect(r.ok && r.plan.beds).toEqual(samplePlan().beds);
  });

  it('migrates a legacy single-bed (v2) file to the multi-bed layout', () => {
    const r = parseGardenFile(fileOf(legacyV2()));
    if (!r.ok) throw new Error(r.error);
    expect(r.plan.version).toBe(3);
    expect(r.plan.name).toBe('Old bed');
    expect(r.plan.beds).toHaveLength(1);
    expect(r.plan.plants).toEqual([{ ...legacyV2().plants[0], bedId: 'bed-1' }]);
  });

  it('accepts a bare plan with no wrapper', () => {
    const plan = samplePlan();
    expect(parseGardenFile(JSON.stringify(plan))).toEqual({ ok: true, plan, meta: null, customCrops: [] });
  });

  it('drops unreadable meta instead of failing', () => {
    const r = parseGardenFile(JSON.stringify({ format: 'garden-planner-export', meta: 5, plan: samplePlan() }));
    expect(r).toMatchObject({ ok: true, meta: null });
  });

  it('drops an invalid location pin but keeps the garden', () => {
    const plan = samplePlan();
    const bad = { ...plan, profile: { ...plan.profile, location: { lat: 999, lng: 0 } } };
    const r = parseGardenFile(fileOf(bad));
    expect(r.ok && r.plan.profile.location).toBeUndefined();
  });
});

describe('parseGardenFile rejection', () => {
  it('rejects non-JSON', () => expect(errorOf('not json')).toMatch(/valid JSON/));
  it('rejects non-object content', () => expect(errorOf('[]')).toMatch(/no garden/));
  it('rejects an unknown plan version', () => expect(errorOf(fileOf({ ...samplePlan(), version: 4 }))).toMatch(/version/));
  it('rejects a missing profile', () => expect(errorOf(fileOf({ ...samplePlan(), profile: null }))).toMatch(/profile/));
  it('rejects a zero-size bed', () => {
    const plan = samplePlan();
    expect(errorOf(fileOf({ ...plan, beds: [{ ...plan.beds[0], widthIn: 0 }] }))).toMatch(/bed 1 is invalid/);
  });
  it('rejects a polygon bed with fewer than three corners', () => {
    const plan = samplePlan();
    const bad = { ...polygon, points: polygon.points!.slice(0, 2) };
    expect(errorOf(fileOf({ ...plan, beds: [bad] }))).toMatch(/bed 1 is invalid/);
  });
  it('rejects a bed with an unknown shape', () => {
    expect(errorOf(fileOf({ ...samplePlan(), beds: [{ ...ellipse, shape: 'star' }] }))).toMatch(/bed 1 is invalid/);
  });
  it('rejects two beds sharing an id', () => {
    const plan = samplePlan();
    expect(errorOf(fileOf({ ...plan, beds: [plan.beds[0], { ...ellipse, id: plan.beds[0].id }] }))).toMatch(/share the same id/);
  });
  it('rejects a v3 garden with no beds list', () => {
    expect(errorOf(fileOf({ ...samplePlan(), beds: undefined }))).toMatch(/no beds/);
  });
  it('rejects a plant whose bed does not exist', () => {
    const plan = samplePlan();
    expect(errorOf(fileOf({ ...plan, plants: [{ ...plan.plants[0], bedId: 'ghost' }] }))).toMatch(/bed that doesn't exist/);
  });
  it('rejects a legacy v2 file with a zero-size bed', () => {
    const v2 = legacyV2();
    expect(errorOf(fileOf({ ...v2, bed: { ...v2.bed, heightIn: 0 } }))).toMatch(/invalid size/);
  });
  it('rejects an unknown crop id', () => {
    const plan = samplePlan();
    expect(errorOf(fileOf({ ...plan, plants: [{ ...plan.plants[0], cropId: 'nope' }] }))).toMatch(/unknown crop \(nope\)/);
  });
  it('rejects a non-finite plant position', () => {
    const plan = samplePlan();
    // JSON.stringify turns NaN into null, which is still not a number.
    expect(errorOf(fileOf({ ...plan, plants: [{ ...plan.plants[0], x: NaN }] }))).toMatch(/plant 1 has an invalid position/);
  });
  it('rejects a plant missing its groupId', () => {
    const plan = samplePlan();
    expect(errorOf(fileOf({ ...plan, plants: [{ ...plan.plants[0], groupId: undefined }] }))).toMatch(/malformed/);
  });
  it('rejects non-string dismissed keys', () => {
    expect(errorOf(fileOf({ ...samplePlan(), dismissedConflictKeys: [1] }))).toMatch(/dismissed/);
  });
  it('accepts an empty garden', () => expect(parseGardenFile(fileOf(createPlan('x'))).ok).toBe(true));
});

describe('gardenFileName', () => {
  it('slugifies the bed name and appends the export date', () => {
    const plan = { ...samplePlan(), name: "Mom's Garden #2!" };
    expect(gardenFileName(plan, meta.exportedAt)).toBe('mom-s-garden-2-2026-10-06.json');
  });
  it('falls back to "garden" for a name with no usable characters', () => {
    const plan = { ...samplePlan(), name: '🌱' };
    expect(gardenFileName(plan, meta.exportedAt)).toBe('garden-2026-10-06.json');
  });
});

describe('user-made plants in a garden file', () => {
  const mine = makeCustomCrop({ id: 'custom-mine', name: 'Mine', spacingIn: 9, heightIn: 20, look: { shape: 'bushy', leaf: 'dark', accent: 'red' } });
  const other = makeCustomCrop({ id: 'custom-other', name: 'Other', spacingIn: 5, look: { shape: 'rosette' } });
  const planWithMine = (): GardenPlan => {
    const p = samplePlan();
    return { ...p, plants: [...p.plants, { id: 'm1', bedId: 'bed-1', cropId: 'custom-mine', x: 30, y: 30, groupId: 'gm' }] };
  };
  afterEach(() => setCustomCrops([]));

  it('are bundled into the export, only those the garden uses', () => {
    setCustomCrops([mine, other]);
    const file = JSON.parse(serializeGardenFile(planWithMine(), meta));
    expect(file.customCrops).toEqual([mine]);
  });

  it('leave no customCrops field when the garden uses none', () => {
    setCustomCrops([mine]);
    expect(JSON.parse(serializeGardenFile(samplePlan(), meta))).not.toHaveProperty('customCrops');
  });

  it('load on a device that does not have them: the plants stay, and the definitions come back for the caller to keep', () => {
    setCustomCrops([mine]);
    const text = serializeGardenFile(planWithMine(), meta);
    setCustomCrops([]); // the other device
    const r = parseGardenFile(text);
    if (!r.ok) throw new Error(r.error);
    expect(r.customCrops).toEqual([mine]);
    expect(r.plan.plants.map((p) => p.id)).toEqual(['p1', 'p2', 'm1']);
  });

  it('are refused when a plant uses one the file does not define', () => {
    const text = fileOf(planWithMine());
    expect(errorOf(text)).toMatch(/unknown crop \(custom-mine\)/);
  });

  it('are refused, rather than trusted, when their definition is malformed', () => {
    const file = JSON.parse(fileOf(planWithMine()));
    file.customCrops = [{ ...mine, spacingIn: -3 }];
    expect(errorOf(JSON.stringify(file))).toMatch(/unknown crop/);
  });
});
