import type { GardenPlan } from '../types';
import type { ApplyResult } from './apply';
import type { Command } from './commands';
import { createMemoryGardenApi, type ApplyOptions, type GardenApi, type MemoryGardenApiOptions } from './gardenApi';
import type { ApiError, Warning } from './types';

/** One call to `apply`, as the client made it. */
export interface RecordedCall {
  commands: Command[];
  options: ApplyOptions;
  /** What it returned (a failure injected with `failNext` shows up here as `ok: false`). */
  result: ApplyResult;
}

/**
 * A `GardenApi` for testing a client without depending on the real command layer's behavior. By
 * default it behaves like the real thing (so a UI works normally against it), but a test can
 * record what the client asked for, make the next call fail, make the garden report particular
 * warnings, or change the garden behind the client's back.
 */
export interface MockGardenApi extends GardenApi {
  /** Every `apply` call so far, oldest first. */
  readonly calls: RecordedCall[];
  /** Make the next `apply` fail with these errors, changing nothing. */
  failNext(errors: ApiError[]): void;
  /** Report exactly these warnings (instead of computing them) until `setWarnings(null)`. */
  setWarnings(warnings: Warning[] | null): void;
  /** Replace the whole garden, as if someone else edited it: subscribers are notified and the rev changes. */
  replacePlan(plan: GardenPlan): void;
}

export function createMockGardenApi(initial: GardenPlan, options: MemoryGardenApiOptions): MockGardenApi {
  const inner = createMemoryGardenApi(initial, options);
  const listeners = new Set<() => void>();
  const calls: RecordedCall[] = [];
  const failures: ApiError[][] = [];
  let warningsOverride: Warning[] | null = null;
  let snapshot = inner.getSnapshot();
  const notify = () => {
    snapshot = inner.getSnapshot();
    for (const l of [...listeners]) l();
  };
  inner.subscribe(notify);

  return {
    calls,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    apply(commands, applyOptions = {}) {
      const injected = failures.shift();
      const result: ApplyResult = injected
        ? { ok: false, errors: injected.map((e) => ({ commandIndex: 0, ...e })) }
        : inner.apply(commands, applyOptions);
      calls.push({ commands, options: applyOptions, result });
      return result;
    },
    warnings: () => warningsOverride ?? inner.warnings(),
    dispatch: (action) => inner.dispatch(action),
    failNext(errors) {
      failures.push(errors);
    },
    setWarnings(warnings) {
      warningsOverride = warnings;
      snapshot = { ...snapshot }; // a new snapshot object, so anything derived from it is recomputed
      for (const l of [...listeners]) l();
    },
    replacePlan: (plan) => inner.replace(plan),
  };
}
