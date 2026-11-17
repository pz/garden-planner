import { Evaluator } from './evaluator';
import { candidateBlocks } from './greedy';
import type { Ctx, DemandInfo } from './model';
import type { CropResult, UnmetReason } from './proposal';

/** A crop with at least this share of its target counts as met. */
export const MET_SHARE = 0.9;

/**
 * How many plants of a crop would fit in the given beds if nothing else of the solver's were
 * placed (the fixed plants stay), up to its target (all the callers need is whether it reaches
 * it). Purely physical: it takes the largest block that fits, over and over, ignoring every
 * soft cost, so it says what the beds could hold, not what the search chose to plant.
 */
function capacity(ctx: Ctx, d: DemandInfo, bedIds: string[]): number {
  const alone: Ctx = { ...ctx, demands: [{ ...d, bedIds, min: undefined, max: undefined }] };
  const ev = new Evaluator(alone);
  for (let i = 0; i < 200 && ev.count(d.cropId) < d.target; i++) {
    const cands = candidateBlocks(ev, alone.demands[0], bedIds, d.target - ev.count(d.cropId));
    if (cands.length === 0) break;
    let best = cands[0];
    for (const c of cands) if (c.plants > best.plants) best = c;
    ev.add(best.block);
  }
  return ev.count(d.cropId);
}

/** One CropResult per demand in the spec, in the spec's order. */
export function cropResults(ctx: Ctx, ev: Evaluator): CropResult[] {
  return ctx.spec.demands.map((spec) => {
    const filteredReasons = ctx.filtered.get(spec.cropId);
    if (filteredReasons) return { cropId: spec.cropId, target: 0, placed: 0, status: 'unmet', reasons: filteredReasons };
    const d = ctx.demands.find((x) => x.cropId === spec.cropId)!;
    const placed = ev.count(spec.cropId);
    if (placed >= MET_SHARE * d.target) return { cropId: spec.cropId, target: d.target, placed, status: 'met', reasons: [] };
    const reasons: UnmetReason[] = [];
    const own = capacity(ctx, d, d.bedIds);
    // It would fit alone: either others took the room, or (a full-sun crop in part shade) the sun penalty talked the search out of the last plants.
    if (own >= d.target) reasons.push(ctx.plan.profile.sunExposure === 'part-shade' && d.crop.sunNeed === 'full' ? 'insufficient_sun' : 'outcompeted');
    else {
      const everywhere = spec.bedIds ? capacity(ctx, d, [...ctx.beds.values()].filter((b) => b.inScope).map((b) => b.bed.id)) : own;
      reasons.push(everywhere >= d.target ? 'limited_by_bed_restriction' : 'insufficient_space');
    }
    return { cropId: spec.cropId, target: d.target, placed, status: placed > 0 ? 'partial' : 'unmet', reasons };
  });
}
