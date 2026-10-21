import { getCrop } from '../data/crops';
import type { GardenPlan } from '../types';
import { COMPANION_NEAR_IN, findCompanionConflicts } from '../core/companions';
import { SHADE_REACH_FACTOR, findShadeConflicts } from '../core/shade';
import { HARD_SPACING_FACTOR, conflictKey, findSpacingConflicts } from '../core/spacing';
import type { Warning, WarningDiff } from './types';

const round1 = (n: number) => Math.round(n * 10) / 10;

function spacingWarnings(plan: GardenPlan): Warning[] {
  const dismissed = new Set(plan.dismissedConflictKeys);
  return findSpacingConflicts(plan.plants).map((c) => {
    const key = conflictKey(c.a, c.b);
    const [nameA, nameB] = c.cropIds.map((id) => getCrop(id).name);
    return {
      id: `spacing:${key}`,
      kind: 'spacing',
      severity: c.distanceIn < c.requiredGapIn * HARD_SPACING_FACTOR ? 'problem' : 'caution',
      bedId: c.bedId,
      subjects: [c.a, c.b],
      message: `${nameA} and ${nameB} are ${round1(c.distanceIn)} in apart; they want about ${round1(c.requiredGapIn)} in.`,
      suggestion: `Move one of them at least ${Math.ceil(c.requiredGapIn - c.distanceIn)} in further apart.`,
      dismissed: dismissed.has(key),
    };
  });
}

function shadeWarnings(plan: GardenPlan): Warning[] {
  const dismissed = new Set(plan.dismissedWarnings ?? []);
  const bedOf = (groupId: string) => plan.plants.find((p) => p.groupId === groupId)!.bedId;
  const conflicts = findShadeConflicts(plan.plants, plan.beds, plan.northDeg ?? 0, plan.profile.location?.lat);
  return conflicts.map((c) => {
    const caster = getCrop(c.casterCropId);
    const shaded = getCrop(c.shadedCropId);
    const id = `shade:${c.caster}>${c.shaded}`;
    const reach = caster.heightIn * SHADE_REACH_FACTOR;
    return {
      id,
      kind: 'shade',
      severity: 'caution',
      bedId: bedOf(c.shaded),
      subjects: [c.caster, c.shaded],
      message: `${caster.name} (about ${caster.heightIn} in tall) shades ${shaded.name}, which wants full sun, at midday.`,
      suggestion: `Move the ${shaded.name.toLowerCase()} to the sun side of the ${caster.name.toLowerCase()}, or at least ${Math.ceil(reach - c.alongIn + 0.01)} in further along from it.`,
      dismissed: dismissed.has(id),
    };
  });
}

function companionWarnings(plan: GardenPlan): Warning[] {
  const dismissed = new Set(plan.dismissedWarnings ?? []);
  return findCompanionConflicts(plan.plants).map((c) => {
    const [nameA, nameB] = c.cropIds.map((id) => getCrop(id).name);
    const id = `companion:${conflictKey(c.a, c.b)}`;
    const basis = c.evidence === 'anecdotal' ? ' (traditional advice; there is little research behind it)' : '';
    return {
      id,
      kind: 'companion',
      severity: 'caution',
      bedId: c.bedId,
      subjects: [c.a, c.b],
      message: `${nameA} and ${nameB} are ${round1(c.distanceIn)} in apart. ${c.reason}${basis}`,
      suggestion: `Keep them at least ${COMPANION_NEAR_IN} in apart.`,
      dismissed: dismissed.has(id),
    };
  });
}

/** Every warning on the plan, dismissed ones included (flagged), sorted by id so output is deterministic. */
export function computeWarnings(plan: GardenPlan): Warning[] {
  return [...spacingWarnings(plan), ...shadeWarnings(plan), ...companionWarnings(plan)].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * What changed between two warning lists, by id. Dismissed warnings are ignored on both
 * sides: a problem the user already waved off isn't news when it appears, and isn't a win when
 * it goes. A warning that merely changes wording or severity (the same id) is unchanged.
 */
export function diffWarnings(before: Warning[], after: Warning[]): WarningDiff {
  const live = (ws: Warning[]) => new Map(ws.filter((w) => !w.dismissed).map((w) => [w.id, w]));
  const was = live(before);
  const now = live(after);
  return {
    introduced: [...now.values()].filter((w) => !was.has(w.id)),
    resolved: [...was.values()].filter((w) => !now.has(w.id)),
    unchanged: [...now.keys()].filter((id) => was.has(id)).length,
  };
}
