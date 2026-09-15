import { describe, expect, it } from 'vitest';
import { DEFAULT_INDEX, type GardenIndex } from './gardenIndex';
import { resolveMigration } from './migration';
import { createPlan } from './reducer';
import type { GardenPlan } from '../types';

const LEGACY_PLAN: GardenPlan = {
  version: 2,
  id: 'whatever-was-stored',
  profile: { zoneId: '7', sunExposure: 'part-shade', onboarded: true },
  bed: { id: 'bed-1', name: 'The Sunny Corner Bed', widthIn: 96, heightIn: 48 },
  plants: [{ id: 'p1', cropId: 'tomato', x: 10, y: 10, groupId: 'g1' }],
  dismissedConflictKeys: [],
};

describe('resolveMigration', () => {
  it('adopts legacy data as the first garden when the roster is empty', () => {
    const result = resolveMigration(DEFAULT_INDEX, JSON.stringify(LEGACY_PLAN), 'new-id');

    expect(result.index).toEqual({ version: 1, gardenIds: ['new-id'], activeGardenId: 'new-id' });
    expect(result.newPlan).toEqual({ ...LEGACY_PLAN, id: 'new-id' });
    expect(result.hadLegacyData).toBe(true);
  });

  it('creates a fresh empty garden when the roster is empty and there is no legacy data', () => {
    const result = resolveMigration(DEFAULT_INDEX, null, 'new-id');

    expect(result.index).toEqual({ version: 1, gardenIds: ['new-id'], activeGardenId: 'new-id' });
    expect(result.newPlan).toEqual(createPlan('new-id'));
    expect(result.hadLegacyData).toBe(false);
  });

  it('leaves an already-populated roster and any legacy data untouched', () => {
    const index: GardenIndex = { version: 1, gardenIds: ['existing'], activeGardenId: 'existing' };
    const result = resolveMigration(index, JSON.stringify(LEGACY_PLAN), 'new-id');

    expect(result.index).toBe(index);
    expect(result.newPlan).toBeNull();
    expect(result.hadLegacyData).toBe(false);
  });
});
