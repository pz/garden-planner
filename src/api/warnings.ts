import { getCrop } from '../data/crops';
import type { GardenPlan } from '../types';
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

/** Every warning on the plan, dismissed ones included (flagged), sorted by id so output is deterministic. */
export function computeWarnings(plan: GardenPlan): Warning[] {
  return [...spacingWarnings(plan)].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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
