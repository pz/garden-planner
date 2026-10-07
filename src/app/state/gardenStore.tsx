import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { ApplyResult } from '../../api/apply';
import type { Command } from '../../api/commands';
import type { ApplyOptions, GardenApi } from '../../api/gardenApi';
import type { Warning } from '../../api/types';
import type { Bed, GardenPlan, PlantInstance, Profile } from '../../types';
import type { BedGeometry } from '../../core/layout';
import { createGardenApi, isMock } from './gardenApiFactory';

interface GardenContextValue {
  plan: GardenPlan;
  /** The garden's current revision. */
  rev: string;
  /** Every warning on the garden, dismissed ones included (flagged). */
  warnings: Warning[];
  /** Runs planting commands; see `GardenApi.apply`. Nothing changes if the result is not `ok`. */
  apply: (commands: Command[], options?: ApplyOptions) => ApplyResult;
  // Not planting commands yet: each becomes one as the API grows (see GardenApi.dispatch).
  setProfile: (profile: Profile) => void;
  setGardenName: (name: string) => void;
  addBed: (bed: Bed) => void;
  renameBed: (id: string, name: string) => void;
  moveBed: (id: string, dx: number, dy: number) => void;
  reshapeBed: (id: string, geometry: BedGeometry) => void;
  rotateBed: (id: string, rotationDeg: number) => void;
  pasteBed: (bed: Bed, plants: PlantInstance[]) => void;
  removeBed: (id: string) => void;
  restoreLayout: (beds: Bed[], plants: PlantInstance[]) => void;
}

const GardenContext = createContext<GardenContextValue | null>(null);

/**
 * Holds one garden for the UI, through its `GardenApi`. `gardenId` selects which saved garden — mount
 * this with `key={gardenId}` at the call site so switching gardens gets a clean remount (a fresh
 * API, a fresh load). `api` replaces the real, localStorage-backed one; tests pass a mock.
 */
export function GardenProvider({ gardenId, api: injected, children }: { gardenId: string; api?: GardenApi; children: ReactNode }) {
  const [api] = useState(() => injected ?? createGardenApi(gardenId));
  const snapshot = useSyncExternalStore(api.subscribe, api.getSnapshot);

  // Let browser tests reach a mock API (development builds only; see mockApiFlagKey).
  useEffect(() => {
    if (!import.meta.env.DEV || !isMock(api)) return;
    window.__mockGardenApi = api;
    return () => {
      if (window.__mockGardenApi === api) delete window.__mockGardenApi;
    };
  }, [api]);

  const value = useMemo<GardenContextValue>(
    () => ({
      plan: snapshot.plan,
      rev: snapshot.rev,
      // `snapshot` is a new object whenever the garden (or a mock's warnings) change.
      warnings: api.warnings(),
      apply: api.apply,
      setProfile: (profile) => api.dispatch({ type: 'setProfile', profile }),
      setGardenName: (name) => api.dispatch({ type: 'setGardenName', name }),
      addBed: (bed) => api.dispatch({ type: 'addBed', bed }),
      renameBed: (id, name) => api.dispatch({ type: 'renameBed', id, name }),
      moveBed: (id, dx, dy) => api.dispatch({ type: 'moveBed', id, dx, dy }),
      reshapeBed: (id, geometry) => api.dispatch({ type: 'reshapeBed', id, geometry }),
      rotateBed: (id, rotationDeg) => api.dispatch({ type: 'rotateBed', id, rotationDeg }),
      pasteBed: (bed, plants) => api.dispatch({ type: 'pasteBed', bed, plants }),
      removeBed: (id) => api.dispatch({ type: 'removeBed', id }),
      restoreLayout: (beds, plants) => api.dispatch({ type: 'restoreLayout', beds, plants }),
    }),
    [api, snapshot],
  );

  return <GardenContext.Provider value={value}>{children}</GardenContext.Provider>;
}

export function useGarden(): GardenContextValue {
  const ctx = useContext(GardenContext);
  if (!ctx) throw new Error('useGarden must be used within a GardenProvider');
  return ctx;
}
