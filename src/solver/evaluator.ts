import type { Point } from '../types';
import { MAX_PATCH_PLANTS, isInsideOutline } from '../core/geometry';
import { blockPlantCount, blockPoints, blockSpacing, type Block } from './block';
import { DiscIndex } from './discIndex';
import { makeGroup } from './groups';
import type { Ctx, DemandInfo, Group } from './model';
import type { ScoreBreakdown } from './proposal';
import { edgeSpill, requiredGap, spacingPenalty, violatesHardSpacing } from './rules';
import { SPACING_WEIGHT, SPILL_WEIGHT, demandCurve, emptyBreakdown, minMaxPenalty } from './scoring';

/** The raw (unweighted) sums behind the pair and per-plant terms. */
interface Raw {
  spacing: number;
  spill: number;
}

const PREVIEW = '__preview__';

/** A two-level memo keyed by two numbers, for the outline tests the search repeats at the same few spots. */
class Memo<T> {
  private readonly m = new Map<number, Map<number, T>>();
  get(x: number, y: number, make: () => T): T {
    let row = this.m.get(x);
    if (!row) this.m.set(x, (row = new Map()));
    let v = row.get(y);
    if (v === undefined) row.set(y, (v = make()));
    return v;
  }
}

/**
 * The solver's working state and its objective. It holds the fixed groups and the blocks placed
 * so far in a bucket index per bed, and keeps the score up to date as blocks are added and
 * removed, so a move costs the size of its neighbourhood, not of the garden.
 */
export class Evaluator {
  private readonly index = new Map<string, DiscIndex>();
  private readonly groups = new Map<string, Group>();
  private readonly blocks = new Map<string, Block>();
  private readonly counts = new Map<string, number>();
  private readonly spillOf = new Map<string, number>();
  private readonly demandOf: Map<string, DemandInfo>;
  private readonly insideMemo = new Map<string, Memo<boolean>>();
  private readonly spillMemo = new Map<string, Memo<number>>();
  private readonly raw: Raw = { spacing: 0, spill: 0 };
  private demand = 0;
  private minMax = 0;
  private seq = 0;

  readonly ctx: Ctx;

  constructor(ctx: Ctx) {
    this.ctx = ctx;
    this.demandOf = new Map(ctx.demands.map((d) => [d.cropId, d]));
    for (const id of ctx.beds.keys()) this.index.set(id, new DiscIndex(ctx.maxSpacingIn));
    for (const g of ctx.fixed) this.insert(g);
    for (const d of ctx.demands) this.counts.set(d.cropId, 0);
    this.demand = 0;
    this.minMax = ctx.demands.reduce((s, d) => s + minMaxPenalty(0, d.min, d.max), 0);
  }

  private insert(g: Group): void {
    this.groups.set(g.id, g);
    const idx = this.index.get(g.bedId)!;
    for (const p of g.points) idx.add({ x: p.x, y: p.y, spacingIn: g.spacingIn, group: g.id });
  }

  private uninsert(id: string): Group {
    const g = this.groups.get(id)!;
    this.groups.delete(id);
    this.index.get(g.bedId)!.removeGroup(id);
    return g;
  }

  /** How many plants of a crop the solver has placed (fixed plants don't count). */
  count(cropId: string): number {
    return this.counts.get(cropId) ?? 0;
  }

  /** The blocks placed so far, with the ids to remove them by, in the order they were added. */
  placed(): [string, Block][] {
    return [...this.blocks];
  }

  block(id: string): Block | undefined {
    return this.blocks.get(id);
  }

  /** Whether a plant of `cropId` may sit at (x, y) in the bed: inside its outline and not closer than the hard spacing limit to any plant except those of `ignoreGroup`. */
  pointOk(bedId: string, cropId: string, x: number, y: number, ignoreGroup?: string): boolean {
    if (!this.inside(bedId, x, y)) return false;
    const s = this.spacingOf(cropId);
    let ok = true;
    this.index.get(bedId)!.forEachNear(x, y, this.ctx.maxSpacingIn, (d, dist) => {
      if (ok && d.group !== ignoreGroup && violatesHardSpacing(dist, requiredGap(s, d.spacingIn))) ok = false;
    });
    return ok;
  }

  private inside(bedId: string, x: number, y: number): boolean {
    let memo = this.insideMemo.get(bedId);
    if (!memo) this.insideMemo.set(bedId, (memo = new Memo()));
    return memo.get(x, y, () => isInsideOutline({ x, y }, this.ctx.beds.get(bedId)!.outline));
  }

  /** The edge-spill share of a plant at (x, y) in a bed (memoized: the search asks about the same spots again and again). */
  private spill(bedId: string, x: number, y: number, spacingIn: number): number {
    const key = `${bedId}|${spacingIn}`;
    let memo = this.spillMemo.get(key);
    if (!memo) this.spillMemo.set(key, (memo = new Memo()));
    return memo.get(x, y, () => edgeSpill({ x, y }, spacingIn, this.ctx.beds.get(bedId)!.outline));
  }

  private spacingOf(cropId: string): number {
    return this.demandOf.get(cropId)?.crop.spacingIn ?? blockSpacing({ cropId });
  }

  /** The hard constraints for a whole block: within the plant cap, every center inside the bed, no problem-level crowding. */
  canPlace(block: Block, ignoreGroup?: string): boolean {
    if (blockPlantCount(block) > MAX_PATCH_PLANTS) return false;
    return blockPoints(block).every((p) => this.pointOk(block.bedId, block.cropId, p.x, p.y, ignoreGroup));
  }

  /** The raw sums a group contributes against everything else in the index right now. */
  private contribution(g: Group): Raw {
    let spacing = 0;
    let spill = 0;
    const idx = this.index.get(g.bedId)!;
    for (const p of g.points) {
      idx.forEachNear(p.x, p.y, this.ctx.maxSpacingIn, (d, dist) => {
        if (d.group === g.id) return;
        spacing += spacingPenalty(dist, requiredGap(g.spacingIn, d.spacingIn));
      });
      spill += this.spill(g.bedId, p.x, p.y, g.spacingIn);
    }
    return { spacing, spill };
  }

  private cropValue(cropId: string, n: number): { demand: number; minMax: number } {
    const d = this.demandOf.get(cropId)!;
    return { demand: d.weight * demandCurve(n, d.target), minMax: minMaxPenalty(n, d.min, d.max) };
  }

  /** The score change from adding a block, without adding it. The block need not satisfy the hard constraints. */
  previewAdd(block: Block): number {
    const g = makeGroup(PREVIEW, block.bedId, block.cropId, blockPoints(block), this.ctx.beds, false);
    const c = this.contribution(g);
    const n = this.count(block.cropId);
    const before = this.cropValue(block.cropId, n);
    const after = this.cropValue(block.cropId, n + blockPlantCount(block));
    return after.demand - before.demand - (after.minMax - before.minMax) - this.ctx.prefs.spacing * SPACING_WEIGHT * c.spacing - SPILL_WEIGHT * c.spill;
  }

  /** The best-case gain from adding `plants` plants of a crop: its demand and limits alone, with no penalties. An upper bound on `previewAdd`. */
  demandGain(cropId: string, plants: number): number {
    const n = this.count(cropId);
    const before = this.cropValue(cropId, n);
    const after = this.cropValue(cropId, n + plants);
    return after.demand - before.demand - (after.minMax - before.minMax);
  }

  /** Adds a block (the caller has checked `canPlace`) and returns the id to remove it by. */
  add(block: Block): string {
    const id = `blk${++this.seq}`;
    const g = makeGroup(id, block.bedId, block.cropId, blockPoints(block), this.ctx.beds, false);
    const c = this.contribution(g);
    this.insert(g);
    this.blocks.set(id, block);
    this.raw.spacing += c.spacing;
    this.raw.spill += c.spill;
    this.spillOf.set(id, c.spill);
    this.setCount(block.cropId, this.count(block.cropId) + blockPlantCount(block));
    return id;
  }

  remove(id: string): Block {
    const block = this.blocks.get(id)!;
    const g = this.uninsert(id);
    const c = this.contribution(g);
    this.blocks.delete(id);
    this.raw.spacing -= c.spacing;
    this.raw.spill -= this.spillOf.get(id)!;
    this.spillOf.delete(id);
    this.setCount(block.cropId, this.count(block.cropId) - blockPlantCount(block));
    return block;
  }

  private setCount(cropId: string, n: number): void {
    const before = this.cropValue(cropId, this.count(cropId));
    const after = this.cropValue(cropId, n);
    this.demand += after.demand - before.demand;
    this.minMax += after.minMax - before.minMax;
    this.counts.set(cropId, n);
  }

  /** The score now, term by term. */
  breakdown(): ScoreBreakdown {
    const b = emptyBreakdown();
    b.demand = this.demand;
    b.minMax = -this.minMax;
    b.spacing = -this.ctx.prefs.spacing * SPACING_WEIGHT * this.raw.spacing;
    b.spill = -SPILL_WEIGHT * this.raw.spill;
    b.total = b.demand + b.minMax + b.spacing + b.shade + b.companion + b.clustering + b.spill + b.change + b.sun;
    return b;
  }

  score(): number {
    return this.breakdown().total;
  }

  /** The point list of a placed block in its bed's frame. */
  pointsOf(id: string): Point[] {
    return this.groups.get(id)!.points;
  }
}
