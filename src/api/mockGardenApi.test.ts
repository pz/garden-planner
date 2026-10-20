import { describe, expect, it, vi } from 'vitest';
import { createPlan } from '../core/reducer';
import type { Command } from './commands';
import { createMockGardenApi } from './mockGardenApi';
import type { ApiError, Warning } from './types';

const make = () => {
  let n = 0;
  return createMockGardenApi(createPlan('g'), { newId: () => `id${++n}` });
};
const kale: Command = { type: 'addPlant', bedId: 'bed-1', cropId: 'kale', x: 10, y: 10 };
const boom: ApiError = { code: 'outside_bed', path: '/commands/0', message: 'Nope.' };
const warning = (over: Partial<Warning> = {}): Warning => ({
  id: 'spacing:a::b',
  kind: 'spacing',
  severity: 'problem',
  bedId: 'bed-1',
  subjects: ['a', 'b'],
  message: 'Too close.',
  dismissed: false,
  ...over,
});

describe('createMockGardenApi', () => {
  it('behaves like the real thing by default', () => {
    const api = make();
    const r = api.apply([kale]);
    expect(r.ok).toBe(true);
    expect(api.getSnapshot().plan.plants).toHaveLength(1);
  });

  it('records every apply call with its commands, options and result', () => {
    const api = make();
    api.apply([kale], { dryRun: true });
    api.apply([{ type: 'removePlant', id: 'ghost' }]);
    expect(api.calls.map((c) => [c.commands.map((x) => x.type), c.options, c.result.ok])).toEqual([
      [['addPlant'], { dryRun: true }, true],
      [['removePlant'], {}, false],
    ]);
  });

  it('failNext makes exactly the next apply fail with those errors, changing nothing', () => {
    const api = make();
    api.failNext([boom]);
    const before = api.getSnapshot();
    const failed = api.apply([kale]);
    expect(failed).toEqual({ ok: false, errors: [{ commandIndex: 0, ...boom }] });
    expect(api.getSnapshot()).toBe(before);
    expect(api.apply([kale]).ok).toBe(true); // the one after is back to normal
    expect(api.calls).toHaveLength(2);
  });

  it('queues several failNext calls, one per apply, in order', () => {
    const api = make();
    api.failNext([{ ...boom, message: 'first' }]);
    api.failNext([{ ...boom, message: 'second' }]);
    const messages = [api.apply([kale]), api.apply([kale]), api.apply([kale])].map((r) => (r.ok ? 'ok' : r.errors[0].message));
    expect(messages).toEqual(['first', 'second', 'ok']);
  });

  it('setWarnings overrides the computed warnings, notifies, and gives a new snapshot; null restores them', () => {
    const api = make();
    const listener = vi.fn();
    api.subscribe(listener);
    const before = api.getSnapshot();
    api.setWarnings([warning()]);
    expect(api.warnings()).toEqual([warning()]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(api.getSnapshot()).not.toBe(before);
    expect(api.getSnapshot().plan).toBe(before.plan);
    api.setWarnings(null);
    expect(api.warnings()).toEqual([]);
  });

  it('replacePlan changes the garden behind the client: subscribers hear about it and a stale ifRev is rejected', () => {
    const api = make();
    const listener = vi.fn();
    api.subscribe(listener);
    const rev = api.getSnapshot().rev;
    api.replacePlan({ ...createPlan('g'), name: 'Edited elsewhere' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(api.getSnapshot().plan.name).toBe('Edited elsewhere');
    const stale = api.apply([kale], { ifRev: rev });
    expect(stale.ok === false && stale.errors[0].code).toBe('stale_revision');
  });

  it('tells subscribers about changes the client itself makes', () => {
    const api = make();
    const listener = vi.fn();
    api.subscribe(listener);
    api.apply([kale]);
    api.dispatch({ type: 'setGardenName', name: 'x' });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(api.getSnapshot().plan.name).toBe('x');
  });
});
