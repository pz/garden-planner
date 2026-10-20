import { createMemoryGardenApi, type GardenApi } from '../../api/gardenApi';
import { createMockGardenApi, type MockGardenApi } from '../../api/mockGardenApi';
import { parsePlan } from '../../core/reducer';
import { planStorageKey } from './planStorage';
import { storageKey } from './storageNamespace';

/**
 * Set to "1" in localStorage (before the app loads) to run the app against a `MockGardenApi`
 * instead of the real one, in development builds only. The mock is then reachable as
 * `window.__mockGardenApi` so browser tests can script it. Never active in a production build.
 */
export const mockApiFlagKey = () => storageKey('garden-planner-mock-api');

declare global {
  interface Window {
    __mockGardenApi?: MockGardenApi;
  }
}

const newId = () => crypto.randomUUID();

export function isMock(api: GardenApi): api is MockGardenApi {
  return 'failNext' in api;
}

/** The `GardenApi` for one saved garden: loaded from, and saved to, localStorage. */
export function createGardenApi(gardenId: string): GardenApi {
  const key = planStorageKey(gardenId);
  const initial = parsePlan(localStorage.getItem(key), gardenId);
  if (import.meta.env.DEV && localStorage.getItem(mockApiFlagKey()) === '1') {
    return createMockGardenApi(initial, { newId });
  }
  // Save what was loaded too, so an older stored plan is upgraded to the current format on first open.
  localStorage.setItem(key, JSON.stringify(initial));
  return createMemoryGardenApi(initial, { newId, onChange: (plan) => localStorage.setItem(key, JSON.stringify(plan)) });
}
