import type { Bed, GardenPlan, PlantInstance, Profile } from '../types';
import { parseGardenLocation } from '../utils/location';
import { relocatePlants, type BedGeometry } from '../utils/layout';
import { conflictKey, findOverlapConflicts } from '../utils/spacing';

/** Template for a fresh garden; always used via createPlan so every garden gets its own id. */
export const DEFAULT_PLAN: GardenPlan = {
  version: 3,
  id: '',
  name: 'My garden',
  profile: { zoneId: '6', sunExposure: 'full-sun', onboarded: false },
  // One 8′ × 4′ bed with its top-left corner at the garden origin.
  beds: [{ id: 'bed-1', name: 'Bed 1', shape: 'rect', cx: 48, cy: 24, widthIn: 96, heightIn: 48, rotationDeg: 0 }],
  plants: [],
  dismissedConflictKeys: [],
};

/** A fresh, empty garden with the given id. */
export function createPlan(id: string): GardenPlan {
  return { ...DEFAULT_PLAN, id };
}

/** The stored shape before multiple beds: one fixed bed, and plants with no bedId. */
interface PlanV2 {
  version: 2;
  profile: Profile;
  bed: { id: string; name: string; widthIn: number; heightIn: number };
  plants: Omit<PlantInstance, 'bedId'>[];
  dismissedConflictKeys: string[];
}

/**
 * Lifts a single-bed plan into the multi-bed layout: its one bed becomes the garden's only bed,
 * placed with its top-left at the garden origin, and its name names the garden too. Plant
 * coordinates were already bed-local, so they carry over unchanged. Null if the stored bed is
 * unusable (there'd be nowhere to put the plants).
 */
function migrateV2(v2: PlanV2, id: string): GardenPlan | null {
  const b = v2.bed;
  const isSide = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  if (typeof b !== 'object' || b === null || !isSide(b.widthIn) || !isSide(b.heightIn)) return null;
  const bedId = typeof b.id === 'string' && b.id ? b.id : 'bed-1';
  const name = typeof b.name === 'string' ? b.name : DEFAULT_PLAN.name;
  return {
    version: 3,
    id,
    name,
    profile: v2.profile,
    beds: [
      { id: bedId, name, shape: 'rect', cx: b.widthIn / 2, cy: b.heightIn / 2, widthIn: b.widthIn, heightIn: b.heightIn, rotationDeg: 0 },
    ],
    plants: Array.isArray(v2.plants) ? v2.plants.map((p) => ({ ...p, bedId })) : [],
    dismissedConflictKeys: Array.isArray(v2.dismissedConflictKeys) ? v2.dismissedConflictKeys : [],
  };
}

/**
 * Parses a garden plan from raw storage content, falling back to a fresh plan for anything
 * unusable. `id` is always authoritative — it comes from the storage key the plan was read
 * from, and is forced onto the result even if the stored JSON disagrees (or lacks one, from
 * before gardens had ids). Single-bed (v2) plans are migrated to the multi-bed layout; plants
 * whose bed no longer exists are dropped.
 */
export function parsePlan(raw: string | null, id: string): GardenPlan {
  try {
    if (!raw) return createPlan(id);
    const stored = JSON.parse(raw) as { version?: unknown };
    let parsed: GardenPlan | null;
    if (stored?.version === 2) parsed = migrateV2(stored as PlanV2, id);
    else if (stored?.version === 3) parsed = stored as GardenPlan;
    else return createPlan(id);
    if (!parsed || !Array.isArray(parsed.beds)) return createPlan(id);
    const bedIds = new Set(parsed.beds.map((b) => b.id));
    const plants = Array.isArray(parsed.plants) ? parsed.plants.filter((p) => bedIds.has(p.bedId)) : [];
    parsed = { ...parsed, id, plants };
    if (typeof parsed.profile !== 'object' || parsed.profile === null) return parsed;
    // `location` is optional and newer than v2 itself, so validate it rather than trust it:
    // a bad value just drops the pin instead of breaking the setup screen's map.
    const { location, ...profile } = parsed.profile;
    const cleanLocation = parseGardenLocation(location);
    return { ...parsed, profile: cleanLocation ? { ...profile, location: cleanLocation } : profile };
  } catch {
    return createPlan(id);
  }
}

export type Action =
  | { type: 'setProfile'; profile: Profile }
  | { type: 'setGardenName'; name: string }
  | { type: 'addBed'; bed: Bed }
  | { type: 'renameBed'; id: string; name: string }
  | { type: 'moveBed'; id: string; dx: number; dy: number }
  | { type: 'resizeBed'; id: string; geometry: BedGeometry }
  | { type: 'removeBed'; id: string }
  | { type: 'restoreLayout'; beds: Bed[]; plants: PlantInstance[] }
  | { type: 'addPlants'; plants: PlantInstance[] }
  | { type: 'moveGroup'; groupId: string; dx: number; dy: number }
  | { type: 'removePlant'; id: string }
  | { type: 'removeGroup'; groupId: string }
  | { type: 'setVariety'; id: string; variety: string | undefined }
  | { type: 'dismissConflictsForGroup'; groupId: string }
  | { type: 'reset' };

export function reducer(state: GardenPlan, action: Action): GardenPlan {
  switch (action.type) {
    case 'setProfile':
      return { ...state, profile: action.profile };
    case 'setGardenName':
      return { ...state, name: action.name };
    case 'addBed':
      return { ...state, beds: [...state.beds, action.bed] };
    case 'renameBed':
      return { ...state, beds: state.beds.map((b) => (b.id === action.id ? { ...b, name: action.name } : b)) };
    case 'moveBed':
      // Plants are stored relative to their bed, so they come along without being touched.
      if (action.dx === 0 && action.dy === 0) return state;
      return {
        ...state,
        beds: state.beds.map((b) => (b.id === action.id ? { ...b, cx: b.cx + action.dx, cy: b.cy + action.dy } : b)),
      };
    case 'resizeBed': {
      // Plants stay where they are in the garden as the edges move; any the bed no longer
      // covers are removed. (The editor confirms that with the user before dispatching.)
      const prev = state.beds.find((b) => b.id === action.id);
      if (!prev) return state;
      const next: Bed = { ...prev, ...action.geometry };
      const { plants, outsideIds } = relocatePlants(prev, next, state.plants);
      const outside = new Set(outsideIds);
      return {
        ...state,
        beds: state.beds.map((b) => (b.id === action.id ? next : b)),
        plants: outside.size ? plants.filter((p) => !outside.has(p.id)) : plants,
      };
    }
    case 'removeBed':
      if (!state.beds.some((b) => b.id === action.id)) return state;
      return {
        ...state,
        beds: state.beds.filter((b) => b.id !== action.id),
        plants: state.plants.filter((p) => p.bedId !== action.id),
      };
    case 'restoreLayout':
      return { ...state, beds: action.beds, plants: action.plants };
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
      return createPlan(state.id);
    default:
      return state;
  }
}
