import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import type { GardenPlan, PlantInstance, Profile } from '../types';

const STORAGE_KEY = 'garden-planner-plan/v1';

const DEFAULT_PLAN: GardenPlan = {
  version: 1,
  profile: { zoneId: '6', sunExposure: 'full-sun', onboarded: false },
  bed: { id: 'bed-1', name: 'My garden bed', widthIn: 96, heightIn: 48 }, // fixed 8x4 ft bed
  plants: [],
};

function loadPlan(): GardenPlan {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PLAN;
    const parsed = JSON.parse(raw) as GardenPlan;
    if (parsed.version !== 1) return DEFAULT_PLAN;
    return parsed;
  } catch {
    return DEFAULT_PLAN;
  }
}

type Action =
  | { type: 'setProfile'; profile: Profile }
  | { type: 'addPlants'; plants: PlantInstance[] }
  | { type: 'movePlant'; id: string; x: number; y: number }
  | { type: 'removePlant'; id: string }
  | { type: 'removeGroup'; groupId: string }
  | { type: 'setVariety'; id: string; variety: string | undefined }
  | { type: 'dismissWarning'; id: string }
  | { type: 'reset' };

function reducer(state: GardenPlan, action: Action): GardenPlan {
  switch (action.type) {
    case 'setProfile':
      return { ...state, profile: action.profile };
    case 'addPlants':
      return { ...state, plants: [...state.plants, ...action.plants] };
    case 'movePlant':
      return {
        ...state,
        plants: state.plants.map((p) => (p.id === action.id ? { ...p, x: action.x, y: action.y } : p)),
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
    case 'dismissWarning':
      return {
        ...state,
        plants: state.plants.map((p) => (p.id === action.id ? { ...p, warningDismissed: true } : p)),
      };
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
  movePlant: (id: string, x: number, y: number) => void;
  removePlant: (id: string) => void;
  removeGroup: (groupId: string) => void;
  setVariety: (id: string, variety: string | undefined) => void;
  dismissWarning: (id: string) => void;
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
      movePlant: (id, x, y) => dispatch({ type: 'movePlant', id, x, y }),
      removePlant: (id) => dispatch({ type: 'removePlant', id }),
      removeGroup: (groupId) => dispatch({ type: 'removeGroup', groupId }),
      setVariety: (id, variety) => dispatch({ type: 'setVariety', id, variety }),
      dismissWarning: (id) => dispatch({ type: 'dismissWarning', id }),
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
