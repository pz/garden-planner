import { describe, expect, it } from 'vitest';
import type { GardenPlan, PlantInstance } from '../types';
import { DEFAULT_PLAN, parsePlan, reducer } from './reducer';

function basePlan(plants: PlantInstance[] = []): GardenPlan {
  return { ...DEFAULT_PLAN, plants };
}

describe('parsePlan', () => {
  it('returns the default plan when there is nothing stored', () => {
    expect(parsePlan(null)).toEqual(DEFAULT_PLAN);
  });

  it('returns the default plan for malformed JSON instead of throwing', () => {
    expect(parsePlan('{not valid json')).toEqual(DEFAULT_PLAN);
  });

  it('returns the default plan when the stored version does not match', () => {
    const stored = JSON.stringify({ ...DEFAULT_PLAN, version: 1 });
    expect(parsePlan(stored)).toEqual(DEFAULT_PLAN);
  });

  it('returns the parsed plan when it is well-formed and versioned correctly', () => {
    const plan = basePlan([{ id: 'p1', cropId: 'tomato', x: 1, y: 2, groupId: 'g1' }]);
    expect(parsePlan(JSON.stringify(plan))).toEqual(plan);
  });
});

describe('reducer', () => {
  it('setProfile replaces the whole profile', () => {
    const state = basePlan();
    const next = reducer(state, { type: 'setProfile', profile: { zoneId: '9', sunExposure: 'shade', onboarded: true } });
    expect(next.profile).toEqual({ zoneId: '9', sunExposure: 'shade', onboarded: true });
    expect(next).not.toBe(state); // immutability: new object identity
  });

  it('addPlants appends without mutating the previous plants array', () => {
    const original: PlantInstance[] = [{ id: 'a', cropId: 'tomato', x: 0, y: 0, groupId: 'g1' }];
    const state = basePlan(original);
    const added: PlantInstance = { id: 'b', cropId: 'basil', x: 5, y: 5, groupId: 'g2' };
    const next = reducer(state, { type: 'addPlants', plants: [added] });

    expect(next.plants).toEqual([...original, added]);
    expect(state.plants).toEqual(original); // original untouched
    expect(state.plants).toHaveLength(1);
  });

  it('moveGroup translates every member of the group by the same delta', () => {
    const state = basePlan([
      { id: 'a', cropId: 'carrot', x: 0, y: 0, groupId: 'patch' },
      { id: 'b', cropId: 'carrot', x: 3, y: 0, groupId: 'patch' },
      { id: 'c', cropId: 'basil', x: 5, y: 5, groupId: 'solo' },
    ]);
    const next = reducer(state, { type: 'moveGroup', groupId: 'patch', dx: 10, dy: -2 });
    expect(next.plants.find((p) => p.id === 'a')).toEqual({ id: 'a', cropId: 'carrot', x: 10, y: -2, groupId: 'patch' });
    expect(next.plants.find((p) => p.id === 'b')).toEqual({ id: 'b', cropId: 'carrot', x: 13, y: -2, groupId: 'patch' });
    // other groups are untouched
    expect(next.plants.find((p) => p.id === 'c')).toEqual(state.plants[2]);
  });

  it('moveGroup is a no-op when the groupId is not found', () => {
    const state = basePlan([{ id: 'a', cropId: 'tomato', x: 0, y: 0, groupId: 'g1' }]);
    const next = reducer(state, { type: 'moveGroup', groupId: 'missing', dx: 10, dy: 20 });
    expect(next.plants).toEqual(state.plants);
  });

  it('removePlant removes only the targeted plant', () => {
    const state = basePlan([
      { id: 'a', cropId: 'tomato', x: 0, y: 0, groupId: 'g1' },
      { id: 'b', cropId: 'basil', x: 5, y: 5, groupId: 'g2' },
    ]);
    const next = reducer(state, { type: 'removePlant', id: 'a' });
    expect(next.plants.map((p) => p.id)).toEqual(['b']);
  });

  it('removeGroup removes every plant sharing the groupId, even solo survivors from other groups', () => {
    const state = basePlan([
      { id: 'a', cropId: 'carrot', x: 0, y: 0, groupId: 'patch' },
      { id: 'b', cropId: 'carrot', x: 3, y: 0, groupId: 'patch' },
      { id: 'c', cropId: 'tomato', x: 40, y: 0, groupId: 'solo' },
    ]);
    const next = reducer(state, { type: 'removeGroup', groupId: 'patch' });
    expect(next.plants.map((p) => p.id)).toEqual(['c']);
  });

  it('setVariety sets or clears the variety on the targeted plant only', () => {
    const state = basePlan([{ id: 'a', cropId: 'tomato', x: 0, y: 0, groupId: 'g1' }]);
    const withVariety = reducer(state, { type: 'setVariety', id: 'a', variety: 'Cherokee Purple' });
    expect(withVariety.plants[0].variety).toBe('Cherokee Purple');

    const cleared = reducer(withVariety, { type: 'setVariety', id: 'a', variety: undefined });
    expect(cleared.plants[0].variety).toBeUndefined();
  });

  describe('dismissConflictsForGroup', () => {
    it('records the conflict key for every pair touching the dismissed group', () => {
      // tomato spacing 24in, basil spacing 12in -> required gap = 18in; these are 10in apart.
      const state = basePlan([
        { id: 'a', cropId: 'tomato', x: 0, y: 0, groupId: 'g1' },
        { id: 'b', cropId: 'basil', x: 10, y: 0, groupId: 'g2' },
      ]);
      const next = reducer(state, { type: 'dismissConflictsForGroup', groupId: 'g1' });
      expect(next.dismissedConflictKeys).toEqual(['g1::g2']);
    });

    it('is a no-op when the group has no active conflict', () => {
      const state = basePlan([{ id: 'a', cropId: 'tomato', x: 0, y: 0, groupId: 'g1' }]);
      const next = reducer(state, { type: 'dismissConflictsForGroup', groupId: 'g1' });
      expect(next).toBe(state);
    });

    it('does not duplicate a key already dismissed', () => {
      const state: GardenPlan = {
        ...basePlan([
          { id: 'a', cropId: 'tomato', x: 0, y: 0, groupId: 'g1' },
          { id: 'b', cropId: 'basil', x: 10, y: 0, groupId: 'g2' },
        ]),
        dismissedConflictKeys: ['g1::g2'],
      };
      const next = reducer(state, { type: 'dismissConflictsForGroup', groupId: 'g2' });
      expect(next.dismissedConflictKeys).toEqual(['g1::g2']);
    });
  });

  it('reset returns exactly the default plan, discarding all prior state', () => {
    const state = basePlan([{ id: 'a', cropId: 'tomato', x: 0, y: 0, groupId: 'g1' }]);
    expect(reducer(state, { type: 'reset' })).toEqual(DEFAULT_PLAN);
  });
});
