import type { Command } from '../api/commands';
import { applyCommands } from '../api/apply';
import type { ApiError, Warning } from '../api/types';
import type { GardenPlan } from '../types';

export interface Verification {
  /** The plan after the commands, or the original when the dry run failed. */
  plan: GardenPlan;
  introduced: Warning[];
  resolved: Warning[];
  /** Errors from the dry run, and one `invalid_command`-coded entry per problem-severity spacing warning the commands introduce. */
  violations: ApiError[];
}

/**
 * Runs the commands through the same validation the UI gets (`applyCommands`, dry run, planting
 * scope). Anything wrong here is a solver bug, so it is reported, not thrown.
 */
export function verify(plan: GardenPlan, commands: Command[], newId: () => string): Verification {
  const r = applyCommands(plan, commands, { newId, dryRun: true, scope: 'planting' });
  if (!r.ok) return { plan, introduced: [], resolved: [], violations: r.errors };
  const violations: ApiError[] = r.warnings.introduced
    .filter((w) => w.kind === 'spacing' && w.severity === 'problem')
    .map((w) => ({ code: 'invalid_command' as const, path: '', message: `The proposal introduces a problem-severity spacing warning: ${w.message}`, details: { warningId: w.id } }));
  return { plan: r.plan, introduced: r.warnings.introduced, resolved: r.warnings.resolved, violations };
}
