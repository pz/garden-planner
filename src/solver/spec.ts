import type { GardenPlan } from '../types';
import type { ApiError } from '../api/types';
import { findCrop } from '../data/crops';

// The planting spec: what to plant and what may change, never where. It is the interface the
// planting assistant (an LLM or a form) will produce; the solver turns it into commands.

export type SolveMode = 'fill' | 'adjust' | 'replace';

export const SOLVE_MODES: readonly SolveMode[] = ['fill', 'adjust', 'replace'];

export interface CropDemand {
  cropId: string;
  /** Relative share of planted area (> 0). */
  weight: number;
  /** Plants; soft, heavily penalized. */
  min?: number;
  /** Plants; soft, heavily penalized. */
  max?: number;
  /** Only in these beds (a subset of the scope). */
  bedIds?: string[];
}

/** How much the solver cares about each cost, 0 (ignore) to 1 (as much as it ever does). */
export interface SolvePrefs {
  spacing?: number;
  shade?: number;
  companions?: number;
  clustering?: number;
  /** Adjust mode only: the cost of removing or moving existing plants. */
  stability?: number;
}

export interface PlantingSpec {
  mode: SolveMode;
  demands: CropDemand[];
  /** The beds the solver may plant in. Absent means every bed. Plants outside it are always fixed. */
  scope?: { bedIds?: string[] };
  /** Patches (by groupId) that are never touched, whatever the mode. */
  locked?: string[];
  /** Crops not to plant; in adjust and replace, their existing plants in scope are removed. */
  exclude?: string[];
  /** Share of the free in-scope area to aim to plant, in (0, 1]. */
  fillRatio?: number;
  prefs?: SolvePrefs;
}

export const DEFAULT_FILL_RATIO = 0.85;

/** Every preference's value when the spec leaves it out. First guesses, to be tuned with the sweep. */
export const DEFAULT_PREFS: Readonly<Required<SolvePrefs>> = {
  spacing: 1,
  shade: 1,
  companions: 1,
  clustering: 0.3,
  stability: 0.5,
};

export const PREF_KEYS = Object.keys(DEFAULT_PREFS) as (keyof SolvePrefs)[];

export type ParsedSpec = { ok: true; spec: PlantingSpec } | { ok: false; errors: ApiError[] };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Validates untrusted JSON as a PlantingSpec against a garden. Every problem is reported, each
 * with a JSON pointer into the spec, in the API's error shape; unknown fields are rejected.
 * `invalid_command` is a shape problem, `unknown_crop` / `unknown_bed` / `unknown_id` a name
 * that matches nothing in the garden. Custom crops must already be registered (see `setCustomCrops`).
 */
export function parseSpec(raw: unknown, plan: GardenPlan): ParsedSpec {
  const errors: ApiError[] = [];
  const err = (code: ApiError['code'], path: string, message: string) => errors.push({ code, path, message: `${path || '/'} ${message}` });
  const bad = (path: string, message: string) => err('invalid_command', path, message);

  if (!isRecord(raw)) return { ok: false, errors: [{ code: 'invalid_command', path: '', message: 'The spec must be a JSON object.' }] };
  const known = (o: Record<string, unknown>, keys: readonly string[], at: string) => {
    for (const k of Object.keys(o)) if (!keys.includes(k)) bad(`${at}/${k}`, 'is not a known field');
  };
  known(raw, ['mode', 'demands', 'scope', 'locked', 'exclude', 'fillRatio', 'prefs'], '');

  const bedIds = new Set(plan.beds.map((b) => b.id));
  const groupIds = new Set(plan.plants.map((p) => p.groupId));

  /** A string array at `path`, or undefined (after reporting) if it isn't one. */
  const strings = (v: unknown, path: string): string[] | undefined => {
    if (!Array.isArray(v)) return void bad(path, 'must be an array of strings');
    let ok = true;
    v.forEach((s, i) => {
      if (typeof s !== 'string' || s === '') {
        bad(`${path}/${i}`, 'must be a non-empty string');
        ok = false;
      }
    });
    return ok ? (v as string[]) : undefined;
  };
  const beds = (v: unknown, path: string): string[] | undefined => {
    const ids = strings(v, path);
    ids?.forEach((id, i) => {
      if (!bedIds.has(id)) err('unknown_bed', `${path}/${i}`, `names no bed in this garden ("${id}")`);
    });
    return ids;
  };
  const count = (v: unknown, path: string): number | undefined => {
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v;
    bad(path, 'must be a whole number, 0 or more');
    return undefined;
  };
  const crop = (id: unknown, path: string) => {
    if (typeof id !== 'string' || id === '') return bad(path, 'must be a crop id');
    if (!findCrop(id)) err('unknown_crop', path, `names no crop ("${id}")`);
  };

  if (raw.mode === undefined) bad('/mode', 'is required');
  else if (!SOLVE_MODES.includes(raw.mode as SolveMode)) bad('/mode', `must be one of ${SOLVE_MODES.join(', ')}`);

  // The scope first: demands' bedIds are checked against it.
  let scopeBeds: Set<string> = bedIds;
  if (raw.scope !== undefined) {
    if (!isRecord(raw.scope)) bad('/scope', 'must be an object');
    else {
      known(raw.scope, ['bedIds'], '/scope');
      if (raw.scope.bedIds !== undefined) {
        const ids = beds(raw.scope.bedIds, '/scope/bedIds');
        if (ids) {
          if (ids.length === 0) bad('/scope/bedIds', 'must name at least one bed (leave it out for every bed)');
          else scopeBeds = new Set(ids);
        }
      }
    }
  }

  const excluded = new Set<string>();
  if (raw.exclude !== undefined) {
    const ids = strings(raw.exclude, '/exclude');
    ids?.forEach((id, i) => {
      crop(id, `/exclude/${i}`);
      excluded.add(id);
    });
  }

  if (raw.locked !== undefined) {
    const ids = strings(raw.locked, '/locked');
    ids?.forEach((id, i) => {
      if (!groupIds.has(id)) err('unknown_id', `/locked/${i}`, `names no patch in this garden ("${id}")`);
    });
  }

  if (raw.demands === undefined) bad('/demands', 'is required');
  else if (!Array.isArray(raw.demands)) bad('/demands', 'must be an array of demands');
  else {
    if (raw.demands.length === 0) bad('/demands', 'must have at least one demand');
    const seen = new Set<string>();
    raw.demands.forEach((d, i) => {
      const at = `/demands/${i}`;
      if (!isRecord(d)) return bad(at, 'must be an object');
      known(d, ['cropId', 'weight', 'min', 'max', 'bedIds'], at);
      if (d.cropId === undefined) bad(`${at}/cropId`, 'is required');
      else {
        crop(d.cropId, `${at}/cropId`);
        if (typeof d.cropId === 'string') {
          if (seen.has(d.cropId)) bad(`${at}/cropId`, `repeats an earlier demand for "${d.cropId}"; use one demand per crop`);
          seen.add(d.cropId);
          if (excluded.has(d.cropId) && findCrop(d.cropId)) bad(`${at}/cropId`, `is also in /exclude ("${d.cropId}")`);
        }
      }
      if (d.weight === undefined) bad(`${at}/weight`, 'is required');
      else if (typeof d.weight !== 'number' || !Number.isFinite(d.weight) || d.weight <= 0) bad(`${at}/weight`, 'must be a number above 0');
      const min = d.min === undefined ? undefined : count(d.min, `${at}/min`);
      const max = d.max === undefined ? undefined : count(d.max, `${at}/max`);
      if (min !== undefined && max !== undefined && min > max) bad(`${at}/min`, `(${min}) is more than max (${max})`);
      if (d.bedIds !== undefined) {
        const ids = beds(d.bedIds, `${at}/bedIds`);
        if (ids?.length === 0) bad(`${at}/bedIds`, 'must name at least one bed (leave it out for the whole scope)');
        ids?.forEach((id, j) => {
          if (bedIds.has(id) && !scopeBeds.has(id)) bad(`${at}/bedIds/${j}`, `is outside the scope ("${id}")`);
        });
      }
    });
  }

  if (raw.fillRatio !== undefined && (typeof raw.fillRatio !== 'number' || !(raw.fillRatio > 0 && raw.fillRatio <= 1))) {
    bad('/fillRatio', 'must be a number above 0 and at most 1');
  }

  if (raw.prefs !== undefined) {
    if (!isRecord(raw.prefs)) bad('/prefs', 'must be an object');
    else {
      known(raw.prefs, PREF_KEYS, '/prefs');
      for (const k of PREF_KEYS) {
        const v = raw.prefs[k];
        if (v !== undefined && (typeof v !== 'number' || !(v >= 0 && v <= 1))) bad(`/prefs/${k}`, 'must be a number from 0 to 1');
      }
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, spec: raw as unknown as PlantingSpec };
}
