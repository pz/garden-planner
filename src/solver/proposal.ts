import type { Command } from '../api/commands';
import type { ApiError, Warning } from '../api/types';
import type { GardenPlan } from '../types';
import type { Block } from './block';
import type { CropStatus, UnmetReason } from './scenario';

export type { CropStatus, UnmetReason };

export interface SolveOptions {
  /** Seeds every random choice; the same inputs and seed give the same commands. Default 1. */
  seed?: number;
  /** Local-search steps after the greedy start. Default 3000; 0 gives the greedy result alone. */
  iterations?: number;
  /** Makes ids for the dry run (and so for nothing else: the commands carry none). Default: a counter that skips ids in use. */
  newId?: () => string;
  /** Record the score every 50 iterations (for the viewer). */
  trace?: boolean;
  /** The season being planned, for the frost check. Default: this year. */
  year?: number;
}

export const DEFAULT_ITERATIONS = 3000;

export interface CropResult {
  cropId: string;
  /** Plants aimed for, after min and max; 0 for a crop that was filtered out. */
  target: number;
  /** Plants of this crop the solver placed or kept (fixed plants don't count). */
  placed: number;
  /** `met` at 90% of the target or more, `partial` for some, `unmet` for none. */
  status: CropStatus;
  /** Always at least one when the status is not `met`. */
  reasons: UnmetReason[];
}

/** Each term of the objective as its signed contribution to the score (the penalties are negative). */
export interface ScoreBreakdown {
  demand: number;
  minMax: number;
  spacing: number;
  shade: number;
  companion: number;
  clustering: number;
  spill: number;
  change: number;
  sun: number;
  total: number;
}

export interface TracePoint {
  iteration: number;
  score: number;
}

export interface Proposal {
  /** Apply these with `GardenApi.apply`; a stale revision means solve again. */
  commands: Command[];
  crops: CropResult[];
  score: ScoreBreakdown;
  /** The plan after the commands (a dry run). */
  plan: GardenPlan;
  /** Warnings the commands would introduce. Problem-severity spacing ones never appear (see hardViolations). */
  introducedWarnings: Warning[];
  resolvedWarnings: Warning[];
  /** A solver bug if not empty: the commands failed the dry run, or introduced a problem-severity spacing warning. */
  hardViolations: ApiError[];
  /** The final blocks (new and kept). */
  blocks: Block[];
  seed: number;
  iterations: number;
  trace?: TracePoint[];
}
