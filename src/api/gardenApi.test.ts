import { describe, expect, it, vi } from 'vitest';
import type { GardenPlan } from '../types';
import { createPlan } from '../core/reducer';
import type { Command } from './commands';
import { createMemoryGardenApi } from './gardenApi';
import { revOf } from './rev';

const make = (initial: GardenPlan = createPlan('g'), onChange?: (p: GardenPlan) => void) => {
  let n = 0;
  return createMemoryGardenApi(initial, { newId: () => `id${++n}`, onChange });
};
const kale: Command = { type: 'addPlant', bedId: 'bed-1', cropId: 'kale', x: 10, y: 10 };

describe('createMemoryGardenApi', () => {
  it('starts with the given garden and its rev', () => {
    const plan = createPlan('g');
    const api = make(plan);
    expect(api.getSnapshot()).toEqual({ plan, rev: revOf(plan) });
  });

  it('hands out the same snapshot object until the garden changes', () => {
    const api = make();
    expect(api.getSnapshot()).toBe(api.getSnapshot());
    const before = api.getSnapshot();
    api.apply([kale]);
    expect(api.getSnapshot()).not.toBe(before);
    expect(api.getSnapshot().plan.plants).toHaveLength(1);
    expect(api.getSnapshot().rev).toBe(revOf(api.getSnapshot().plan));
  });

  it('returns the real result of applying the commands, with ids from newId', () => {
    const r = make().apply([kale]);
    expect(r.ok && r.results).toEqual([{ type: 'addPlant', ref: undefined, plantIds: ['id1'], groupId: 'id2' }]);
  });

  it('notifies subscribers once per committed change, and not after unsubscribing', () => {
    const api = make();
    const listener = vi.fn();
    const off = api.subscribe(listener);
    api.apply([kale]);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    api.apply([kale]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('changes nothing, and tells no one, when a batch is rejected or is a dry run', () => {
    const api = make();
    const listener = vi.fn();
    api.subscribe(listener);
    const before = api.getSnapshot();
    expect(api.apply([{ type: 'removePlant', id: 'ghost' }]).ok).toBe(false);
    const dry = api.apply([kale], { dryRun: true });
    expect(dry.ok && dry.committed).toBe(false);
    expect(api.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('honors ifRev', () => {
    const api = make();
    const rev = api.getSnapshot().rev;
    expect(api.apply([kale], { ifRev: rev }).ok).toBe(true);
    const stale = api.apply([kale], { ifRev: rev });
    expect(stale.ok === false && stale.errors[0].code).toBe('stale_revision');
  });

  it('reports every committed plan through onChange, but not rejected or dry-run ones', () => {
    const onChange = vi.fn();
    const api = make(createPlan('g'), onChange);
    api.apply([{ type: 'removePlant', id: 'ghost' }]);
    api.apply([kale], { dryRun: true });
    expect(onChange).not.toHaveBeenCalled();
    api.apply([kale]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe(api.getSnapshot().plan);
  });

  it('applies reducer actions through dispatch, and ignores one that changes nothing', () => {
    const api = make();
    const listener = vi.fn();
    api.subscribe(listener);
    api.dispatch({ type: 'setGardenName', name: 'Back yard' });
    expect(api.getSnapshot().plan.name).toBe('Back yard');
    expect(listener).toHaveBeenCalledTimes(1);
    api.dispatch({ type: 'dismissConflictsForGroup', groupId: 'nobody' }); // reducer returns the same state
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('computes warnings for the current garden', () => {
    const api = make();
    expect(api.warnings()).toEqual([]);
    api.apply([
      { type: 'addPlant', bedId: 'bed-1', cropId: 'tomato', x: 20, y: 24 },
      { type: 'addPlant', bedId: 'bed-1', cropId: 'tomato', x: 28, y: 24 },
    ]);
    expect(api.warnings()).toHaveLength(1);
  });

  it('replace swaps the garden, changes the rev and notifies', () => {
    const api = make();
    const listener = vi.fn();
    api.subscribe(listener);
    const other = { ...createPlan('g'), name: 'Someone else edited this' };
    api.replace(other);
    expect(api.getSnapshot().plan).toBe(other);
    expect(api.getSnapshot().rev).toBe(revOf(other));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
