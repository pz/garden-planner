import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { ApplyResult } from '../../api/apply';
import { addBedCommand, type Command } from '../../api/commands';
import type { ApplyOptions, GardenApi } from '../../api/gardenApi';
import type { Warning } from '../../api/types';
import type { Bed, GardenLine, GardenPlan, PlantInstance, Profile } from '../../types';
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
  // Layout and profile edits: thin wrappers that send one command each.
  setProfile: (profile: Profile) => void;
  setGardenName: (name: string) => void;
  setNorth: (northDeg: number) => void;
  addBed: (bed: Bed) => void;
  renameBed: (id: string, name: string) => void;
  moveBed: (id: string, dx: number, dy: number) => void;
  reshapeBed: (id: string, geometry: BedGeometry) => void;
  rotateBed: (id: string, rotationDeg: number) => void;
  pasteBed: (bed: Bed, plants: PlantInstance[]) => void;
  removeBed: (id: string) => void;
  restoreLayout: (beds: Bed[], plants: PlantInstance[], lines?: GardenLine[]) => void;
  addLine: (line: GardenLine) => void;
  removeLine: (id: string) => void;
}

/**
 * Sends commands the caller has already checked (the layout editor snaps and confirms before it
 * commits). If the API refuses them anyway nothing changed, so there's nothing to undo; the reason
 * goes to the console rather than being swallowed.
 */
function run(api: GardenApi, commands: Command[]): void {
  const result = api.apply(commands);
  if (!result.ok) console.error('The garden API refused an edit:', result.errors);
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
      setProfile: (profile) => run(api, [{ type: 'setProfile', profile }]),
      setGardenName: (name) => run(api, [{ type: 'setGardenName', name }]),
      setNorth: (northDeg) => run(api, [{ type: 'setNorth', northDeg }]),
      addBed: (bed) => run(api, [addBedCommand(bed)]),
      renameBed: (id, name) => run(api, [{ type: 'renameBed', id, name }]),
      moveBed: (id, dx, dy) => run(api, [{ type: 'moveBed', id, dx, dy }]),
      reshapeBed: (id, geometry) => run(api, [{ type: 'reshapeBed', id, ...geometry }]),
      rotateBed: (id, rotationDeg) => run(api, [{ type: 'rotateBed', id, rotationDeg }]),
      pasteBed: (bed, plants) => run(api, [{ type: 'pasteBed', bed, plants }]),
      removeBed: (id) => run(api, [{ type: 'removeBed', id }]),
      restoreLayout: (beds, plants, lines) => run(api, [{ type: 'restoreLayout', beds, plants, ...(lines ? { lines } : {}) }]),
      addLine: (line) => run(api, [{ type: 'addLine', id: line.id, a: line.a, b: line.b }]),
      removeLine: (id) => run(api, [{ type: 'removeLine', id }]),
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
