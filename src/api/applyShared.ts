import type { GardenPlan, Point } from '../types';
import type { Action } from '../core/reducer';
import type { CommandType } from './commands';
import type { ApiError } from './types';

/** What one command did, in the order the commands were given. */
export interface CommandResult {
  type: CommandType;
  ref?: string;
  /** Plants the command created. */
  plantIds?: string[];
  /** The patch it created or acted on. */
  groupId?: string;
  /** Plants it removed. */
  removed?: string[];
  /** The bed it created or acted on. */
  bedId?: string;
  /** The line it created or acted on. */
  lineId?: string;
  /** Points `clip` dropped for being outside the bed. */
  skipped?: Point[];
}

export type Ref = { kind: 'plant' | 'patch'; plantIds: string[]; groupId: string } | 'failed';

/** Everything a handler needs, and the one way it reports a problem. */
export interface Ctx {
  plan: GardenPlan;
  at: string;
  newId: () => string;
  refs: Map<string, Ref>;
  report(e: Omit<ApiError, 'commandIndex'>): void;
}

/** A command's outcome: the reducer actions to run, and what to tell the caller. `null`: it failed. */
export type Outcome = { actions: Action[]; result: CommandResult } | null;

export const round = (n: number) => Math.round(n * 100) / 100;
export const fmt = (p: Point) => `(${round(p.x)}, ${round(p.y)})`;
