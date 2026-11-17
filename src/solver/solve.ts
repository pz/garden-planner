import type { Command } from '../api/commands';
import type { GardenPlan } from '../types';
import { mulberry32 } from '../core/random';
import { emitCommands } from './emit';
import { Evaluator } from './evaluator';
import { anneal } from './anneal';
import { construct } from './greedy';
import { normalize } from './normalize';
import { DEFAULT_ITERATIONS, type Proposal, type SolveOptions } from './proposal';
import { cropResults } from './results';
import type { PlantingSpec } from './spec';
import { verify } from './verify';

export const DEFAULT_SEED = 1;

/** Ids that don't collide with anything in the plan: `sv1`, `sv2`, … */
function counterIds(plan: GardenPlan): () => string {
  const used = new Set<string>([...plan.plants.flatMap((p) => [p.id, p.groupId]), ...plan.beds.map((b) => b.id)]);
  let n = 0;
  return () => {
    let id: string;
    do id = `sv${++n}`;
    while (used.has(id));
    return id;
  };
}

/**
 * Turns a spec and a plan into commands. Pure, synchronous and headless: the same inputs and seed
 * give the same output. The plan is never changed; the commands are checked with a dry run of
 * `applyCommands`, and anything that fails that check is returned in `hardViolations`.
 * `spec` must already have passed `parseSpec` against `plan`.
 */
export function solve(plan: GardenPlan, spec: PlantingSpec, options: SolveOptions = {}): Proposal {
  const seed = options.seed ?? DEFAULT_SEED;
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const ctx = normalize(plan, spec, options.year ?? new Date().getFullYear());
  const rng = mulberry32(seed);
  const ev = new Evaluator(ctx);

  construct(ev, rng);
  const searched = anneal(ev, rng, iterations, options.trace === true);

  const blocks = ev.placed().map(([, b]) => b);
  const commands: Command[] = emitCommands(blocks);
  const v = verify(plan, commands, options.newId ?? counterIds(plan));
  return {
    commands,
    crops: cropResults(ctx, ev),
    score: ev.breakdown(),
    plan: v.plan,
    introducedWarnings: v.introduced,
    resolvedWarnings: v.resolved,
    hardViolations: v.violations,
    blocks,
    seed,
    iterations,
    ...(options.trace ? { trace: searched.trace } : {}),
  };
}
