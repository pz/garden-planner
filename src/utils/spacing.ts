import type { PlantInstance } from '../types';
import { getCrop } from '../data/crops';

/** Ids of plants that are too close to another plant (crossing either one's minimum spacing). */
export function findOverlapWarnings(plants: PlantInstance[]): Set<string> {
  const warned = new Set<string>();
  for (let i = 0; i < plants.length; i++) {
    for (let j = i + 1; j < plants.length; j++) {
      const a = plants[i];
      const b = plants[j];
      if (a.groupId === b.groupId) continue; // members of the same patch are meant to sit close
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Two plants conflict once they're closer than the average of their required spacing.
      const requiredGap = (getCrop(a.cropId).spacingIn + getCrop(b.cropId).spacingIn) / 2;
      if (dist < requiredGap) {
        warned.add(a.id);
        warned.add(b.id);
      }
    }
  }
  return warned;
}

/** Whether a new plant of the given spacing fits at (x, y) without crowding existing plants or the bed edge. */
export function fitsAt(
  x: number,
  y: number,
  spacingIn: number,
  bedWidthIn: number,
  bedHeightIn: number,
  existing: PlantInstance[],
): boolean {
  const r = spacingIn / 2;
  if (x - r < 0 || y - r < 0 || x + r > bedWidthIn || y + r > bedHeightIn) return false;
  for (const p of existing) {
    const otherR = getCrop(p.cropId).spacingIn / 2;
    const dx = p.x - x;
    const dy = p.y - y;
    if (Math.sqrt(dx * dx + dy * dy) < (r + otherR) * 0.7) return false;
  }
  return true;
}
