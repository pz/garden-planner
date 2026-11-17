import type { Point } from '../types';
import { LATTICE_IN, blockPlantCount, latticeAnchors, type Block } from './block';
import type { Evaluator } from './evaluator';
import type { DemandInfo } from './model';
import type { TracePoint } from './proposal';

/** Starting and ending temperature of the cooling schedule, in score units (a plant is worth about 0.02 to 0.15). */
export const T_START = 0.05;
export const T_END = 0.0005;

/** How often the trace records the score. */
export const TRACE_EVERY = 50;

/** How far a translate move goes, in lattice steps (each way). */
const MAX_STEPS = 4;

type Move = (ev: Evaluator, rng: () => number) => { remove: string[]; add: Block[] } | null;

const pickOf = <T,>(rng: () => number, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
const int = (rng: () => number, lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));

const anchors = new WeakMap<object, Point[]>();
function anchorsOf(ev: Evaluator, bedId: string): Point[] {
  const info = ev.ctx.beds.get(bedId)!;
  let a = anchors.get(info);
  if (!a) anchors.set(info, (a = latticeAnchors(info.outline)));
  return a;
}

const demandOf = (ev: Evaluator, cropId: string): DemandInfo => ev.ctx.demands.find((d) => d.cropId === cropId)!;

function translate(ev: Evaluator, rng: () => number) {
  const placed = ev.placed();
  if (placed.length === 0) return null;
  const [id, b] = pickOf(rng, placed);
  const step = () => int(rng, -MAX_STEPS, MAX_STEPS) * LATTICE_IN;
  const dx = rng() < 0.5 ? step() : 0;
  const dy = rng() < 0.5 ? step() : 0;
  if (dx === 0 && dy === 0) return null;
  return { remove: [id], add: [{ ...b, origin: { x: b.origin.x + dx, y: b.origin.y + dy } }] };
}

function resize(ev: Evaluator, rng: () => number) {
  const placed = ev.placed();
  if (placed.length === 0) return null;
  const [id, b] = pickOf(rng, placed);
  const grow = rng() < 0.5;
  const byColumn = rng() < 0.5;
  const delta = grow ? 1 : -1;
  const next = { ...b, columns: b.columns + (byColumn ? delta : 0), rows: b.rows + (byColumn ? 0 : delta) };
  if (next.columns < 1 || next.rows < 1) return null;
  return { remove: [id], add: [next] };
}

function swap(ev: Evaluator, rng: () => number) {
  const placed = ev.placed();
  if (placed.length < 2) return null;
  const i = int(rng, 0, placed.length - 1);
  let j = int(rng, 0, placed.length - 2);
  if (j >= i) j++;
  const [ia, a] = placed[i];
  const [ib, b] = placed[j];
  if (a.cropId === b.cropId && a.bedId === b.bedId) return null;
  const allowed = (blk: Block, bedId: string) => demandOf(ev, blk.cropId).bedIds.includes(bedId);
  if (!allowed(a, b.bedId) || !allowed(b, a.bedId)) return null;
  return { remove: [ia, ib], add: [{ ...a, bedId: b.bedId, origin: b.origin }, { ...b, bedId: a.bedId, origin: a.origin }] };
}

function relocate(ev: Evaluator, rng: () => number) {
  const placed = ev.placed();
  if (placed.length === 0) return null;
  const [id, b] = pickOf(rng, placed);
  const beds = demandOf(ev, b.cropId).bedIds;
  const bedId = pickOf(rng, beds);
  const origin = pickOf(rng, anchorsOf(ev, bedId));
  if (bedId === b.bedId && origin.x === b.origin.x && origin.y === b.origin.y) return null;
  return { remove: [id], add: [{ ...b, bedId, origin }] };
}

function remove(ev: Evaluator, rng: () => number) {
  const placed = ev.placed();
  if (placed.length === 0) return null;
  return { remove: [pickOf(rng, placed)[0]], add: [] };
}

/** A new block for the crop furthest below its target, at a random anchor, as large as asked for and as fits. */
function addBlock(ev: Evaluator, rng: () => number) {
  const under = ev.ctx.demands.filter((d) => ev.count(d.cropId) < d.target);
  if (under.length === 0) return null;
  const crop = pickOf(rng, under);
  const remaining = crop.target - ev.count(crop.cropId);
  const bedId = pickOf(rng, crop.bedIds);
  const origin = pickOf(rng, anchorsOf(ev, bedId));
  let columns = int(rng, 1, Math.min(remaining, 6));
  let rows = int(rng, 1, Math.max(1, Math.min(Math.floor(remaining / columns), 6)));
  let block: Block = { bedId, cropId: crop.cropId, origin, axis: 'x', columns, rows, source: 'new' };
  // Shrink until it fits; one plant either fits at this anchor or the move is dropped.
  while (!ev.canPlace(block) && blockPlantCount(block) > 1) {
    if (columns >= rows && columns > 1) columns--;
    else rows--;
    block = { ...block, columns, rows };
  }
  return { remove: [], add: [block] };
}

const MOVES: [number, Move][] = [
  [0.35, translate],
  [0.2, resize],
  [0.1, swap],
  [0.1, relocate],
  [0.1, remove],
  [0.15, addBlock],
];

function chooseMove(rng: () => number): Move {
  let r = rng();
  for (const [w, m] of MOVES) {
    if (r < w) return m;
    r -= w;
  }
  return MOVES[0][1];
}

export interface AnnealResult {
  best: Block[];
  bestScore: number;
  trace: TracePoint[];
}

/**
 * Simulated annealing from the evaluator's current state. Moves that break a hard constraint are
 * rejected before they are scored; the rest are accepted if they raise the score, or with
 * probability exp(delta / T) if they lower it, T cooling geometrically. Remembers the best state
 * seen and leaves the evaluator holding it.
 */
export function anneal(ev: Evaluator, rng: () => number, iterations: number, trace: boolean): AnnealResult {
  const points: TracePoint[] = [];
  let score = ev.score();
  let best = ev.placed().map(([, b]) => b);
  let bestScore = score;
  if (trace) points.push({ iteration: 0, score });
  for (let i = 1; i <= iterations; i++) {
    const t = T_START * Math.pow(T_END / T_START, i / iterations);
    const move = chooseMove(rng)(ev, rng);
    if (move) {
      const removed = move.remove.map((id) => ev.remove(id));
      const added: string[] = [];
      let feasible = true;
      for (const b of move.add) {
        if (!ev.canPlace(b)) {
          feasible = false;
          break;
        }
        added.push(ev.add(b));
      }
      const next = feasible ? ev.score() : -Infinity;
      if (feasible && (next >= score || rng() < Math.exp((next - score) / t))) {
        score = next;
        if (score > bestScore + 1e-12) {
          bestScore = score;
          best = ev.placed().map(([, b]) => b);
        }
      } else {
        for (const id of added) ev.remove(id);
        for (const b of removed) ev.add(b);
      }
    }
    if (trace && i % TRACE_EVERY === 0) points.push({ iteration: i, score });
  }
  // Leave the evaluator in the best state.
  if (ev.score() < bestScore - 1e-12) {
    for (const [id] of ev.placed()) ev.remove(id);
    for (const b of best) ev.add(b);
  }
  return { best, bestScore, trace: points };
}
