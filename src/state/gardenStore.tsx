import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import type { GardenPlan, PlantInstance, Profile } from '../types';
import { parsePlan, reducer } from './reducer';

const STORAGE_KEY = 'garden-planner-plan/v1';

function loadPlan(): GardenPlan {
  return parsePlan(localStorage.getItem(STORAGE_KEY));
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
