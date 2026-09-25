import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import type { Bed, GardenPlan, PlantInstance, Profile } from '../types';
import type { BedGeometry } from '../utils/layout';
import { parsePlan, reducer } from './reducer';
import { storageKey } from './storageNamespace';

/** Pre-multi-garden storage key, kept only so gardensStore can migrate it into the new scheme. */
export const LEGACY_PLAN_KEY = storageKey('garden-planner-plan/v1');

export function planStorageKey(gardenId: string): string {
  return storageKey(`garden-planner-plan:${gardenId}`);
}

interface GardenContextValue {
  plan: GardenPlan;
  setProfile: (profile: Profile) => void;
  setGardenName: (name: string) => void;
  addBed: (bed: Bed) => void;
  renameBed: (id: string, name: string) => void;
  moveBed: (id: string, dx: number, dy: number) => void;
  resizeBed: (id: string, geometry: BedGeometry) => void;
  removeBed: (id: string) => void;
  restoreLayout: (beds: Bed[], plants: PlantInstance[]) => void;
  addPlants: (plants: PlantInstance[]) => void;
  moveGroup: (groupId: string, dx: number, dy: number) => void;
  removePlant: (id: string) => void;
  removeGroup: (groupId: string) => void;
  setVariety: (id: string, variety: string | undefined) => void;
  dismissConflictsForGroup: (groupId: string) => void;
}

const GardenContext = createContext<GardenContextValue | null>(null);

/**
 * Loads, holds, and persists a single garden's plan. `gardenId` selects which one — mount
 * this with `key={gardenId}` at the call site so switching gardens gets a clean remount
 * (fresh reducer state, fresh load) instead of trying to rehydrate reducer state in place.
 */
export function GardenProvider({ gardenId, children }: { gardenId: string; children: ReactNode }) {
  const [plan, dispatch] = useReducer(reducer, gardenId, (id) => parsePlan(localStorage.getItem(planStorageKey(id)), id));

  useEffect(() => {
    localStorage.setItem(planStorageKey(gardenId), JSON.stringify(plan));
  }, [gardenId, plan]);

  const value = useMemo<GardenContextValue>(
    () => ({
      plan,
      setProfile: (profile) => dispatch({ type: 'setProfile', profile }),
      setGardenName: (name) => dispatch({ type: 'setGardenName', name }),
      addBed: (bed) => dispatch({ type: 'addBed', bed }),
      renameBed: (id, name) => dispatch({ type: 'renameBed', id, name }),
      moveBed: (id, dx, dy) => dispatch({ type: 'moveBed', id, dx, dy }),
      resizeBed: (id, geometry) => dispatch({ type: 'resizeBed', id, geometry }),
      removeBed: (id) => dispatch({ type: 'removeBed', id }),
      restoreLayout: (beds, plants) => dispatch({ type: 'restoreLayout', beds, plants }),
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
