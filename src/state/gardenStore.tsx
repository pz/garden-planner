import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import type { GardenPlan, PlantInstance, Profile } from '../types';
import { conflictKey, findOverlapConflicts } from '../utils/spacing';

const STORAGE_KEY = 'garden-planner-plan/v1';

const DEFAULT_PLAN: GardenPlan = {
  version: 2,
  profile: { zoneId: '6', sunExposure: 'full-sun', onboarded: false },
  bed: { id: 'bed-1', name: 'My garden bed', widthIn: 96, heightIn: 48 }, // fixed 8x4 ft bed
  plants: [],
  dismissedConflictKeys: [],
};

function loadPlan(): GardenPlan {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PLAN;
    const parsed = JSON.parse(raw) as GardenPlan;
    if (parsed.version !== 2) return DEFAULT_PLAN;
    return parsed;
  } catch {
    return DEFAULT_PLAN;
  }
}

type Action =
  | { type: 'setProfile'; profile: Profile }
  | { type: 'addPlants'; plants: PlantInstance[] }
  | { type: 'moveGroup'; groupId: string; dx: number; dy: number }
  | { type: 'removePlant'; id: string }
  | { type: 'removeGroup'; groupId: string }
  | { type: 'setVariety'; id: string; variety: string | undefined }
  | { type: 'dismissConflictsForGroup'; groupId: string }
  | { type: 'reset' };

function reducer(state: GardenPlan, action: Action): GardenPlan {
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

interface GardenContextValue {
  plan: GardenPlan;
  setProfile: (profile: Profile) => void;
  addPlants: (plants: PlantInstance[]) => void;
  moveGroup: (groupId: string, dx: number, dy: number) => void;
  removePlant: (id: string) => void;
  removeGroup: (groupId: string) => void;
  setVariety: (id: string, variety: string | undefined) => void;
  dismissConflictsForGroup: (groupId: string) => void;
}

const GardenContext = createContext<GardenContextValue | null>(null);

export function GardenProvider({ children }: { children: ReactNode }) {
  const [plan, dispatch] = useReducer(reducer, undefined, loadPlan);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
  }, [plan]);

  const value = useMemo<GardenContextValue>(
    () => ({
      plan,
      setProfile: (profile) => dispatch({ type: 'setProfile', profile }),
      addPlants: (plants) => dispatch({ type: 'addPlants', plants }),
      moveGroup: (groupId, dx, dy) => dispatch({ type: 'moveGroup', groupId, dx, dy }),
      removePlant: (id) => dispatch({ type: 'removePlant', id }),
      removeGroup: (groupId) => dispatch({ type: 'removeGroup', groupId }),
      setVariety: (id, variety) => dispatch({ type: 'setVariety', id, variety }),
      dismissConflictsForGroup: (groupId) => dispatch({ type: 'dismissConflictsForGroup', groupId }),
    }),
    [plan],
  );

  return <GardenContext.Provider value={value}>{children}</GardenContext.Provider>;
}

export function useGarden(): GardenContextValue {
  const ctx = useContext(GardenContext);
  if (!ctx) throw new Error('useGarden must be used within a GardenProvider');
  return ctx;
}
