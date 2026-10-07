import { CROPS } from '../data/crops';
import { isValidBed } from './reducer';

/**
 * Why a plan was rejected, as a stable machine-readable code. `unknown_crop` and `unknown_bed`
 * name a dangling reference; everything else about a malformed document is `invalid_garden_file`.
 */
export type PlanProblemCode = 'invalid_garden_file' | 'unknown_crop' | 'unknown_bed';

export interface PlanProblem {
  code: PlanProblemCode;
  /** JSON pointer into the plan, e.g. `/plants/2/cropId`. */
  path: string;
  /** Human-readable, lower-case sentence fragment ("plant 3 has an unknown crop (kale2)"). */
  message: string;
}

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

const problem = (code: PlanProblemCode, path: string, message: string): PlanProblem => ({ code, path, message });

/** Why a plan's beds can't be used, or null. Handles both the current multi-bed layout and legacy single-bed (v2) plans. */
function bedsProblem(plan: Record<string, unknown>): PlanProblem | null {
  if (plan.version === 2) {
    const bed = plan.bed;
    if (!isRecord(bed) || !isPositive(bed.widthIn) || !isPositive(bed.heightIn) || typeof bed.name !== 'string') {
      return problem('invalid_garden_file', '/bed', 'the garden bed is missing or has an invalid size');
    }
    return null;
  }
  if (!Array.isArray(plan.beds)) return problem('invalid_garden_file', '/beds', 'the garden has no beds');
  for (const [i, b] of plan.beds.entries()) {
    if (!isValidBed(b)) return problem('invalid_garden_file', `/beds/${i}`, `bed ${i + 1} is invalid`);
  }
  const ids = plan.beds.map((b: { id: string }) => b.id);
  if (new Set(ids).size !== ids.length) return problem('invalid_garden_file', '/beds', 'two beds share the same id');
  return null;
}

/** The first thing wrong with one plant, or null. `bedIds` is null for legacy v2 plants, which have no bedId. */
function plantProblem(p: unknown, i: number, bedIds: Set<string> | null, cropIds: Set<string>): PlanProblem | null {
  const at = `/plants/${i}`;
  if (!isRecord(p) || typeof p.id !== 'string' || typeof p.groupId !== 'string') {
    return problem('invalid_garden_file', at, `plant ${i + 1} is malformed`);
  }
  if (bedIds && (typeof p.bedId !== 'string' || !bedIds.has(p.bedId))) {
    return problem('unknown_bed', `${at}/bedId`, `plant ${i + 1} is in a bed that doesn't exist`);
  }
  if (typeof p.cropId !== 'string' || !cropIds.has(p.cropId)) {
    return problem('unknown_crop', `${at}/cropId`, `plant ${i + 1} has an unknown crop (${String(p.cropId)})`);
  }
  if (typeof p.x !== 'number' || typeof p.y !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
    return problem('invalid_garden_file', at, `plant ${i + 1} has an invalid position`);
  }
  return null;
}

/**
 * Everything wrong with an untrusted plan (an imported file, or anything crossing the API
 * boundary), in the order a reader would hit it; empty if it's usable. Document-level problems
 * (version, profile, beds) stop the check, since plants can't be judged without valid beds;
 * after that every bad plant is reported, one problem each. Accepts v3 plans and legacy v2
 * (single-bed) plans, which `parsePlan` migrates.
 */
export function validatePlan(plan: unknown): PlanProblem[] {
  if (!isRecord(plan)) return [problem('invalid_garden_file', '', 'the file has no garden in it')];
  if (plan.version !== 2 && plan.version !== 3) {
    return [problem('invalid_garden_file', '/version', `unsupported garden version (${String(plan.version)})`)];
  }
  if (!isRecord(plan.profile)) return [problem('invalid_garden_file', '/profile', 'the garden has no profile')];
  if (plan.version === 3 && typeof plan.name !== 'string') {
    return [problem('invalid_garden_file', '/name', 'the garden has no name')];
  }
  const beds = bedsProblem(plan);
  if (beds) return [beds];
  if (!Array.isArray(plan.plants)) return [problem('invalid_garden_file', '/plants', 'the garden has no plant list')];

  const problems: PlanProblem[] = [];
  const cropIds = new Set(CROPS.map((c) => c.id));
  const bedIds = plan.version === 3 ? new Set((plan.beds as { id: string }[]).map((b) => b.id)) : null;
  for (const [i, p] of plan.plants.entries()) {
    const found = plantProblem(p, i, bedIds, cropIds);
    if (found) problems.push(found);
  }
  if (!Array.isArray(plan.dismissedConflictKeys) || plan.dismissedConflictKeys.some((k) => typeof k !== 'string')) {
    problems.push(problem('invalid_garden_file', '/dismissedConflictKeys', 'the dismissed-warnings list is invalid'));
  }
  return problems;
}
