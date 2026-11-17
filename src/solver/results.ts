import { mulberry32 } from '../core/random';
import { Evaluator } from './evaluator';
import { construct } from './greedy';
import type { Ctx, DemandInfo } from './model';
import type { CropResult, UnmetReason } from './proposal';

/** A crop with at least this share of its target counts as met. */
export const MET_SHARE = 0.9;

/**
 * How many plants of a crop would fit in the given beds if nothing else of the solver's were
 * placed (the fixed plants stay). A rough capacity: greedy construction for that crop alone, up to its target (all the callers need is whether it reaches it).
 */
function capacity(ctx: Ctx, d: DemandInfo, bedIds: string[]): number {
  const alone: Ctx = { ...ctx, demands: [{ ...d, bedIds, target: d.target, min: undefined, max: undefined }] };
  const ev = new Evaluator(alone);
  construct(ev, mulberry32(0));
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
    if (own >= d.target) reasons.push('outcompeted');
    else {
      const everywhere = spec.bedIds ? capacity(ctx, d, [...ctx.beds.values()].filter((b) => b.inScope).map((b) => b.bed.id)) : own;
      reasons.push(everywhere >= d.target ? 'limited_by_bed_restriction' : 'insufficient_space');
    }
    return { cropId: spec.cropId, target: d.target, placed, status: placed > 0 ? 'partial' : 'unmet', reasons };
  });
}
