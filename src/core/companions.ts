import { CROPS } from '../data/crops';
import type { AvoidNear, PlantInstance } from '../types';
import { conflictKey } from './spacing';

/** Patches closer than this (closest pair of plants, same bed), in inches, count as neighbors for companion rules. */
export const COMPANION_NEAR_IN = 24;

/** A pair of patches of crops that are usually kept apart, and sit close together. */
export interface CompanionConflict {
  /** groupIds, canonically a < b (see `conflictKey`). */
  a: string;
  b: string;
  bedId: string;
  /** The crops, in the order of `a` and `b`. */
  cropIds: [string, string];
  /** Distance between the closest pair of plants, in inches. */
  distanceIn: number;
  reason: string;
  evidence: AvoidNear['evidence'];
}

/** What the data says about keeping two crops apart, if anything (either crop may be the one listing the other). */
export function avoidanceBetween(cropA: string, cropB: string): AvoidNear | undefined {
  if (cropA === cropB) return undefined;
  const listed = (from: string, to: string) => CROPS.find((c) => c.id === from)?.avoidNear?.find((x) => x.cropId === to);
  return listed(cropA, cropB) ?? listed(cropB, cropA);
}

/**
 * Pairs of patches in the same bed whose crops are usually kept apart and whose closest plants
 * are less than `COMPANION_NEAR_IN` apart (exactly that far is not near). Each pair once.
 */
export function findCompanionConflicts(plants: PlantInstance[]): CompanionConflict[] {
  const byKey = new Map<string, CompanionConflict>();
  for (let i = 0; i < plants.length; i++) {
    for (let j = i + 1; j < plants.length; j++) {
      const p = plants[i];
      const q = plants[j];
      if (p.bedId !== q.bedId || p.groupId === q.groupId) continue;
      const avoid = avoidanceBetween(p.cropId, q.cropId);
      if (!avoid) continue;
      const distanceIn = Math.hypot(p.x - q.x, p.y - q.y);
      if (distanceIn >= COMPANION_NEAR_IN) continue;
      const key = conflictKey(p.groupId, q.groupId);
      const existing = byKey.get(key);
      if (existing && existing.distanceIn <= distanceIn) continue;
      const [first, second] = p.groupId < q.groupId ? [p, q] : [q, p];
      byKey.set(key, {
        a: first.groupId,
        b: second.groupId,
        bedId: p.bedId,
        cropIds: [first.cropId, second.cropId],
        distanceIn,
        reason: avoid.reason,
        evidence: avoid.evidence,
      });
    }
  }
  return [...byKey.values()];
}
