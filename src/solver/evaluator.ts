import type { Point } from '../types';
import { getCrop } from '../data/crops';
import { MAX_PATCH_PLANTS, isInsideOutline } from '../core/geometry';
import { blockPlantCount, blockPoints, blockSpacing, type Block } from './block';
import { DiscIndex } from './discIndex';
import { makeGroup } from './groups';
import type { Ctx, DemandInfo, Group } from './model';
import type { ScoreBreakdown } from './proposal';
import { companionWeight, shades } from './pairRules';
import { edgeSpill, requiredGap, spacingPenalty, violatesHardSpacing } from './rules';
import { CHANGE_WEIGHT, CLUSTER_WEIGHT, COMPANION_WEIGHT, SHADE_WEIGHT, SPACING_WEIGHT, SPILL_WEIGHT, SUN_WEIGHT, demandCurve, emptyBreakdown, minMaxPenalty } from './scoring';

/** The raw (unweighted) sums behind the pair and per-plant terms. */
interface Raw {
  spacing: number;
  spill: number;
  /** Plants of shaded patches, summed over shade conflicts. */
  shade: number;
  /** Companion conflicts, weighted by evidence. */
  companion: number;
  /** Full-sun plants in a part-shade garden. */
  sun: number;
}

const zeroRaw = (): Raw => ({ spacing: 0, spill: 0, shade: 0, companion: 0, sun: 0 });

const PREVIEW = '__preview__';

/** Negation that never yields -0, so a term that is not charged prints as 0. */
const neg = (x: number): number => (x === 0 ? 0 : -x);

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
  private readonly demandOf: Map<string, DemandInfo>;
  private readonly insideMemo = new Map<string, Memo<boolean>>();
  private readonly spillMemo = new Map<string, Memo<number>>();
  private readonly raw: Raw = zeroRaw();
  /** Blocks per crop and bed, for the clustering term. */
  private readonly blocksIn = new Map<string, number>();
  private clustering = 0;
  private readonly partShade: boolean;
  /** The existing patches the search may change, by groupId (adjust mode). */
  private readonly originals = new Map<string, Block>();
  /** Plants removed or moved relative to the original patches, summed (see `changeOf`). */
  private change = 0;
  private readonly originalPlants: number;
  private demand = 0;
  private minMax = 0;
  private seq = 0;

  readonly ctx: Ctx;

  constructor(ctx: Ctx) {
    this.ctx = ctx;
    this.partShade = ctx.plan.profile.sunExposure === 'part-shade';
    this.demandOf = new Map(ctx.demands.map((d) => [d.cropId, d]));
    for (const id of ctx.beds.keys()) this.index.set(id, new DiscIndex(ctx.maxSpacingIn));
    for (const g of ctx.fixed) this.insert(g);
    for (const d of ctx.demands) this.counts.set(d.cropId, 0);
    for (const b of ctx.editable) if (b.source !== 'new') this.originals.set(b.source.groupId, b);
    this.originalPlants = ctx.editable.reduce((n, b) => n + blockPlantCount(b), 0);
    // Until a block stands in for an original it counts as removed.
    this.change = this.originalPlants;
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
    const out = zeroRaw();
    const idx = this.index.get(g.bedId)!;
    for (const p of g.points) {
      idx.forEachNear(p.x, p.y, this.ctx.maxSpacingIn, (d, dist) => {
        if (d.group === g.id) return;
        out.spacing += spacingPenalty(dist, requiredGap(g.spacingIn, d.spacingIn));
      });
      out.spill += this.spill(g.bedId, p.x, p.y, g.spacingIn);
    }
    const dir = this.ctx.shadowDir;
    for (const h of this.groups.values()) {
      if (h.id === g.id) continue;
      if (shades(g, h, dir)) out.shade += h.points.length;
      if (shades(h, g, dir)) out.shade += g.points.length;
      out.companion += companionWeight(g, h);
    }
    if (this.partShade && getCrop(g.cropId).sunNeed === 'full') out.sun += g.points.length;
    return out;
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
    const extra = (this.blocksIn.get(`${block.cropId}|${block.bedId}`) ?? 0) > 0 ? 1 : 0;
    const change = this.changePenalty(this.change + this.changeDelta(block)) - this.changePenalty(this.change);
    return after.demand - before.demand - (after.minMax - before.minMax) - this.penalty(c) - this.ctx.prefs.clustering * CLUSTER_WEIGHT * extra - change;
  }

  /**
   * What a block costs relative to the existing patch it stands for, in plants: nothing if it is
   * that patch unchanged, the whole patch if it was moved, resized or taken to another bed. A new
   * block costs nothing, and the patch it is not standing in for is counted as removed.
   */
  private changeDelta(block: Block): number {
    if (block.source === 'new') return 0;
    const o = this.originals.get(block.source.groupId);
    if (!o) return 0;
    const n = blockPlantCount(o);
    const same = block.bedId === o.bedId && block.columns === o.columns && block.rows === o.rows && block.origin.x === o.origin.x && block.origin.y === o.origin.y;
    return (same ? 0 : n) - n;
  }

  private changePenalty(change: number): number {
    return this.originalPlants === 0 ? 0 : this.ctx.prefs.stability * CHANGE_WEIGHT * (change / this.originalPlants);
  }

  /** The weighted cost of a set of raw sums. */
  private penalty(r: Raw): number {
    const p = this.ctx.prefs;
    return p.spacing * SPACING_WEIGHT * r.spacing + SPILL_WEIGHT * r.spill + p.shade * SHADE_WEIGHT * r.shade + p.companions * COMPANION_WEIGHT * r.companion + SUN_WEIGHT * r.sun;
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
    this.addRaw(c, 1);
    this.change += this.changeDelta(block);
    const key = `${block.cropId}|${block.bedId}`;
    const there = this.blocksIn.get(key) ?? 0;
    if (there > 0) this.clustering++;
    this.blocksIn.set(key, there + 1);
    this.setCount(block.cropId, this.count(block.cropId) + blockPlantCount(block));
    return id;
  }

  remove(id: string): Block {
    const block = this.blocks.get(id)!;
    const g = this.uninsert(id);
    this.blocks.delete(id);
    // What it contributed is what it would contribute against everything that is left: pairs with
    // blocks added after it are counted in the same way as pairs with blocks added before.
    this.addRaw(this.contribution(g), -1);
    this.change -= this.changeDelta(block);
    const key = `${block.cropId}|${block.bedId}`;
    const there = this.blocksIn.get(key)!;
    if (there > 1) this.clustering--;
    this.blocksIn.set(key, there - 1);
    this.setCount(block.cropId, this.count(block.cropId) - blockPlantCount(block));
    return block;
  }

  private addRaw(r: Raw, sign: 1 | -1): void {
    this.raw.spacing += sign * r.spacing;
    this.raw.spill += sign * r.spill;
    this.raw.shade += sign * r.shade;
    this.raw.companion += sign * r.companion;
    this.raw.sun += sign * r.sun;
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
    b.minMax = neg(this.minMax);
    const p = this.ctx.prefs;
    b.spacing = neg(p.spacing * SPACING_WEIGHT * this.raw.spacing);
    b.spill = neg(SPILL_WEIGHT * this.raw.spill);
    b.shade = neg(p.shade * SHADE_WEIGHT * this.raw.shade);
    b.companion = neg(p.companions * COMPANION_WEIGHT * this.raw.companion);
    b.clustering = neg(p.clustering * CLUSTER_WEIGHT * this.clustering);
    b.sun = neg(SUN_WEIGHT * this.raw.sun);
    b.change = neg(this.changePenalty(this.change));
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
