import type { Bed, PlantInstance, Point } from '../types';
import { getCrop } from '../data/crops';
import { isInsideOutline } from './geometry';
import { bedOutline, bedToGarden, gardenToBed } from './layout';
import type { Disc, StampItem } from './planting';

// Where plants are in the garden as a whole (one frame for every bed), and where gestures that
// work in that frame (a drag, a stamp) should put them back in a bed's own frame.

/** Half the crop's spacing: the radius of a plant's ring, in inches. */
export function radiusOf(cropId: string): number {
  return getCrop(cropId).spacingIn / 2;
}

/** A plant's center in garden coordinates. */
export function gardenPosition(bed: Bed, plant: Pick<PlantInstance, 'x' | 'y'>): Point {
  return bedToGarden(bed, plant);
}

/** Every plant as a disc in garden coordinates, in the plants' order (which is draw order). */
export function discsOf(plants: PlantInstance[], beds: Bed[], offsetOf?: (id: string) => Point | undefined): Disc[] {
  const byId = new Map(beds.map((b) => [b.id, b]));
  const out: Disc[] = [];
  for (const p of plants) {
    const bed = byId.get(p.bedId);
    if (!bed) continue;
    const g = gardenPosition(bed, p);
    const o = offsetOf?.(p.id);
    out.push({ id: p.id, x: g.x + (o?.x ?? 0), y: g.y + (o?.y ?? 0), r: radiusOf(p.cropId), groupId: p.groupId });
  }
  return out;
}

/** The topmost bed (later beds draw on top) whose shape contains the garden point `p`. */
export function bedAt(beds: Bed[], p: Point): Bed | null {
  for (let i = beds.length - 1; i >= 0; i--) {
    if (isInsideOutline(gardenToBed(beds[i], p), bedOutline(beds[i]))) return beds[i];
  }
  return null;
}

export interface Landing {
  bed: Bed;
  /** In the bed's own frame. */
  local: Point;
}

/** The bed a plant dropped at garden point `p` lands in — `prefer` if it contains `p` — and where in it. Null: no bed there. */
export function landingAt(beds: Bed[], p: Point, prefer?: string): Landing | null {
  const preferred = prefer ? beds.find((b) => b.id === prefer) : undefined;
  const bed = preferred && isInsideOutline(gardenToBed(preferred, p), bedOutline(preferred)) ? preferred : bedAt(beds, p);
  return bed ? { bed, local: gardenToBed(bed, p) } : null;
}

/** One plant's new place: in a bed, at a point in that bed's own frame. */
export interface PlantMove {
  id: string;
  bedId: string;
  x: number;
  y: number;
}

export interface MovePlan {
  moves: PlantMove[];
  /** Plants that would end up outside every bed. Then `moves` is not to be sent. */
  outside: string[];
}

/** The `movePlants` moves for dragging `ids` by `delta` in the garden. */
export function planMove(plants: PlantInstance[], beds: Bed[], ids: string[], delta: Point): MovePlan {
  const byId = new Map(beds.map((b) => [b.id, b]));
  const chosen = new Set(ids);
  const moves: PlantMove[] = [];
  const outside: string[] = [];
  for (const p of plants) {
    if (!chosen.has(p.id)) continue;
    const from = byId.get(p.bedId);
    if (!from) continue;
    const g = gardenPosition(from, p);
    const landing = landingAt(beds, { x: g.x + delta.x, y: g.y + delta.y }, p.bedId);
    if (!landing) outside.push(p.id);
    else moves.push({ id: p.id, bedId: landing.bed.id, x: landing.local.x, y: landing.local.y });
  }
  return { moves, outside };
}

export interface Placement {
  item: StampItem;
  bedId: string;
  /** In the bed's own frame. */
  x: number;
  y: number;
}

/** Where a stamp centered at garden point `at` puts each of its plants; items that fall outside every bed are left out. */
export function planStamp(stamp: StampItem[], beds: Bed[], at: Point): Placement[] {
  const out: Placement[] = [];
  for (const item of stamp) {
    const landing = landingAt(beds, { x: at.x + item.dx, y: at.y + item.dy });
    if (landing) out.push({ item, bedId: landing.bed.id, x: landing.local.x, y: landing.local.y });
  }
  return out;
}
