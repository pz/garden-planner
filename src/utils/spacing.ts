import type { PlantInstance } from '../types';
import { getCrop } from '../data/crops';

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
 * Pairs of entities (a patch or a solo plant, identified by groupId) that sit closer than
 * either crop's required spacing. Warnings live on the entity, not the individual plant, so
 * two members of the same patch never conflict with each other, and one dismissal at the
 * entity level (see conflictKey) resolves the warning on both sides of the pair.
 */
export function findOverlapConflicts(plants: PlantInstance[]): OverlapConflict[] {
  const seen = new Set<string>();
  const conflicts: OverlapConflict[] = [];
  for (let i = 0; i < plants.length; i++) {
    for (let j = i + 1; j < plants.length; j++) {
      const p = plants[i];
      const q = plants[j];
      if (p.groupId === q.groupId) continue; // members of the same patch are meant to sit close
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Two entities conflict once any pair of their members is closer than the average of their required spacing.
      const requiredGap = (getCrop(p.cropId).spacingIn + getCrop(q.cropId).spacingIn) / 2;
      if (dist < requiredGap) {
        const key = conflictKey(p.groupId, q.groupId);
        if (!seen.has(key)) {
          seen.add(key);
          conflicts.push(p.groupId < q.groupId ? { a: p.groupId, b: q.groupId } : { a: q.groupId, b: p.groupId });
        }
      }
    }
  }
  return conflicts;
}

/**
 * Whether a new plant of the given spacing fits at (x, y) without crowding existing plants.
 * Only the plant's own center has to stay inside the bed — its spacing ring (the area it
 * needs to grow) may extend past the edge, e.g. into a path or the yard beyond the bed.
 */
export function fitsAt(
  x: number,
  y: number,
  spacingIn: number,
  bedWidthIn: number,
  bedHeightIn: number,
  existing: PlantInstance[],
): boolean {
  if (x < 0 || y < 0 || x > bedWidthIn || y > bedHeightIn) return false;
  const r = spacingIn / 2;
  for (const p of existing) {
    const otherR = getCrop(p.cropId).spacingIn / 2;
    const dx = p.x - x;
    const dy = p.y - y;
    if (Math.sqrt(dx * dx + dy * dy) < (r + otherR) * 0.7) return false;
  }
  return true;
}
