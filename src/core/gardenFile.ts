import type { GardenPlan } from '../types';
import { parsePlan } from './reducer';
import { isRecord, validatePlan } from './validatePlan';

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

function parseMeta(raw: unknown): GardenFileMeta | null {
  if (!isRecord(raw)) return null;
  const { commit, exportedAt } = raw;
  return typeof commit === 'string' && typeof exportedAt === 'string' ? { commit, exportedAt } : null;
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
  const [problem] = validatePlan(candidate);
  if (problem) return { ok: false, error: `Couldn't load garden: ${problem.message}.` };
  const id = isRecord(candidate) && typeof candidate.id === 'string' ? candidate.id : '';
  // parsePlan also sanitizes the optional location pin.
  return { ok: true, plan: parsePlan(JSON.stringify(candidate), id), meta: wrapper ? parseMeta(wrapper.meta) : null };
}
