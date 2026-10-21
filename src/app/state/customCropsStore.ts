import { useSyncExternalStore } from 'react';
import type { CropDef } from '../../types';
import { setCustomCrops } from '../../data/crops';
import { EMPTY_LIBRARY, mergeCustomCrops, parseCustomCrops, removeCustomCrop as removeFrom, upsertCustomCrop as upsertInto, type CustomCropLibrary } from './customCrops';
import { storageKey } from './storageNamespace';

const KEY = storageKey('garden-planner-custom-crops/v1');

let library: CustomCropLibrary = EMPTY_LIBRARY;
const listeners = new Set<() => void>();

function publish(next: CustomCropLibrary) {
  if (next === library) return;
  library = next;
  setCustomCrops(library.crops); // the engine looks plants up by id through the data layer's registry
  try {
    localStorage.setItem(KEY, JSON.stringify(library));
  } catch {
    // Storage full or blocked: the plants still work for this session.
  }
  for (const l of listeners) l();
}

/**
 * Loads the saved library into the engine. Call once at startup, before any garden is read: a
 * garden's plants of a user-made plant are only understood once it's registered.
 */
export function loadCustomCrops(): void {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // Storage blocked: start with none.
  }
  library = parseCustomCrops(raw);
  setCustomCrops(library.crops);
  for (const l of listeners) l();
}

export const saveCustomCrop = (crop: CropDef) => publish(upsertInto(library, crop));
export const deleteCustomCrop = (id: string) => publish(removeFrom(library, id));
/** Adds the user-made plants that came with a garden file. */
export const addCustomCrops = (crops: CropDef[]) => publish(mergeCustomCrops(library, crops));

/** The gardener's own plants; re-renders when they change. */
export function useCustomCrops(): CropDef[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => library.crops,
  );
}
