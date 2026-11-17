import type { PlantInstance } from '../types';
import { getCrop } from '../data/crops';
import { bedToGarden } from '../core/layout';
import type { Box } from './block';
import type { Ctx, Group } from './model';

export const boxOf = (pts: { x: number; y: number }[]): Box => ({
  x0: Math.min(...pts.map((p) => p.x)),
  y0: Math.min(...pts.map((p) => p.y)),
  x1: Math.max(...pts.map((p) => p.x)),
  y1: Math.max(...pts.map((p) => p.y)),
});

/** A group of plants (one patch) as the solver sees it. */
export function makeGroup(id: string, bedId: string, cropId: string, points: { x: number; y: number }[], bedOf: Ctx['beds'], fixed: boolean): Group {
  const bed = bedOf.get(bedId)!.bed;
  const garden = points.map((p) => bedToGarden(bed, p));
  return { id, bedId, cropId, spacingIn: getCrop(cropId).spacingIn, points, garden, box: boxOf(points), gardenBox: boxOf(garden), fixed };
}

/** Groups the plants of a plan by patch. */
export function patches(plants: PlantInstance[]): Map<string, PlantInstance[]> {
  const out = new Map<string, PlantInstance[]>();
  for (const p of plants) {
    const list = out.get(p.groupId);
    if (list) list.push(p);
    else out.set(p.groupId, [p]);
  }
  return out;
}

