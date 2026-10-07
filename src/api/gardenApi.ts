import type { GardenPlan } from '../types';
import { reducer, type Action } from '../core/reducer';
import { applyCommands, type ApplyResult } from './apply';
import type { Command } from './commands';
import { revOf } from './rev';
import type { Warning } from './types';
import { computeWarnings } from './warnings';

/** One garden as of one moment. A new object whenever the garden changes, the same object otherwise. */
export interface GardenSnapshot {
  plan: GardenPlan;
  rev: string;
}

export interface ApplyOptions {
  /** Reject with `stale_revision` unless the garden is still at this revision. */
  ifRev?: string;
  /** Report what would happen without changing anything. */
  dryRun?: boolean;
}

/**
 * What the client talks to for one garden. It is shaped like a store, so a UI can bind to it with
 * `useSyncExternalStore` and every edit is a call to `apply` that returns its result at once.
 * The real implementation applies commands locally; a remote one would keep a local replica and
 * sync in the background; tests use `createMockGardenApi`.
 */
export interface GardenApi {
  getSnapshot(): GardenSnapshot;
  subscribe(listener: () => void): () => void;
  /** Applies a batch of planting commands atomically (see `applyCommands`). A rejected batch changes nothing. */
  apply(commands: Command[], options?: ApplyOptions): ApplyResult;
  /** Every warning on the garden as it is now, dismissed ones included (flagged). */
  warnings(): Warning[];
  /**
   * Transitional: edits that aren't planting commands yet (profile, name, beds, layout undo) are
   * still reducer actions. Each of these becomes a command, and this goes away, as the API grows.
   */
  dispatch(action: Action): void;
}

export interface MemoryGardenApiOptions {
  /** Makes ids for new plants and patches. */
  newId: () => string;
  /** Called with the new plan after every change; e.g. to save it. */
  onChange?: (plan: GardenPlan) => void;
}

export interface MemoryGardenApi extends GardenApi {
  /** Swaps in a whole new garden, as when another party's edit arrives: subscribers are told and the rev changes. */
  replace(plan: GardenPlan): void;
}

/** A `GardenApi` that holds the garden in memory and applies commands with the real `applyCommands`. */
export function createMemoryGardenApi(initial: GardenPlan, options: MemoryGardenApiOptions): MemoryGardenApi {
  let snapshot: GardenSnapshot = { plan: initial, rev: revOf(initial) };
  const listeners = new Set<() => void>();

  const set = (plan: GardenPlan) => {
    if (plan === snapshot.plan) return;
    snapshot = { plan, rev: revOf(plan) };
    options.onChange?.(plan);
    for (const l of [...listeners]) l();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    apply(commands, applyOptions = {}) {
      const result = applyCommands(snapshot.plan, commands, { newId: options.newId, ...applyOptions });
      if (result.ok && result.committed) set(result.plan);
      return result;
    },
    warnings: () => computeWarnings(snapshot.plan),
    dispatch: (action) => set(reducer(snapshot.plan, action)),
    replace: set,
  };
}
