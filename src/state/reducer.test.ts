import { describe, expect, it } from 'vitest';
import type { Bed, GardenPlan, PlantInstance } from '../types';
import { DEFAULT_PLAN, createPlan, parsePlan, reducer } from './reducer';

const TEST_ID = 'test-garden';

function basePlan(plants: PlantInstance[] = []): GardenPlan {
  return { ...DEFAULT_PLAN, id: TEST_ID, plants };
}

describe('createPlan', () => {
  it('produces a fresh, empty garden stamped with the given id', () => {
    expect(createPlan('g1')).toEqual({ ...DEFAULT_PLAN, id: 'g1' });
  });

  it('gives two different ids two independent plans', () => {
    expect(createPlan('a').id).toBe('a');
    expect(createPlan('b').id).toBe('b');
  });
});

describe('parsePlan', () => {
  it('returns a fresh plan stamped with the given id when there is nothing stored', () => {
    expect(parsePlan(null, TEST_ID)).toEqual(createPlan(TEST_ID));
  });

  it('returns a fresh plan for malformed JSON instead of throwing', () => {
    expect(parsePlan('{not valid json', TEST_ID)).toEqual(createPlan(TEST_ID));
  });

  it('returns a fresh plan when the stored version does not match', () => {
    const stored = JSON.stringify({ ...basePlan(), version: 1 });
    expect(parsePlan(stored, TEST_ID)).toEqual(createPlan(TEST_ID));
  });

  it('returns a fresh plan for a version from the future', () => {
    const stored = JSON.stringify({ ...basePlan(), version: 4 });
    expect(parsePlan(stored, TEST_ID)).toEqual(createPlan(TEST_ID));
  });

  it('returns the parsed plan when it is well-formed and versioned correctly', () => {
    const plan = basePlan([{ id: 'p1', bedId: 'bed-1', cropId: 'tomato', x: 1, y: 2, groupId: 'g1' }]);
    expect(parsePlan(JSON.stringify(plan), TEST_ID)).toEqual(plan);
  });

  it('forces the id from the storage key, ignoring whatever id the stored JSON carries', () => {
    const stored = JSON.stringify(basePlan()); // stored under TEST_ID
    // simulate reading it back under a different key, e.g. after a copy/rename bug
    expect(parsePlan(stored, 'a-different-id').id).toBe('a-different-id');
  });

  it('keeps a valid stored garden location', () => {
    const plan = basePlan();
    plan.profile = { ...plan.profile, location: { lat: 45.52, lng: -122.68, label: 'Portland, Oregon' } };
    expect(parsePlan(JSON.stringify(plan), TEST_ID).profile.location).toEqual({
      lat: 45.52,
      lng: -122.68,
      label: 'Portland, Oregon',
    });
  });

  it('drops a malformed stored location but keeps the rest of the profile', () => {
    const plan = basePlan();
    const stored = JSON.stringify({ ...plan, profile: { ...plan.profile, zoneId: '8', location: { lat: 'x', lng: 5 } } });
    const parsed = parsePlan(stored, TEST_ID);
    expect(parsed.profile).toEqual({ ...plan.profile, zoneId: '8' });
    expect('location' in parsed.profile).toBe(false);
  });

  it('reads a pre-map plan (no location at all) unchanged', () => {
    const plan = basePlan();
    expect(parsePlan(JSON.stringify(plan), TEST_ID)).toEqual(plan);
    expect('location' in parsePlan(JSON.stringify(plan), TEST_ID).profile).toBe(false);
  });
});

describe('reducer', () => {
  it('setProfile replaces the whole profile', () => {
    const state = basePlan();
    const next = reducer(state, { type: 'setProfile', profile: { zoneId: '9', sunExposure: 'shade', onboarded: true } });
    expect(next.profile).toEqual({ zoneId: '9', sunExposure: 'shade', onboarded: true });
    expect(next).not.toBe(state); // immutability: new object identity
  });

  it('setProfile stores the garden location and leaves bed and plants untouched', () => {
    const state = basePlan([{ id: 'p1', bedId: 'bed-1', cropId: 'tomato', x: 1, y: 2, groupId: 'g1' }]);
    const profile = { zoneId: '8', sunExposure: 'full-sun' as const, onboarded: true, location: { lat: 45.5, lng: -122.7 } };
    const next = reducer(state, { type: 'setProfile', profile });
    expect(next.profile.location).toEqual({ lat: 45.5, lng: -122.7 });
    expect(next.beds).toBe(state.beds);
    expect(next.plants).toBe(state.plants);
  });

  it('setGardenName replaces only the garden name, leaving its beds untouched', () => {
    const state = basePlan();
    const next = reducer(state, { type: 'setGardenName', name: 'Back garden' });
    expect(next.name).toBe('Back garden');
    expect(next.beds).toBe(state.beds);
    expect(state.name).toBe(DEFAULT_PLAN.name);
  });

  it('addPlants appends without mutating the previous plants array', () => {
    const original: PlantInstance[] = [{ id: 'a', bedId: 'bed-1', cropId: 'tomato', x: 0, y: 0, groupId: 'g1' }];
    const state = basePlan(original);
    const added: PlantInstance = { id: 'b', bedId: 'bed-1', cropId: 'basil', x: 5, y: 5, groupId: 'g2' };
    const next = reducer(state, { type: 'addPlants', plants: [added] });

    expect(next.plants).toEqual([...original, added]);
    expect(state.plants).toEqual(original); // original untouched
    expect(state.plants).toHaveLength(1);
  });

  it('moveGroup translates every member of the group by the same delta', () => {
    const state = basePlan([
      { id: 'a', bedId: 'bed-1', cropId: 'carrot', x: 0, y: 0, groupId: 'patch' },
      { id: 'b', bedId: 'bed-1', cropId: 'carrot', x: 3, y: 0, groupId: 'patch' },
      { id: 'c', bedId: 'bed-1', cropId: 'basil', x: 5, y: 5, groupId: 'solo' },
    ]);
    const next = reducer(state, { type: 'moveGroup', groupId: 'patch', dx: 10, dy: -2 });
    expect(next.plants.find((p) => p.id === 'a')).toEqual({ id: 'a', bedId: 'bed-1', cropId: 'carrot', x: 10, y: -2, groupId: 'patch' });
    expect(next.plants.find((p) => p.id === 'b')).toEqual({ id: 'b', bedId: 'bed-1', cropId: 'carrot', x: 13, y: -2, groupId: 'patch' });
    // other groups are untouched
    expect(next.plants.find((p) => p.id === 'c')).toEqual(state.plants[2]);
  });

  it('moveGroup is a no-op when the groupId is not found', () => {
    const state = basePlan([{ id: 'a', bedId: 'bed-1', cropId: 'tomato', x: 0, y: 0, groupId: 'g1' }]);
    const next = reducer(state, { type: 'moveGroup', groupId: 'missing', dx: 10, dy: 20 });
    expect(next.plants).toEqual(state.plants);
  });

  it('removePlant removes only the targeted plant', () => {
    const state = basePlan([
      { id: 'a', bedId: 'bed-1', cropId: 'tomato', x: 0, y: 0, groupId: 'g1' },
      { id: 'b', bedId: 'bed-1', cropId: 'basil', x: 5, y: 5, groupId: 'g2' },
    ]);
    const next = reducer(state, { type: 'removePlant', id: 'a' });
    expect(next.plants.map((p) => p.id)).toEqual(['b']);
  });

  it('removeGroup removes every plant sharing the groupId, even solo survivors from other groups', () => {
    const state = basePlan([
      { id: 'a', bedId: 'bed-1', cropId: 'carrot', x: 0, y: 0, groupId: 'patch' },
      { id: 'b', bedId: 'bed-1', cropId: 'carrot', x: 3, y: 0, groupId: 'patch' },
      { id: 'c', bedId: 'bed-1', cropId: 'tomato', x: 40, y: 0, groupId: 'solo' },
    ]);
    const next = reducer(state, { type: 'removeGroup', groupId: 'patch' });
    expect(next.plants.map((p) => p.id)).toEqual(['c']);
  });

  it('setVariety sets or clears the variety on the targeted plant only', () => {
    const state = basePlan([{ id: 'a', bedId: 'bed-1', cropId: 'tomato', x: 0, y: 0, groupId: 'g1' }]);
    const withVariety = reducer(state, { type: 'setVariety', id: 'a', variety: 'Cherokee Purple' });
    expect(withVariety.plants[0].variety).toBe('Cherokee Purple');

    const cleared = reducer(withVariety, { type: 'setVariety', id: 'a', variety: undefined });
    expect(cleared.plants[0].variety).toBeUndefined();
  });

  describe('dismissConflictsForGroup', () => {
    it('records the conflict key for every pair touching the dismissed group', () => {
      // tomato spacing 24in, basil spacing 12in -> required gap = 18in; these are 10in apart.
      const state = basePlan([
        { id: 'a', bedId: 'bed-1', cropId: 'tomato', x: 0, y: 0, groupId: 'g1' },
        { id: 'b', bedId: 'bed-1', cropId: 'basil', x: 10, y: 0, groupId: 'g2' },
      ]);
      const next = reducer(state, { type: 'dismissConflictsForGroup', groupId: 'g1' });
      expect(next.dismissedConflictKeys).toEqual(['g1::g2']);
    });

    it('is a no-op when the group has no active conflict', () => {
      const state = basePlan([{ id: 'a', bedId: 'bed-1', cropId: 'tomato', x: 0, y: 0, groupId: 'g1' }]);
      const next = reducer(state, { type: 'dismissConflictsForGroup', groupId: 'g1' });
      expect(next).toBe(state);
    });

    it('does not duplicate a key already dismissed', () => {
      const state: GardenPlan = {
        ...basePlan([
          { id: 'a', bedId: 'bed-1', cropId: 'tomato', x: 0, y: 0, groupId: 'g1' },
          { id: 'b', bedId: 'bed-1', cropId: 'basil', x: 10, y: 0, groupId: 'g2' },
        ]),
        dismissedConflictKeys: ['g1::g2'],
      };
      const next = reducer(state, { type: 'dismissConflictsForGroup', groupId: 'g2' });
      expect(next.dismissedConflictKeys).toEqual(['g1::g2']);
    });
  });

  it('reset returns a fresh plan for the same garden id, discarding all prior state', () => {
    const state = basePlan([{ id: 'a', bedId: 'bed-1', cropId: 'tomato', x: 0, y: 0, groupId: 'g1' }]);
    expect(reducer(state, { type: 'reset' })).toEqual(createPlan(TEST_ID));
  });
});

describe('parsePlan: migrating single-bed (v2) plans', () => {
  const v2 = {
    version: 2,
    id: TEST_ID,
    profile: { zoneId: '7', sunExposure: 'part-shade', onboarded: true },
    bed: { id: 'bed-1', name: 'The Sunny Corner Bed', widthIn: 96, heightIn: 48 },
    plants: [{ id: 'p1', cropId: 'tomato', x: 10, y: 12, groupId: 'g1', variety: 'Sungold' }],
    dismissedConflictKeys: ['g1::g2'],
  };

  it('turns the one bed into the only bed, top-left at the origin, and names the garden after it', () => {
    const plan = parsePlan(JSON.stringify(v2), TEST_ID);
    expect(plan.version).toBe(3);
    expect(plan.name).toBe('The Sunny Corner Bed');
    expect(plan.beds).toEqual([
      { id: 'bed-1', name: 'The Sunny Corner Bed', shape: 'rect', cx: 48, cy: 24, widthIn: 96, heightIn: 48, rotationDeg: 0 },
    ]);
  });

  it('keeps every plant exactly where it was in the bed, now tagged with that bed', () => {
    const plan = parsePlan(JSON.stringify(v2), TEST_ID);
    expect(plan.plants).toEqual([{ ...v2.plants[0], bedId: 'bed-1' }]);
  });

  it('keeps the profile and dismissed warnings', () => {
    const plan = parsePlan(JSON.stringify(v2), TEST_ID);
    expect(plan.profile).toEqual(v2.profile);
    expect(plan.dismissedConflictKeys).toEqual(['g1::g2']);
  });

  it('forces the storage-key id onto the migrated plan', () => {
    expect(parsePlan(JSON.stringify(v2), 'other-id').id).toBe('other-id');
  });

  it('round-trips: a migrated plan, saved and read back, is unchanged', () => {
    const plan = parsePlan(JSON.stringify(v2), TEST_ID);
    expect(parsePlan(JSON.stringify(plan), TEST_ID)).toEqual(plan);
  });

  it.each([
    ['missing', undefined],
    ['zero-width', { id: 'bed-1', name: 'x', widthIn: 0, heightIn: 48 }],
    ['non-numeric', { id: 'bed-1', name: 'x', widthIn: '96', heightIn: 48 }],
  ])('falls back to a fresh plan when the bed is %s', (_label, bed) => {
    expect(parsePlan(JSON.stringify({ ...v2, bed }), TEST_ID)).toEqual(createPlan(TEST_ID));
  });
});

describe('parsePlan: multi-bed (v3) plans', () => {
  it('returns a fresh plan when beds is not an array', () => {
    expect(parsePlan(JSON.stringify({ ...basePlan(), beds: null }), TEST_ID)).toEqual(createPlan(TEST_ID));
  });

  it('drops plants whose bed no longer exists, keeping the rest', () => {
    const kept: PlantInstance = { id: 'a', bedId: 'bed-1', cropId: 'tomato', x: 1, y: 1, groupId: 'g1' };
    const orphan: PlantInstance = { ...kept, id: 'b', bedId: 'gone', groupId: 'g2' };
    expect(parsePlan(JSON.stringify(basePlan([kept, orphan])), TEST_ID).plants).toEqual([kept]);
  });

  it('treats a missing plants list as empty', () => {
    const { plants: _omit, ...rest } = basePlan();
    expect(parsePlan(JSON.stringify(rest), TEST_ID).plants).toEqual([]);
  });
});

describe('reducer: bed layout', () => {
  const bed2: Bed = { id: 'bed-2', name: 'Herbs', shape: 'rect', cx: 150, cy: 24, widthIn: 24, heightIn: 48, rotationDeg: 0 };

  function twoBeds(plants: PlantInstance[] = []): GardenPlan {
    return { ...basePlan(plants), beds: [...DEFAULT_PLAN.beds, bed2] };
  }

  it('addBed appends a bed without touching the others or the plants', () => {
    const state = basePlan();
    const next = reducer(state, { type: 'addBed', bed: bed2 });
    expect(next.beds).toEqual([...state.beds, bed2]);
    expect(next.beds[0]).toBe(state.beds[0]);
    expect(next.plants).toBe(state.plants);
    expect(state.beds).toHaveLength(1);
  });

  it('renameBed renames only the targeted bed', () => {
    const state = twoBeds();
    const next = reducer(state, { type: 'renameBed', id: 'bed-2', name: 'Kitchen herbs' });
    expect(next.beds[1]).toEqual({ ...bed2, name: 'Kitchen herbs' });
    expect(next.beds[0]).toBe(state.beds[0]);
    expect(next.name).toBe(state.name);
  });

  it('moveBed shifts the bed and leaves its plants’ bed-local positions alone', () => {
    const p: PlantInstance = { id: 'a', bedId: 'bed-1', cropId: 'tomato', x: 10, y: 10, groupId: 'g1' };
    const state = twoBeds([p]);
    const next = reducer(state, { type: 'moveBed', id: 'bed-1', dx: 12, dy: -6 });
    expect(next.beds[0]).toMatchObject({ cx: 60, cy: 18, widthIn: 96, heightIn: 48 });
    expect(next.beds[1]).toBe(state.beds[1]);
    expect(next.plants).toBe(state.plants);
  });

  it('moveBed by zero returns the same state', () => {
    const state = basePlan();
    expect(reducer(state, { type: 'moveBed', id: 'bed-1', dx: 0, dy: 0 })).toBe(state);
  });

  describe('resizeBed', () => {
    const inside: PlantInstance = { id: 'in', bedId: 'bed-1', cropId: 'tomato', x: 30, y: 24, groupId: 'g1' };
    const onEdge: PlantInstance = { id: 'edge', bedId: 'bed-1', cropId: 'basil', x: 60, y: 24, groupId: 'g2' };
    const past: PlantInstance = { id: 'past', bedId: 'bed-1', cropId: 'basil', x: 61, y: 24, groupId: 'g3' };
    const otherBed: PlantInstance = { id: 'other', bedId: 'bed-2', cropId: 'basil', x: 200, y: 200, groupId: 'g4' };
    // Right edge pulled in from 96″ to 60″, left edge fixed at 0.
    const geometry = { cx: 30, cy: 24, widthIn: 60, heightIn: 48 };

    it('applies the new geometry and removes exactly the plants now outside', () => {
      const state = twoBeds([inside, onEdge, past, otherBed]);
      const next = reducer(state, { type: 'resizeBed', id: 'bed-1', geometry });
      expect(next.beds[0]).toEqual({ ...state.beds[0], ...geometry });
      expect(next.plants.map((p) => p.id)).toEqual(['in', 'edge', 'other']);
      expect(next.beds[1]).toBe(state.beds[1]);
    });

    it('keeps surviving plants at the same garden position when the left edge moves', () => {
      const state = basePlan([inside]);
      // Left edge 0 → 24, right edge fixed at 96.
      const next = reducer(state, { type: 'resizeBed', id: 'bed-1', geometry: { cx: 60, cy: 24, widthIn: 72, heightIn: 48 } });
      expect(next.plants[0]).toEqual({ ...inside, x: 6 });
    });

    it('ignores an unknown bed', () => {
      const state = basePlan([inside]);
      expect(reducer(state, { type: 'resizeBed', id: 'nope', geometry })).toBe(state);
    });
  });

  it('removeBed removes the bed and only its plants', () => {
    const mine: PlantInstance = { id: 'a', bedId: 'bed-1', cropId: 'tomato', x: 1, y: 1, groupId: 'g1' };
    const theirs: PlantInstance = { id: 'b', bedId: 'bed-2', cropId: 'tomato', x: 1, y: 1, groupId: 'g2' };
    const state = twoBeds([mine, theirs]);
    const next = reducer(state, { type: 'removeBed', id: 'bed-1' });
    expect(next.beds).toEqual([bed2]);
    expect(next.plants).toEqual([theirs]);
    expect(state.beds).toHaveLength(2);
  });

  it('removeBed ignores an unknown bed', () => {
    const state = basePlan();
    expect(reducer(state, { type: 'removeBed', id: 'nope' })).toBe(state);
  });

  it('restoreLayout swaps in beds and plants, leaving name, profile, and dismissals', () => {
    const state = { ...twoBeds(), dismissedConflictKeys: ['x::y'] };
    const beds = [bed2];
    const plants: PlantInstance[] = [];
    const next = reducer(state, { type: 'restoreLayout', beds, plants });
    expect(next.beds).toBe(beds);
    expect(next.plants).toBe(plants);
    expect(next.profile).toBe(state.profile);
    expect(next.name).toBe(state.name);
    expect(next.dismissedConflictKeys).toBe(state.dismissedConflictKeys);
  });
});
