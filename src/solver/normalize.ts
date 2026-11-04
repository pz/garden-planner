import { findCrop, getCrop, hasSchedule } from '../data/crops';
import { getZone, zoneFirstFrostDate } from '../data/zones';
import { scheduleFor } from '../core/dates';
import { bedOutline } from '../core/layout';
import { shadowDirection } from '../core/shade';
import { asBlock, type Block } from './block';
import { makeGroup, patches } from './groups';
import { bedArea, plantArea, targetCount } from './allocate';
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

/** Hardest crops first: widest spacing, then tallest, then those that need full sun. */
function byDifficulty(a: DemandInfo, b: DemandInfo): number {
  return (
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

  // Allocation: each crop's share of the free area in the beds it may use.
  const totalWeight = live.reduce((s, d) => s + d.weight, 0);
  const demands: DemandInfo[] = live.map((d) => {
    let area = 0;
    for (const id of d.bedIds) {
      const bed = beds.get(id)!.bed;
      const taken = fixed.filter((g) => g.bedId === id).reduce((s, g) => s + g.points.length * plantArea(g.spacingIn), 0);
      area += Math.max(0, bedArea(bed) - taken);
    }
    return { ...d, target: targetCount(area, fillRatio, d.weight, totalWeight, d.crop.spacingIn, d.min, d.max) };
  });
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
    shadowDir: shadowDirection(plan.northDeg ?? 0, plan.profile.location?.lat),
    maxSpacingIn: Math.max(3, ...crops.map((id) => findCrop(id)?.spacingIn ?? 0)),
  };
}

