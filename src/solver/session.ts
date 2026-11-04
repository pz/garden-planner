import type { ApiError } from '../api/types';
import type { GardenPlan } from '../types';
import { solve } from './solve';
import type { Proposal, SolveOptions, TracePoint } from './proposal';
import { parseSpec, type PlantingSpec } from './spec';

// What the dev-only viewer does around `solve`, as plain functions so it can be tested in Node.

export type SolveOutcome = { ok: true; spec: PlantingSpec; proposal: Proposal } | { ok: false; errors: ApiError[] };

/** Parses a spec typed into the viewer's editor, checks it against the garden and solves it. */
export function solveFromText(plan: GardenPlan, specText: string, options: SolveOptions): SolveOutcome {
  let raw: unknown;
  try {
    raw = JSON.parse(specText);
  } catch (e) {
    return { ok: false, errors: [{ code: 'invalid_command', path: '', message: `The spec is not valid JSON: ${e instanceof Error ? e.message : String(e)}` }] };
  }
  const parsed = parseSpec(raw, plan);
  if (!parsed.ok) return parsed;
  return { ok: true, spec: parsed.spec, proposal: solve(plan, parsed.spec, options) };
}

/** Ids of the plants in `after` that were not in `before`: what a proposal adds (to outline them). */
export function newPlantIds(before: GardenPlan, after: GardenPlan): Set<string> {
  const had = new Set(before.plants.map((p) => p.id));
  return new Set(after.plants.filter((p) => !had.has(p.id)).map((p) => p.id));
}

/** The points of a polyline for a score trace, scaled to a `width` × `height` box with the best score at the top. Empty for fewer than two points. */
export function tracePoints(trace: TracePoint[], width: number, height: number): string {
  if (trace.length < 2) return '';
  const lo = Math.min(...trace.map((t) => t.score));
  const hi = Math.max(...trace.map((t) => t.score));
  const last = trace[trace.length - 1].iteration || 1;
  const round = (n: number) => Math.round(n * 100) / 100;
  return trace.map((t) => `${round((t.iteration / last) * width)},${round(hi === lo ? height / 2 : height - ((t.score - lo) / (hi - lo)) * height)}`).join(' ');
}
