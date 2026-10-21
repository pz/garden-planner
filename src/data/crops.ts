import type { CropDef, CropLook } from '../types';
import cropsData from './crops.json';

// The built-in crops, each with the planting schedule and spacing the app is built around.
// Field meanings are documented in ./README.md.
export const CROPS: CropDef[] = cropsData as CropDef[];

/** User-made plants are registered here by the app (from its saved library, or a loaded garden file). */
const custom = new Map<string, CropDef>();

/** Prefix of every user-made plant's id, so one can never collide with a built-in crop. */
export const CUSTOM_CROP_PREFIX = 'custom-';

export const isCustomCropId = (id: string) => id.startsWith(CUSTOM_CROP_PREFIX);

/** Replaces the registered user-made plants. Entries that aren't well-formed are ignored. */
export function setCustomCrops(defs: unknown[]): void {
  custom.clear();
  for (const d of defs) {
    const crop = parseCustomCrop(d);
    if (crop) custom.set(crop.id, crop);
  }
}

/** The registered user-made plants, in the order they were registered. */
export const customCrops = (): CropDef[] => [...custom.values()];

/** Every crop a plant can be: the built-in ones, then the user-made ones. */
export const allCrops = (): CropDef[] => [...CROPS, ...custom.values()];

export function findCrop(id: string): CropDef | undefined {
  return CROPS.find((c) => c.id === id) ?? custom.get(id);
}

export function getCrop(id: string): CropDef {
  const crop = findCrop(id);
  if (!crop) throw new Error(`Unknown crop: ${id}`);
  return crop;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;

/** Longest spacing or height a user-made plant may have, in inches. */
export const MAX_CUSTOM_LENGTH_IN = 240;

const LOOK_KEYS = ['like', 'shape', 'leaf', 'accent'] as const;

/**
 * Reads a user-made plant from storage or a garden file, rebuilding it from the fields it
 * should have (so a stray or missing one can't leak in). Null if it isn't well-formed.
 */
export function parseCustomCrop(v: unknown): CropDef | null {
  if (!isRecord(v) || !isStr(v.id) || !isCustomCropId(v.id) || v.id.length === CUSTOM_CROP_PREFIX.length) return null;
  if (!isStr(v.name) || v.name.trim() === '') return null;
  const length = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= MAX_CUSTOM_LENGTH_IN;
  // A height of 0 (or none) means the gardener didn't say.
  if (!length(v.spacingIn) || (v.heightIn !== undefined && v.heightIn !== 0 && !length(v.heightIn)) || !isRecord(v.look)) return null;
  const look: CropLook = {};
  for (const k of LOOK_KEYS) {
    const x = v.look[k];
    if (x === undefined) continue;
    if (!isStr(x, 40)) return null;
    look[k] = x;
  }
  return makeCustomCrop({ id: v.id, name: v.name, spacingIn: v.spacingIn, heightIn: v.heightIn as number | undefined, look });
}

/**
 * The definition of a user-made plant. It has no schedule (it sows with no offset and never matures),
 * its height is 0 until the gardener says, and it counts as tolerating partial shade, so the shade
 * rule never warns about it (a tall one still shades its neighbors).
 */
export function makeCustomCrop(fields: { id: string; name: string; spacingIn: number; heightIn?: number; look: CropLook }): CropDef {
  const crop: CropDef = {
    id: fields.id,
    name: fields.name.trim(),
    family: 'custom',
    spacingIn: fields.spacingIn,
    defaultPatch: fields.spacingIn <= 6,
    sowMethod: 'direct-sow',
    directSowWeeksRelativeToLastFrost: 0,
    daysToMaturity: 0,
    heightIn: fields.heightIn ?? 0,
    sunNeed: 'partial',
    look: fields.look,
  };
  return crop;
}

/** Whether a crop has a planting schedule (the built-in ones do; user-made plants don't). */
export const hasSchedule = (crop: CropDef): boolean => crop.look === undefined;
