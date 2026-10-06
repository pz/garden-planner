import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { addGardenId, parseGardenIndex, removeGardenId, setActiveGardenId, type GardenIndex } from './gardenIndex';
import { LEGACY_PLAN_KEY, planStorageKey } from './gardenStore';
import { resolveMigration } from './migration';
import { createPlan, parsePlan } from './reducer';
import { storageKey } from './storageNamespace';

const INDEX_KEY = storageKey('garden-planner-index/v1');

function uid(): string {
  return crypto.randomUUID();
}

function saveIndex(index: GardenIndex) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

/**
 * Loads the garden roster, bootstrapping it if there isn't one yet: adopts a pre-multi-garden
 * plan (if present, under the old single-garden key) as the user's first garden rather than
 * losing it, or otherwise creates one fresh empty garden — the app always has at least one
 * garden to show.
 */
function loadOrInitIndex(): GardenIndex {
  const currentIndex = parseGardenIndex(localStorage.getItem(INDEX_KEY));
  const legacyRaw = localStorage.getItem(LEGACY_PLAN_KEY);
  const newId = uid();
  const { index, newPlan, hadLegacyData } = resolveMigration(currentIndex, legacyRaw, newId);

  if (newPlan) {
    localStorage.setItem(planStorageKey(newId), JSON.stringify(newPlan));
  }
  if (hadLegacyData) localStorage.removeItem(LEGACY_PLAN_KEY);
  saveIndex(index);
  return index;
}

/** A garden's display name, read live from its stored plan (no separate cache to fall out of sync). */
export function readGardenName(gardenId: string): string {
  return parsePlan(localStorage.getItem(planStorageKey(gardenId)), gardenId).name;
}

interface GardensContextValue {
  gardenIds: string[];
  activeGardenId: string | null;
  createGarden: () => void;
  removeGarden: (id: string) => void;
  switchGarden: (id: string) => void;
}

const GardensContext = createContext<GardensContextValue | null>(null);

export function GardensProvider({ children }: { children: ReactNode }) {
  const [index, setIndex] = useState<GardenIndex>(loadOrInitIndex);

  useEffect(() => {
    saveIndex(index);
  }, [index]);

  const value: GardensContextValue = {
    gardenIds: index.gardenIds,
    activeGardenId: index.activeGardenId,
    createGarden: () => {
      const id = uid();
      localStorage.setItem(planStorageKey(id), JSON.stringify(createPlan(id)));
      setIndex((prev) => setActiveGardenId(addGardenId(prev, id), id));
    },
    removeGarden: (id) => {
      localStorage.removeItem(planStorageKey(id));
      setIndex((prev) => removeGardenId(prev, id));
    },
    switchGarden: (id) => setIndex((prev) => setActiveGardenId(prev, id)),
  };

  return <GardensContext.Provider value={value}>{children}</GardensContext.Provider>;
}

export function useGardens(): GardensContextValue {
  const ctx = useContext(GardensContext);
  if (!ctx) throw new Error('useGardens must be used within a GardensProvider');
  return ctx;
}
