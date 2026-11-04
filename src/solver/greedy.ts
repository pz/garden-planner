import type { Point } from '../types';
import { latticeAnchors, blockSpacing, type Block } from './block';
import type { Evaluator } from './evaluator';
import type { DemandInfo } from './model';

/** Most blocks greedy construction places for one crop before giving up (a guard, not a target). */
const MAX_BLOCKS_PER_CROP = 200;

/** A candidate must beat this to be added: a block that adds nothing, or costs more than it gains, is left out. */
export const MIN_GAIN = 1e-9;

interface Candidate {
  block: Block;
  plants: number;
  bound: number;
}

const anchorCache = new WeakMap<object, Point[]>();

function anchorsOf(ev: Evaluator, bedId: string): Point[] {
  const info = ev.ctx.beds.get(bedId)!;
  let a = anchorCache.get(info);
  if (!a) anchorCache.set(info, (a = latticeAnchors(info.outline)));
  return a;
}

/**
 * Every block of `crop` worth considering in the given beds: from each lattice anchor, for each
 * width, the tallest block that satisfies the hard constraints (feasibility only shrinks as a
 * block grows, so the tallest is the one to try), cut back to land on `remaining`.
 */
export function candidateBlocks(ev: Evaluator, crop: DemandInfo, bedIds: string[], remaining: number): Candidate[] {
  const s = blockSpacing(crop);
  const out: Candidate[] = [];
  for (const bedId of bedIds) {
    for (const origin of anchorsOf(ev, bedId)) {
      // run[c]: how many cells down column c are free, from the anchor, up to the most worth asking for.
      const run: number[] = [];
      for (let c = 0; c < remaining; c++) {
        const x = origin.x + c * s;
        let r = 0;
        while (r < remaining && ev.pointOk(bedId, crop.cropId, x, origin.y + r * s)) r++;
        if (r === 0) break;
        run.push(r);
      }
      let rows = Infinity;
      for (let k = 1; k <= run.length; k++) {
        rows = Math.min(rows, run[k - 1]);
        // The height that lands on the remaining count: rounded down, or up when that overshoots by at most one plant.
        const heights = new Set([Math.floor(remaining / k)]);
        if (k * Math.ceil(remaining / k) - remaining <= 1) heights.add(Math.ceil(remaining / k));
        for (const h of heights) {
          const r = Math.min(rows, h);
          if (r < 1) continue;
          const block: Block = { bedId, cropId: crop.cropId, origin, axis: 'x', columns: k, rows: r, source: 'new' };
          out.push({ block, plants: k * r, bound: ev.demandGain(crop.cropId, k * r) });
        }
      }
    }
  }
  return out;
}

/**
 * The best block to add for a crop, or null if nothing is worth adding. Candidates are tried best
 * bound first and the search stops once no remaining candidate can beat the best found (every
 * penalty only lowers a score, so the demand gain alone bounds it). Equal scores prefer the
 * block nearest its bed's top-left corner, which packs neatly, then the earlier bed, then the
 * seeded random choice.
 */
export function bestCandidate(ev: Evaluator, crop: DemandInfo, remaining: number, rng: () => number): Block | null {
  const cands = candidateBlocks(ev, crop, crop.bedIds, remaining).sort((a, b) => b.bound - a.bound);
  const bedOrder = new Map([...ev.ctx.beds.keys()].map((id, i) => [id, i]));
  let best: { block: Block; delta: number }[] = [];
  let bestDelta = MIN_GAIN;
  for (const c of cands) {
    if (c.bound < bestDelta - 1e-9) break;
    const delta = ev.previewAdd(c.block);
    if (delta > bestDelta + 1e-9) {
      bestDelta = delta;
      best = [{ block: c.block, delta }];
    } else if (delta >= bestDelta - 1e-9 && delta > MIN_GAIN) {
      best.push({ block: c.block, delta });
    }
  }
  if (best.length === 0) return null;
  const rank = (b: Block) => [bedOrder.get(b.bedId)!, b.origin.x + b.origin.y, b.origin.y];
  best.sort((a, b) => {
    const ra = rank(a.block);
    const rb = rank(b.block);
    return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
  });
  const top = rank(best[0].block);
  const tied = best.filter((b) => rank(b.block).every((v, i) => v === top[i]));
  return tied[Math.floor(rng() * tied.length)].block;
}

/**
 * Places blocks crop by crop (hardest first, the order `ctx.demands` is in) until each reaches its
 * target or nothing worth adding fits.
 */
export function construct(ev: Evaluator, rng: () => number): void {
  for (const crop of ev.ctx.demands) {
    for (let i = 0; i < MAX_BLOCKS_PER_CROP; i++) {
      const remaining = crop.target - ev.count(crop.cropId);
      if (remaining <= 0) break;
      const block = bestCandidate(ev, crop, remaining, rng);
      if (!block) break;
      ev.add(block);
    }
  }
}
