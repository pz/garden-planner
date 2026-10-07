import { storageKey } from './storageNamespace';

/** Pre-multi-garden storage key, kept only so gardensStore can migrate it into the new scheme. */
export const LEGACY_PLAN_KEY = storageKey('garden-planner-plan/v1');

/** Where one garden's plan is saved. */
export function planStorageKey(gardenId: string): string {
  return storageKey(`garden-planner-plan:${gardenId}`);
}
