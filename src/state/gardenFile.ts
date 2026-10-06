import type { GardenPlan } from '../types';
import { CROPS } from '../data/crops';
import { isValidBed, parsePlan } from './reducer';

/** Identifies the build and moment an export came from, so a bug report can be matched to code. */
export interface GardenFileMeta {
  /** Git commit the exporting build was made from ("unknown" if it wasn't built from a checkout). */
  commit: string;
  /** ISO 8601 timestamp of the export. */
  exportedAt: string;
}

/** The on-disk shape of an exported garden: the plan plus where it came from. */
export interface GardenFile {
  format: 'garden-planner-export';
  formatVersion: 1;
  meta: GardenFileMeta;
  plan: GardenPlan;
}

export type ParsedGardenFile = { ok: true; plan: GardenPlan; meta: GardenFileMeta | null } | { ok: false; error: string };

export function serializeGardenFile(plan: GardenPlan, meta: GardenFileMeta): string {
  const file: GardenFile = { format: 'garden-planner-export', formatVersion: 1, meta, plan };
  return JSON.stringify(file, null, 2);
}

/** A filesystem-safe name like "my-garden-bed-2026-10-06.json". */
export function gardenFileName(plan: GardenPlan, exportedAt: string): string {
  const slug = plan.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'garden';
  return `${slug}-${exportedAt.slice(0, 10)}.json`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

function parseMeta(raw: unknown): GardenFileMeta | null {
  if (!isRecord(raw)) return null;
  const { commit, exportedAt } = raw;
  return typeof commit === 'string' && typeof exportedAt === 'string' ? { commit, exportedAt } : null;
}

/** Why a plan's beds can't be used, or null. Handles both the current multi-bed layout and legacy single-bed (v2) plans. */
function bedsProblem(plan: Record<string, unknown>): string | null {
  if (plan.version === 2) {
    const bed = plan.bed;
    if (!isRecord(bed) || !isPositive(bed.widthIn) || !isPositive(bed.heightIn) || typeof bed.name !== 'string') {
      return 'the garden bed is missing or has an invalid size';
    }
    return null;
  }
  if (!Array.isArray(plan.beds)) return 'the garden has no beds';
  for (const [i, b] of plan.beds.entries()) {
    if (!isValidBed(b)) return `bed ${i + 1} is invalid`;
  }
  const ids = plan.beds.map((b: { id: string }) => b.id);
  if (new Set(ids).size !== ids.length) return 'two beds share the same id';
  return null;
}

/** Returns a description of the first problem with an untrusted plan, or null if it's usable. */
function planProblem(plan: unknown): string | null {
  if (!isRecord(plan)) return 'the file has no garden in it';
  if (plan.version !== 2 && plan.version !== 3) return `unsupported garden version (${String(plan.version)})`;
  if (!isRecord(plan.profile)) return 'the garden has no profile';
  if (plan.version === 3 && typeof plan.name !== 'string') return 'the garden has no name';
  const beds = bedsProblem(plan);
  if (beds) return beds;
  if (!Array.isArray(plan.plants)) return 'the garden has no plant list';
  const cropIds = new Set(CROPS.map((c) => c.id));
  const bedIds = plan.version === 3 ? new Set((plan.beds as { id: string }[]).map((b) => b.id)) : null;
  for (const [i, p] of plan.plants.entries()) {
    if (!isRecord(p) || typeof p.id !== 'string' || typeof p.groupId !== 'string') return `plant ${i + 1} is malformed`;
    if (bedIds && (typeof p.bedId !== 'string' || !bedIds.has(p.bedId))) return `plant ${i + 1} is in a bed that doesn't exist`;
    if (typeof p.cropId !== 'string' || !cropIds.has(p.cropId)) return `plant ${i + 1} has an unknown crop (${String(p.cropId)})`;
    if (typeof p.x !== 'number' || typeof p.y !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      return `plant ${i + 1} has an invalid position`;
    }
  }
  if (!Array.isArray(plan.dismissedConflictKeys) || plan.dismissedConflictKeys.some((k) => typeof k !== 'string')) {
    return 'the dismissed-warnings list is invalid';
  }
  return null;
}

/**
 * Parses an exported garden file. Unlike `parsePlan` (which silently falls back to an empty
 * garden for stored data), this reports why a file was rejected so the user can tell a bad
 * file from an empty garden. Also accepts a bare plan with no wrapper, and legacy single-bed (v2) plans, which `parsePlan` migrates. The returned plan keeps
 * the file's id; callers assign a fresh one before storing it.
 */
export function parseGardenFile(text: string): ParsedGardenFile {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't valid JSON." };
  }
  const wrapper = isRecord(json) && json.format === 'garden-planner-export' ? json : null;
  const candidate = wrapper ? wrapper.plan : json;
  const problem = planProblem(candidate);
  if (problem) return { ok: false, error: `Couldn't load garden: ${problem}.` };
  const id = isRecord(candidate) && typeof candidate.id === 'string' ? candidate.id : '';
  // parsePlan also sanitizes the optional location pin.
  return { ok: true, plan: parsePlan(JSON.stringify(candidate), id), meta: wrapper ? parseMeta(wrapper.meta) : null };
}
