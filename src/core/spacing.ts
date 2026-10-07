import type { PlantInstance } from '../types';
import { getCrop } from '../data/crops';
import { clampToOutline, isInsideOutline, type Outline, type Point } from './geometry';

export interface OverlapConflict {
  /** groupIds of the two conflicting entities (a patch or a solo plant), canonically a < b. */
  a: string;
  b: string;
}

/** Canonical, order-independent key for a conflict between two groupIds. */
export function conflictKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

/**
 * Closer than this fraction of the required gap, a placement is refused by the planting UI
 * (see `fitsAt`) and a spacing warning is "problem" rather than "caution" severity.
 */
export const HARD_SPACING_FACTOR = 0.7;

/** Two entities sitting closer than the average of their crops' spacing, with how close. */
export interface SpacingConflict extends OverlapConflict {
  bedId: string;
  /** Distance between the closest pair of members, in inches. */
  distanceIn: number;
  /** The gap those two members' crops want between them (the average of their spacings), in inches. */
  requiredGapIn: number;
  /** Crop ids of the closest pair of members, in the order of `a` and `b`. */
  cropIds: [string, string];
}

/**
 * Pairs of entities (a patch or a solo plant, identified by groupId) that sit closer than
 * either crop's required spacing, each with its closest approach. Warnings live on the entity,
 * not the individual plant, so two members of the same patch never conflict with each other,
 * and one dismissal at the entity level (see conflictKey) resolves the warning on both sides
 * of the pair. Plants in different beds never conflict: their x/y are in different beds'
 * frames, and a bed's edge is where its plants' room to grow ends. Ordered by first discovery.
 */
export function findSpacingConflicts(plants: PlantInstance[]): SpacingConflict[] {
  const byKey = new Map<string, SpacingConflict>();
  for (let i = 0; i < plants.length; i++) {
    for (let j = i + 1; j < plants.length; j++) {
      const p = plants[i];
      const q = plants[j];
      if (p.groupId === q.groupId) continue; // members of the same patch are meant to sit close
      if (p.bedId !== q.bedId) continue;
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Two entities conflict once any pair of their members is closer than the average of their required spacing.
      const requiredGap = (getCrop(p.cropId).spacingIn + getCrop(q.cropId).spacingIn) / 2;
      if (dist >= requiredGap) continue;
      const key = conflictKey(p.groupId, q.groupId);
      const [first, second] = p.groupId < q.groupId ? [p, q] : [q, p];
      const existing = byKey.get(key);
      // Keep the worst (smallest dist / gap) pair of members as the entity's representative.
      if (existing && existing.distanceIn / existing.requiredGapIn <= dist / requiredGap) continue;
      byKey.set(key, {
        a: first.groupId,
        b: second.groupId,
        bedId: p.bedId,
        distanceIn: dist,
        requiredGapIn: requiredGap,
        cropIds: [first.cropId, second.cropId],
      });
    }
  }
  return [...byKey.values()];
}

/** The overlapping pairs alone, without distances; see findSpacingConflicts. */
export function findOverlapConflicts(plants: PlantInstance[]): OverlapConflict[] {
  return findSpacingConflicts(plants).map(({ a, b }) => ({ a, b }));
}

/**
 * Whether a new plant of the given spacing fits at (x, y) without crowding existing plants.
 * Only the plant's own center has to stay inside the bed — its spacing ring (the area it
 * needs to grow) may extend past the edge, e.g. into a path or the yard beyond the bed —
 * though its center must be inside the bed's `outline` (so not out past a rounded corner, an
 * ellipse's curve or a polygon's side). `existing` must be
 * the plants of this same bed; their coordinates are only comparable within one bed.
 */
export function fitsAt(x: number, y: number, spacingIn: number, outline: Outline, existing: PlantInstance[]): boolean {
  if (!isInsideOutline({ x, y }, outline)) return false;
  const r = spacingIn / 2;
  for (const p of existing) {
    const otherR = getCrop(p.cropId).spacingIn / 2;
    const dx = p.x - x;
    const dy = p.y - y;
    if (Math.sqrt(dx * dx + dy * dy) < (r + otherR) * HARD_SPACING_FACTOR) return false;
  }
  return true;
}

/** How far from the original, as a fraction of the crop's spacing, a duplicated plant is placed. */
export const DUPLICATE_OFFSET_FACTOR = 0.8;

/**
 * Where "duplicate" puts a copy of `plant`: just to its right, pulled back inside the bed's
 * `outline` if that would be outside it. Null if a plant there would crowd one of `existing`
 * (the plants of the same bed) the way `fitsAt` refuses.
 */
export function duplicateSpot(plant: PlantInstance, outline: Outline, existing: PlantInstance[]): Point | null {
  const spacing = getCrop(plant.cropId).spacingIn;
  const at = clampToOutline({ x: plant.x + spacing * DUPLICATE_OFFSET_FACTOR, y: plant.y }, outline);
  return fitsAt(at.x, at.y, spacing, outline, existing) ? at : null;
}
