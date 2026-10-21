import type { Bed, PlantInstance } from '../types';
import { getCrop } from '../data/crops';
import { extent, type Disc } from './planting';

/** What the inspector says about the selected plants. */
export interface SelectionSummary {
  count: number;
  /** What the selection is: one plant, one whole patch, part of a patch, or several. */
  kind: 'plant' | 'patch' | 'plants';
  /** The crop, when every selected plant is the same one. */
  cropId: string | null;
  /** How many of each crop, most first. */
  crops: { cropId: string; count: number }[];
  /** More than one crop, all of them making up exactly one patch. */
  mixedPatch: boolean;
  /** Inches between plants of the crop; only for a single-crop selection. */
  spacingIn: number | null;
  /** Width and height the selected plants cover, in inches; only for more than one plant. */
  areaIn: { w: number; h: number } | null;
  harvestDays: number | null;
  bedNames: string[];
  /** One plant picked out of a patch of this many. */
  partOfPatch: number | null;
  /** Whether "Group into patch" applies: several plants that aren't already exactly one whole patch, in one bed. */
  canGroup: boolean;
  /** Whether "Ungroup" applies: the selection holds a whole patch of two or more. */
  canUngroup: boolean;
}

/** Null for an empty selection. `discs` are the plants in garden space (for the area they cover). */
export function summarizeSelection(plants: PlantInstance[], beds: Bed[], selected: string[], discs: Disc[]): SelectionSummary | null {
  const chosen = new Set(selected);
  const sel = plants.filter((p) => chosen.has(p.id));
  if (sel.length === 0) return null;

  const counts = new Map<string, number>();
  for (const p of sel) counts.set(p.cropId, (counts.get(p.cropId) ?? 0) + 1);
  const crops = [...counts].map(([cropId, count]) => ({ cropId, count })).sort((a, b) => b.count - a.count);
  const cropId = crops.length === 1 ? crops[0].cropId : null;

  const groupSize = new Map<string, number>();
  for (const p of plants) groupSize.set(p.groupId, (groupSize.get(p.groupId) ?? 0) + 1);
  const groups = [...new Set(sel.map((p) => p.groupId))];
  const wholeGroups = groups.filter((g) => sel.filter((p) => p.groupId === g).length === groupSize.get(g));
  const oneWholePatch = groups.length === 1 && wholeGroups.length === 1;

  const area = sel.length > 1 ? extent(discs.filter((d) => chosen.has(d.id))) : null;
  const bedIds = new Set(sel.map((p) => p.bedId));
  const crop = cropId ? getCrop(cropId) : null;
  return {
    count: sel.length,
    kind: sel.length === 1 ? 'plant' : oneWholePatch ? 'patch' : 'plants',
    cropId,
    crops,
    mixedPatch: oneWholePatch && crops.length > 1,
    spacingIn: crop?.spacingIn ?? null,
    areaIn: area ? { w: area.x1 - area.x0, h: area.y1 - area.y0 } : null,
    harvestDays: crop?.daysToMaturity ?? null,
    bedNames: beds.filter((b) => bedIds.has(b.id)).map((b) => b.name),
    partOfPatch: sel.length === 1 && (groupSize.get(sel[0].groupId) ?? 1) > 1 ? groupSize.get(sel[0].groupId)! : null,
    canGroup: sel.length > 1 && bedIds.size === 1 && !oneWholePatch,
    canUngroup: wholeGroups.some((g) => (groupSize.get(g) ?? 0) > 1),
  };
}
