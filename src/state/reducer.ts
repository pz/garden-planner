import type { GardenPlan, PlantInstance, Profile } from '../types';
import { parseGardenLocation } from '../utils/location';
import { conflictKey, findOverlapConflicts } from '../utils/spacing';

/** Template for a fresh garden; always used via createPlan so every garden gets its own id. */
export const DEFAULT_PLAN: GardenPlan = {
  version: 2,
  id: '',
  profile: { zoneId: '6', sunExposure: 'full-sun', onboarded: false },
  bed: { id: 'bed-1', name: 'My garden bed', widthIn: 96, heightIn: 48 }, // fixed 8x4 ft bed
  plants: [],
  dismissedConflictKeys: [],
};

/** A fresh, empty garden with the given id. */
export function createPlan(id: string): GardenPlan {
  return { ...DEFAULT_PLAN, id };
}

/**
 * Parses a garden plan from raw storage content, falling back to a fresh plan for anything
 * unusable. `id` is always authoritative — it comes from the storage key the plan was read
 * from, and is forced onto the result even if the stored JSON disagrees (or lacks one, from
 * before gardens had ids).
 */
export function parsePlan(raw: string | null, id: string): GardenPlan {
  try {
    if (!raw) return createPlan(id);
    const parsed = JSON.parse(raw) as GardenPlan;
    if (parsed.version !== 2) return createPlan(id);
    if (typeof parsed.profile !== 'object' || parsed.profile === null) return { ...parsed, id };
    // `location` is optional and newer than v2 itself, so validate it rather than trust it:
    // a bad value just drops the pin instead of breaking the setup screen's map.
    const { location, ...profile } = parsed.profile;
    const cleanLocation = parseGardenLocation(location);
    return { ...parsed, id, profile: cleanLocation ? { ...profile, location: cleanLocation } : profile };
  } catch {
    return createPlan(id);
  }
}

export type Action =
  | { type: 'setProfile'; profile: Profile }
  | { type: 'setBedName'; name: string }
  | { type: 'addPlants'; plants: PlantInstance[] }
  | { type: 'moveGroup'; groupId: string; dx: number; dy: number }
  | { type: 'removePlant'; id: string }
  | { type: 'removeGroup'; groupId: string }
  | { type: 'setVariety'; id: string; variety: string | undefined }
  | { type: 'dismissConflictsForGroup'; groupId: string }
  | { type: 'reset' };

export function reducer(state: GardenPlan, action: Action): GardenPlan {
  switch (action.type) {
    case 'setProfile':
      return { ...state, profile: action.profile };
    case 'setBedName':
      return { ...state, bed: { ...state.bed, name: action.name } };
    case 'addPlants':
      return { ...state, plants: [...state.plants, ...action.plants] };
    case 'moveGroup':
      return {
        ...state,
        plants: state.plants.map((p) =>
          p.groupId === action.groupId ? { ...p, x: p.x + action.dx, y: p.y + action.dy } : p,
        ),
      };
    case 'removePlant':
      return { ...state, plants: state.plants.filter((p) => p.id !== action.id) };
    case 'removeGroup':
      return { ...state, plants: state.plants.filter((p) => p.groupId !== action.groupId) };
    case 'setVariety':
      return {
        ...state,
        plants: state.plants.map((p) => (p.id === action.id ? { ...p, variety: action.variety } : p)),
      };
    case 'dismissConflictsForGroup': {
      const touching = findOverlapConflicts(state.plants).filter(
        (c) => c.a === action.groupId || c.b === action.groupId,
      );
      if (touching.length === 0) return state;
      const merged = new Set(state.dismissedConflictKeys);
      for (const c of touching) merged.add(conflictKey(c.a, c.b));
      return { ...state, dismissedConflictKeys: [...merged] };
    }
    case 'reset':
      return createPlan(state.id);
    default:
      return state;
  }
}
