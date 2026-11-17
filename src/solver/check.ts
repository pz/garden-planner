import type { GardenPlan, PlantInstance } from '../types';
import { solve } from './solve';
import type { LoadedScenario } from './catalog';
import type { Expectation } from './scenario';
import type { Proposal, SolveOptions } from './proposal';

/** Whether `a` and `b` are the same plants (same ids, positions, crop, bed, group), in any order. */
function samePlants(a: PlantInstance[], b: PlantInstance[]): boolean {
  if (a.length !== b.length) return false;
  const key = (p: PlantInstance) => JSON.stringify([p.id, p.bedId, p.cropId, p.x, p.y, p.groupId, p.variety ?? null]);
  const set = new Set(a.map(key));
  return b.every((p) => set.has(key(p)));
}

const inGroup = (plan: GardenPlan, groupId: string) => plan.plants.filter((p) => p.groupId === groupId);

/** What a scenario expects of a proposal, as the problems found (empty when it all holds). */
export function checkExpectations(before: GardenPlan, p: Proposal, expect: Expectation[]): string[] {
  const problems: string[] = [];
  for (const e of expect) {
    const result = (crop: string) => p.crops.find((c) => c.cropId === crop);
    switch (e.kind) {
      case 'placed': {
        const n = result(e.crop)?.placed ?? 0;
        if (e.gte !== undefined && n < e.gte) problems.push(`placed ${e.crop}: ${n}, wanted at least ${e.gte}`);
        if (e.lte !== undefined && n > e.lte) problems.push(`placed ${e.crop}: ${n}, wanted at most ${e.lte}`);
        if (e.eq !== undefined && n !== e.eq) problems.push(`placed ${e.crop}: ${n}, wanted exactly ${e.eq}`);
        break;
      }
      case 'status': {
        const r = result(e.crop);
        if (!r) problems.push(`status ${e.crop}: no result for that crop`);
        else if (r.status !== e.status) problems.push(`status ${e.crop}: ${r.status}, wanted ${e.status}`);
        else if (e.reason && !r.reasons.includes(e.reason)) problems.push(`status ${e.crop}: reasons ${JSON.stringify(r.reasons)} lack ${e.reason}`);
        break;
      }
      case 'introducedWarnings': {
        const n = p.introducedWarnings.filter((w) => w.kind === e.warningKind && (e.severity === undefined || w.severity === e.severity)).length;
        if (n > e.max) problems.push(`introduced ${e.severity ?? ''} ${e.warningKind} warnings: ${n}, wanted at most ${e.max}`);
        break;
      }
      case 'unchanged':
        for (const g of e.groupIds) if (!samePlants(inGroup(before, g), inGroup(p.plan, g))) problems.push(`patch ${g} changed`);
        break;
      case 'removed':
        for (const g of e.groupIds) if (inGroup(p.plan, g).length > 0) problems.push(`patch ${g} is still there`);
        break;
      case 'inBeds':
        for (const b of p.blocks) if (b.cropId === e.crop && !e.bedIds.includes(b.bedId)) problems.push(`${e.crop} placed in ${b.bedId}, wanted only ${e.bedIds.join(', ')}`);
        break;
      case 'score':
        if (p.score.total < e.gte) problems.push(`score ${p.score.total.toFixed(3)}, wanted at least ${e.gte}`);
        break;
    }
  }
  return problems;
}

/**
 * The properties every proposal must have whatever the scenario says. Returns the problems found.
 * `again` is a second run with the same inputs, for the determinism check.
 */
export function checkInvariants(s: Pick<LoadedScenario, 'plan' | 'spec'>, p: Proposal, again: Proposal): string[] {
  const problems: string[] = [];
  if (p.hardViolations.length) problems.push(`hard violations: ${p.hardViolations.map((e) => `${e.code} ${e.path} ${e.message}`).join('; ')}`);

  const spacingCautions = p.introducedWarnings.filter((w) => w.kind === 'spacing' && w.severity === 'caution').length;
  if (spacingCautions > 0 && !(p.score.spacing < 0)) problems.push(`${spacingCautions} caution spacing warnings introduced but the spacing penalty is ${p.score.spacing}`);

  // Fixed and locked plants are untouched: every plant that was there and is not in a patch the commands remove or move is identical.
  const touched = new Set<string>();
  for (const c of p.commands) {
    if (c.type === 'removePatch' || c.type === 'movePatch') touched.add(c.groupId);
    else if (c.type !== 'addPatch') problems.push(`unexpected ${c.type} command`);
  }
  for (const g of new Set(s.plan.plants.map((x) => x.groupId))) {
    if (touched.has(g)) continue;
    if (!samePlants(inGroup(s.plan, g), inGroup(p.plan, g))) problems.push(`patch ${g} changed without a command for it`);
  }
  for (const g of s.spec.locked ?? []) if (touched.has(g)) problems.push(`locked patch ${g} was touched`);
  if (s.spec.mode === 'fill' && p.commands.some((c) => c.type !== 'addPatch')) problems.push('fill mode emitted something other than addPatch');
  const outside = new Set(s.plan.beds.map((b) => b.id).filter((id) => s.spec.scope?.bedIds && !s.spec.scope.bedIds.includes(id)));
  for (const plant of s.plan.plants) if (outside.has(plant.bedId) && !p.plan.plants.some((q) => q.id === plant.id)) problems.push(`plant ${plant.id} outside the scope was removed`);

  if (JSON.stringify(p.commands) !== JSON.stringify(again.commands)) problems.push('the same inputs and seed gave different commands');

  for (const d of s.spec.demands) {
    const r = p.crops.find((c) => c.cropId === d.cropId);
    if (!r) problems.push(`no CropResult for ${d.cropId}`);
    else if (r.status !== 'met' && r.reasons.length === 0) problems.push(`${d.cropId} is ${r.status} with no reason`);
  }
  return problems;
}

/** Solves a scenario twice and checks the invariants and its expectations; returns every problem. */
export function runScenario(s: LoadedScenario, overrides: SolveOptions = {}): { proposal: Proposal; problems: string[] } {
  const options: SolveOptions = { seed: s.options.seed, iterations: s.options.iterations, year: 2026, ...overrides };
  const proposal = solve(s.plan, s.spec, options);
  const again = solve(s.plan, s.spec, options);
  const problems = [...checkInvariants(s, proposal, again), ...checkExpectations(s.plan, proposal, s.expect)];
  return { proposal, problems };
}
