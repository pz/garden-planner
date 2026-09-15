import type { GardenPlan } from '../types';
import { addGardenId, type GardenIndex } from './gardenIndex';
import { createPlan, parsePlan } from './reducer';

export interface MigrationResult {
  index: GardenIndex;
  /** The plan to persist under `newId`, or null if no new garden was created. */
  newPlan: GardenPlan | null;
  /** Whether legacy data was adopted (the caller should remove the old storage key). */
  hadLegacyData: boolean;
}

/**
 * Decides how to bootstrap the garden roster: adopts a pre-multi-garden plan (if present) as
 * the user's first garden, creates one fresh if not, or — if the roster is already populated —
 * leaves it and any legacy data untouched.
 */
export function resolveMigration(currentIndex: GardenIndex, legacyRaw: string | null, newId: string): MigrationResult {
  if (currentIndex.gardenIds.length > 0) {
    return { index: currentIndex, newPlan: null, hadLegacyData: false };
  }
  return {
    index: addGardenId(currentIndex, newId),
    newPlan: legacyRaw ? parsePlan(legacyRaw, newId) : createPlan(newId),
    hadLegacyData: legacyRaw !== null,
  };
}
