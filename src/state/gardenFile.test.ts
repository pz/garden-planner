import { describe, expect, it } from 'vitest';
import { CROPS } from '../data/crops';
import { createPlan } from './reducer';
import { gardenFileName, parseGardenFile, serializeGardenFile } from './gardenFile';
import type { GardenPlan } from '../types';

const meta = { commit: 'abc1234', exportedAt: '2026-10-06T12:00:00.000Z' };

function samplePlan(): GardenPlan {
  return {
    ...createPlan('g1'),
    plants: [{ id: 'p1', cropId: CROPS[0].id, x: 10, y: 20, groupId: 'grp1', variety: 'Cherry' }],
    dismissedConflictKeys: ['a::b'],
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
    expect(result).toEqual({ ok: true, plan, meta });
  });

  it('accepts a bare plan with no wrapper', () => {
    const plan = samplePlan();
    expect(parseGardenFile(JSON.stringify(plan))).toEqual({ ok: true, plan, meta: null });
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
  it('rejects the wrong plan version', () => expect(errorOf(fileOf({ ...samplePlan(), version: 1 }))).toMatch(/version/));
  it('rejects a missing profile', () => expect(errorOf(fileOf({ ...samplePlan(), profile: null }))).toMatch(/profile/));
  it('rejects a zero-size bed', () => {
    const plan = samplePlan();
    expect(errorOf(fileOf({ ...plan, bed: { ...plan.bed, widthIn: 0 } }))).toMatch(/bed/);
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
    const plan = { ...samplePlan(), bed: { ...samplePlan().bed, name: "Mom's Garden #2!" } };
    expect(gardenFileName(plan, meta.exportedAt)).toBe('mom-s-garden-2-2026-10-06.json');
  });
  it('falls back to "garden" for a name with no usable characters', () => {
    const plan = { ...samplePlan(), bed: { ...samplePlan().bed, name: '🌱' } };
    expect(gardenFileName(plan, meta.exportedAt)).toBe('garden-2026-10-06.json');
  });
});
