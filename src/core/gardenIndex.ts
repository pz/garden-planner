/** The roster of a user's saved gardens: which ids exist, and which one is active. */
export interface GardenIndex {
  version: 1;
  /** Garden ids in creation order. */
  gardenIds: string[];
  activeGardenId: string | null;
}

export const DEFAULT_INDEX: GardenIndex = {
  version: 1,
  gardenIds: [],
  activeGardenId: null,
};

/** Parses a garden index from raw storage content, falling back to an empty index for anything unusable. */
export function parseGardenIndex(raw: string | null): GardenIndex {
  try {
    if (!raw) return DEFAULT_INDEX;
    const parsed = JSON.parse(raw) as GardenIndex;
    if (parsed.version !== 1 || !Array.isArray(parsed.gardenIds)) return DEFAULT_INDEX;
    return parsed;
  } catch {
    return DEFAULT_INDEX;
  }
}

/** Adds a new garden id to the roster. The first garden ever added becomes active automatically. */
export function addGardenId(index: GardenIndex, id: string): GardenIndex {
  if (index.gardenIds.includes(id)) return index;
  return {
    ...index,
    gardenIds: [...index.gardenIds, id],
    activeGardenId: index.activeGardenId ?? id,
  };
}

/**
 * Removes a garden id from the roster. If it was the active garden, falls back to the next
 * remaining garden (by roster order), or null if none are left.
 */
export function removeGardenId(index: GardenIndex, id: string): GardenIndex {
  if (!index.gardenIds.includes(id)) return index;
  const gardenIds = index.gardenIds.filter((gid) => gid !== id);
  const activeGardenId = index.activeGardenId === id ? (gardenIds[0] ?? null) : index.activeGardenId;
  return { ...index, gardenIds, activeGardenId };
}

/** Sets the active garden. A no-op if the id isn't in the roster. */
export function setActiveGardenId(index: GardenIndex, id: string): GardenIndex {
  if (!index.gardenIds.includes(id)) return index;
  if (index.activeGardenId === id) return index;
  return { ...index, activeGardenId: id };
}
