import type { GardenPlan, PlantInstance, Profile } from '../types';
import { conflictKey, findOverlapConflicts } from '../utils/spacing';

export const DEFAULT_PLAN: GardenPlan = {
  version: 2,
  profile: { zoneId: '6', sunExposure: 'full-sun', onboarded: false },
  bed: { id: 'bed-1', name: 'My garden bed', widthIn: 96, heightIn: 48 }, // fixed 8x4 ft bed
  plants: [],
  dismissedConflictKeys: [],
};

/** Parses a plan from raw storage content, falling back to the default plan for anything unusable. */
export function parsePlan(raw: string | null): GardenPlan {
  try {
    if (!raw) return DEFAULT_PLAN;
    const parsed = JSON.parse(raw) as GardenPlan;
    if (parsed.version !== 2) return DEFAULT_PLAN;
    return parsed;
  } catch {
    return DEFAULT_PLAN;
  }
}

export type Action =
  | { type: 'setProfile'; profile: Profile }
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
      return DEFAULT_PLAN;
    default:
      return state;
  }
}
