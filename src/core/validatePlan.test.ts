import { describe, expect, it } from 'vitest';
import type { PlantInstance } from '../types';
import { createPlan } from './reducer';
import { validatePlan } from './validatePlan';

const plant = (over: Partial<PlantInstance> = {}): PlantInstance => ({
  id: 'p1',
  bedId: 'bed-1',
  cropId: 'tomato',
  x: 10,
  y: 10,
  groupId: 'p1',
  ...over,
});

const planWith = (plants: unknown[]) => ({ ...createPlan('g'), plants });

describe('validatePlan', () => {
  it('accepts an empty garden and a garden with a plant exactly on the bed edge', () => {
    expect(validatePlan(createPlan('g'))).toEqual([]);
    expect(validatePlan(planWith([plant({ x: 0, y: 0 }), plant({ id: 'p2', groupId: 'p2', x: 96, y: 48 })]))).toEqual([]);
  });

  it('accepts a legacy v2 plan (plants have no bedId)', () => {
    const v2 = {
      version: 2,
      profile: { zoneId: '6', sunExposure: 'full-sun', onboarded: true },
      bed: { id: 'bed-1', name: 'Bed', widthIn: 96, heightIn: 48 },
      plants: [{ id: 'p1', cropId: 'tomato', x: 1, y: 1, groupId: 'p1' }],
      dismissedConflictKeys: [],
    };
    expect(validatePlan(v2)).toEqual([]);
  });

  it('rejects anything that is not a plan object', () => {
    for (const bad of [null, undefined, 'x', 3, []]) {
      expect(validatePlan(bad)).toEqual([expect.objectContaining({ code: 'invalid_garden_file', path: '' })]);
    }
  });

  it('stops at a document-level problem instead of also judging plants', () => {
    const plan = { ...planWith([plant({ cropId: 'nope' })]), profile: null };
    expect(validatePlan(plan)).toEqual([expect.objectContaining({ path: '/profile' })]);
  });

  it('reports a dangling crop with its code and path', () => {
    expect(validatePlan(planWith([plant({ cropId: 'kale2' })]))).toEqual([
      { code: 'unknown_crop', path: '/plants/0/cropId', message: 'plant 1 has an unknown crop (kale2)' },
    ]);
  });

  it('reports a dangling bed with its code and path', () => {
    expect(validatePlan(planWith([plant({ bedId: 'ghost' })]))).toEqual([
      { code: 'unknown_bed', path: '/plants/0/bedId', message: "plant 1 is in a bed that doesn't exist" },
    ]);
  });

  it('reports every bad plant, one problem each, in plant order', () => {
    const problems = validatePlan(
      planWith([plant(), plant({ id: 'b', groupId: 'b', cropId: 'nope' }), null, plant({ id: 'd', groupId: 'd', x: Infinity })]),
    );
    expect(problems.map((p) => [p.code, p.path])).toEqual([
      ['unknown_crop', '/plants/1/cropId'],
      ['invalid_garden_file', '/plants/2'],
      ['invalid_garden_file', '/plants/3'],
    ]);
  });

  it('reports a plant with both a bad bed and a bad crop only once, bed first', () => {
    expect(validatePlan(planWith([plant({ bedId: 'ghost', cropId: 'nope' })])).map((p) => p.code)).toEqual(['unknown_bed']);
  });

  it('reports a bad dismissed list after the plant problems', () => {
    const plan = { ...planWith([plant({ cropId: 'nope' })]), dismissedConflictKeys: [1] };
    expect(validatePlan(plan).map((p) => p.path)).toEqual(['/plants/0/cropId', '/dismissedConflictKeys']);
  });

  it('rejects duplicate bed ids and invalid beds', () => {
    const bed = createPlan('g').beds[0];
    expect(validatePlan({ ...createPlan('g'), beds: [bed, bed] })).toEqual([
      expect.objectContaining({ path: '/beds', message: 'two beds share the same id' }),
    ]);
    expect(validatePlan({ ...createPlan('g'), beds: [{ ...bed, widthIn: 0 }] })).toEqual([
      expect.objectContaining({ path: '/beds/0', message: 'bed 1 is invalid' }),
    ]);
  });
});
