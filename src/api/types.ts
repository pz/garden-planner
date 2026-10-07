import type { PlanProblemCode } from '../core/validatePlan';

export type WarningKind = 'spacing' | 'shade' | 'companion';

/** `problem` is what the planting UI would refuse to place; `caution` is merely not ideal. */
export type WarningSeverity = 'caution' | 'problem';

/**
 * Something about the current plan worth knowing, derived from it (never stored). `id` is stable
 * across calls for the same underlying situation, so callers can track and dismiss it.
 */
export interface Warning {
  id: string;
  kind: WarningKind;
  severity: WarningSeverity;
  bedId: string;
  /** groupIds of the patches or solo plants involved. */
  subjects: string[];
  message: string;
  suggestion?: string;
  /** The user dismissed this one; it stays readable but isn't reported as new. */
  dismissed: boolean;
}

/** What a change did to the (undismissed) warnings. */
export interface WarningDiff {
  introduced: Warning[];
  resolved: Warning[];
  /** Warnings present both before and after. */
  unchanged: number;
}

export type ApiErrorCode =
  | PlanProblemCode
  /** The request isn't a well-formed command batch (wrong shape, unknown command or field). */
  | 'invalid_command'
  /** An id, groupId, `$ref` or warning id names nothing. */
  | 'unknown_id'
  /** A plant center would be outside its bed's shape. */
  | 'outside_bed'
  | 'duplicate_ref'
  /** A client-supplied id or groupId is already taken (or a groupId belongs to a different bed or crop). */
  | 'duplicate_id'
  | 'invalid_grid'
  /** A patch would have no plants (no points, or `clip` dropped them all). */
  | 'empty_patch'
  | 'stale_revision';

/** Why a request was rejected. Stable `code`s are for programs, `message` is for people. */
export interface ApiError {
  code: ApiErrorCode;
  /** JSON pointer into the request (or, for a bad document, into the document). */
  path: string;
  message: string;
  /** Index of the offending command in a batch. */
  commandIndex?: number;
  details?: Record<string, unknown>;
  /** A concrete way to fix it, when there is one. */
  suggestion?: Record<string, unknown>;
}
