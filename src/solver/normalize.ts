import { findCrop, getCrop, hasSchedule } from '../data/crops';
import { getZone, zoneFirstFrostDate } from '../data/zones';
import { scheduleFor } from '../core/dates';
import { bedOutline } from '../core/layout';
import { shadowDirection } from '../core/shade';
import { asBlock, blockPoints, minShape, type Block } from './block';
import { makeGroup, patches } from './groups';
import { insetArea, plantArea, targetCount } from './allocate';
import type { Ctx, DemandInfo, Group } from './model';
import { DEFAULT_FILL_RATIO, DEFAULT_PREFS, type PlantingSpec } from './spec';
import type { UnmetReason } from './scenario';

/** Whether a crop can ripen before the first fall frost in the garden's zone (crops without a schedule always can). */
export function fitsSeason(cropId: string, zoneId: string, year: number): boolean {
  const crop = getCrop(cropId);
  if (!hasSchedule(crop)) return true;
  const zone = getZone(zoneId);
  return scheduleFor(crop, zone, year).harvest.getTime() < zoneFirstFrostDate(zone, year).getTime();
}

/** Crops with a minimum count first (they must find their room before it is taken), then the hardest: widest spacing, tallest, needing full sun. */
function byDifficulty(a: DemandInfo, b: DemandInfo): number {
  return (
    Number((b.min ?? 0) > 0) - Number((a.min ?? 0) > 0) ||
    b.crop.spacingIn - a.crop.spacingIn ||
    b.crop.heightIn - a.crop.heightIn ||
    Number(b.crop.sunNeed === 'full') - Number(a.crop.sunNeed === 'full') ||
    (a.cropId < b.cropId ? -1 : 1)
  );
}

/**
 * Resolves a plan and a (valid) spec into what the algorithm reads: which existing plants are
 * fixed, which crops are still in the running after the season and sun filters, and how many
 * plants of each to aim for.
 */
export function normalize(plan: Ctx['plan'], spec: PlantingSpec, year: number): Ctx {
  const prefs = { ...DEFAULT_PREFS, ...spec.prefs };
  const fillRatio = spec.fillRatio ?? DEFAULT_FILL_RATIO;
  const scope = new Set(spec.scope?.bedIds ?? plan.beds.map((b) => b.id));
  const beds: Ctx['beds'] = new Map(plan.beds.map((bed) => [bed.id, { bed, outline: bedOutline(bed), inScope: scope.has(bed.id) }]));

  // Pre-solve filters.
  const filtered = new Map<string, UnmetReason[]>();
  const live: Omit<DemandInfo, 'target'>[] = [];
  for (const d of spec.demands) {
    // A weight of 0 means ignore the crop: it is not planted, and its patches are left as they are.
    if (d.weight === 0) continue;
    const crop = getCrop(d.cropId);
    const reasons: UnmetReason[] = [];
    if (!fitsSeason(d.cropId, plan.profile.zoneId, year)) reasons.push('season_too_short');
    if (plan.profile.sunExposure === 'shade' && crop.sunNeed === 'full') reasons.push('insufficient_sun');
    if (reasons.length) {
      filtered.set(d.cropId, reasons);
      continue;
    }
    const bedIds = (d.bedIds ?? [...scope]).filter((id) => scope.has(id));
    live.push({ cropId: d.cropId, crop, weight: d.weight, min: d.min, max: d.max, bedIds });
  }

  // Existing plants, by patch. Anything outside the scope or locked is fixed, in every mode. In
  // fill mode so is everything else. In replace mode the rest is removed. In adjust mode a patch of
  // an excluded crop is removed, a grid-shaped patch of a demanded crop in a bed it may use becomes
  // a block the search can move, resize or drop, and any other patch stays as it is.
  const excluded = new Set(spec.exclude ?? []);
  const locked = new Set(spec.locked ?? []);
  const fixed: Group[] = [];
  const editable: Block[] = [];
  const removed: string[] = [];
  for (const [groupId, members] of patches(plan.plants)) {
    const { bedId, cropId } = members[0];
    const keep = () => fixed.push(makeGroup(groupId, bedId, cropId, members.map((p) => ({ x: p.x, y: p.y })), beds, true));
    if (spec.mode === 'fill' || !scope.has(bedId) || locked.has(groupId)) keep();
    else if (spec.mode === 'replace' || excluded.has(cropId)) removed.push(groupId);
    else {
      const demand = live.find((d) => d.cropId === cropId);
      const block = demand?.bedIds.includes(bedId) ? asBlock(members) : null;
      if (block) editable.push(block);
      else keep();
    }
  }

  // How far a plant of a crop must stay from a bed's edge.
  const clearanceIn = (cropId: string): number => (typeof spec.edgeClearance === 'number' ? spec.edgeClearance : getCrop(cropId).spacingIn / 2);

  // Allocation: each crop's share of the free area in the beds it may use. A crop whose target is
  // smaller than the smallest group it is grown in (a lone corn plant) is dropped, and the others'
  // shares are worked out again without it; any patch of it the solver could have moved stays put.
  let active = live;
  let demands: DemandInfo[] = [];
  for (;;) {
    const totalWeight = active.reduce((sum, d) => sum + d.weight, 0);
    demands = active.map((d) => {
      // The room the crop's plants may take: the bed with its margin kept clear, beyond the half spacing a growing room needs anyway.
      const inset = Math.max(0, clearanceIn(d.cropId) - d.crop.spacingIn / 2);
      let area = 0;
      for (const id of d.bedIds) {
        const bed = beds.get(id)!.bed;
        const taken = fixed.filter((g) => g.bedId === id).reduce((sum, g) => sum + g.points.length * plantArea(g.spacingIn), 0);
        area += Math.max(0, insetArea(bed, inset) - taken);
      }
      return { ...d, target: targetCount(area, fillRatio, d.weight, totalWeight, d.crop.spacingIn, d.min, d.max) };
    });
    const small = demands.filter((d) => d.target < minShape(d.cropId).plants);
    if (small.length === 0) break;
    for (const d of small) {
      filtered.set(d.cropId, ['below_minimum_group']);
      for (let i = editable.length - 1; i >= 0; i--) {
        const b = editable[i];
        if (b.cropId !== d.cropId || b.source === 'new') continue;
        fixed.push(makeGroup(b.source.groupId, b.bedId, b.cropId, blockPoints(b), beds, true));
        editable.splice(i, 1);
      }
    }
    active = active.filter((d) => !small.some((x) => x.cropId === d.cropId));
  }
  demands.sort(byDifficulty);

  const crops = [...plan.plants.map((p) => p.cropId), ...spec.demands.map((d) => d.cropId)];
  return {
    plan,
    spec,
    mode: spec.mode,
    prefs,
    fillRatio,
    beds,
    demands,
    filtered,
    fixed,
    editable,
    removed,
    clearanceIn,
    shadowDir: shadowDirection(plan.northDeg ?? 0, plan.profile.location?.lat),
    maxSpacingIn: Math.max(3, ...crops.map((id) => findCrop(id)?.spacingIn ?? 0)),
  };
}

