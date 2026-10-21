import type { CropDef } from '../../types';
import { parseCustomCrop } from '../../data/crops';

/**
 * The gardener's own plants. They belong to the app, not to one garden: made once, they can go
 * in any garden. (A garden file carries the ones it uses, so it loads on another device.)
 */
export interface CustomCropLibrary {
  version: 1;
  crops: CropDef[];
}

export const EMPTY_LIBRARY: CustomCropLibrary = { version: 1, crops: [] };

/** Parses the library from raw storage content, keeping every well-formed plant and falling back to none. */
export function parseCustomCrops(raw: string | null): CustomCropLibrary {
  try {
    if (!raw) return EMPTY_LIBRARY;
    const parsed = JSON.parse(raw) as { version?: unknown; crops?: unknown };
    if (parsed?.version !== 1 || !Array.isArray(parsed.crops)) return EMPTY_LIBRARY;
    const seen = new Set<string>();
    const crops = parsed.crops.flatMap((c) => {
      const crop = parseCustomCrop(c);
      if (!crop || seen.has(crop.id)) return [];
      seen.add(crop.id);
      return [crop];
    });
    return { version: 1, crops };
  } catch {
    return EMPTY_LIBRARY;
  }
}

/** Adds a plant, or replaces the one with the same id (keeping its place in the list). */
export function upsertCustomCrop(lib: CustomCropLibrary, crop: CropDef): CustomCropLibrary {
  const has = lib.crops.some((c) => c.id === crop.id);
  return { ...lib, crops: has ? lib.crops.map((c) => (c.id === crop.id ? crop : c)) : [...lib.crops, crop] };
}

export function removeCustomCrop(lib: CustomCropLibrary, id: string): CustomCropLibrary {
  return lib.crops.some((c) => c.id === id) ? { ...lib, crops: lib.crops.filter((c) => c.id !== id) } : lib;
}

/**
 * Adds the plants a loaded garden file brought with it. One the library already has (same id)
 * stays as it is here: the id is the plant's identity, and the gardener's local edits win.
 */
export function mergeCustomCrops(lib: CustomCropLibrary, incoming: CropDef[]): CustomCropLibrary {
  const have = new Set(lib.crops.map((c) => c.id));
  const fresh = incoming.filter((c, i) => !have.has(c.id) && incoming.findIndex((d) => d.id === c.id) === i);
  return fresh.length ? { ...lib, crops: [...lib.crops, ...fresh] } : lib;
}

/** A fresh id for a new plant. */
export function newCustomCropId(random: () => string = () => crypto.randomUUID()): string {
  return `custom-${random().slice(0, 8)}`;
}
