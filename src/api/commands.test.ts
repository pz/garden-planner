import { describe, expect, it } from 'vitest';
import { parseRequest, restorePlantCommand } from './commands';
import { applyCommands } from './apply';
import { createPlan } from '../core/reducer';

const errorsOf = (raw: unknown) => {
  const r = parseRequest(raw);
  if (r.ok) throw new Error('expected errors');
  return r.errors;
};
const pathsOf = (raw: unknown) => errorsOf(raw).map((e) => e.path);

describe('parseRequest', () => {
  it('accepts every command with its required fields', () => {
    const request = {
      ifRev: 'abc',
      idempotencyKey: 'k1',
      dryRun: true,
      commands: [
        { type: 'addPlant', ref: 'a', bedId: 'b', cropId: 'kale', x: 1, y: 2, id: 'i', groupId: 'g', variety: 'v' },
        { type: 'addPatch', bedId: 'b', cropId: 'carrot', points: [{ x: 1, y: 1 }], clip: true },
        { type: 'addPatch', bedId: 'b', cropId: 'carrot', grid: { origin: { x: 1, y: 1 }, axis: 'y', columns: 2, rows: 3 } },
        { type: 'removePlant', id: 'a' },
        { type: 'removePatch', groupId: 'g' },
        { type: 'movePatch', groupId: 'g', dx: -1.5, dy: 0 },
        { type: 'setVariety', id: 'a', variety: null },
        { type: 'dismissWarning', id: 'spacing:a::b' },
        { type: 'restoreWarning', id: 'spacing:a::b' },
      ],
    };
    expect(parseRequest(request)).toEqual({ ok: true, request });
  });

  it('accepts an empty batch', () => {
    expect(parseRequest({ commands: [] }).ok).toBe(true);
  });

  it('rejects anything that is not an object with a commands array', () => {
    for (const bad of [null, 'x', 3, [], {}, { commands: {} }, { commands: 'x' }]) expect(parseRequest(bad).ok).toBe(false);
  });

  it('reports every problem with a pointer, not just the first', () => {
    expect(pathsOf({
      commands: [
        { type: 'addPlant', bedId: '', cropId: 'kale', x: '3' },
        { type: 'removePlant' },
        { type: 'fly' },
        'nope',
      ],
    })).toEqual(['/commands/0/bedId', '/commands/0/x', '/commands/0/y', '/commands/1/id', '/commands/2/type', '/commands/3']);
  });

  it('rejects unknown fields on the request and on commands, so typos are not silently ignored', () => {
    expect(pathsOf({ commands: [{ type: 'removePlant', id: 'a', idd: 'b' }], dry_run: true })).toEqual(['/dry_run', '/commands/0/idd']);
  });

  it('rejects non-finite and non-numeric coordinates', () => {
    for (const x of [NaN, Infinity, '1', null]) {
      expect(pathsOf({ commands: [{ type: 'addPlant', bedId: 'b', cropId: 'k', x, y: 1 }] })).toEqual(['/commands/0/x']);
    }
  });

  it('requires exactly one of points and grid for a patch', () => {
    const base = { type: 'addPatch', bedId: 'b', cropId: 'carrot' };
    expect(pathsOf({ commands: [base] })).toEqual(['/commands/0']);
    const both = { ...base, points: [{ x: 1, y: 1 }], grid: { origin: { x: 1, y: 1 }, axis: 'x', columns: 1, rows: 1 } };
    expect(pathsOf({ commands: [both] })).toEqual(['/commands/0']);
  });

  it('checks the shape of points and grids down to the field', () => {
    expect(pathsOf({ commands: [{ type: 'addPatch', bedId: 'b', cropId: 'c', points: [{ x: 1, y: 1 }, { x: 'a', y: 2 }] }] })).toEqual(['/commands/0/points/1']);
    expect(pathsOf({ commands: [{ type: 'addPatch', bedId: 'b', cropId: 'c', grid: { origin: { x: 1 }, axis: 'z', columns: 1, rows: 'x', extra: 1 } }] })).toEqual([
      '/commands/0/grid/origin',
      '/commands/0/grid/axis',
      '/commands/0/grid/rows',
      '/commands/0/grid/extra',
    ]);
  });

  it('requires variety to be a string or null (not omitted) for setVariety', () => {
    expect(pathsOf({ commands: [{ type: 'setVariety', id: 'a' }] })).toEqual(['/commands/0/variety']);
    expect(pathsOf({ commands: [{ type: 'setVariety', id: 'a', variety: 3 }] })).toEqual(['/commands/0/variety']);
  });

  it('restricts ref names so they cannot be confused with ids', () => {
    for (const ref of ['', '1a', 'has space', '$x']) {
      expect(pathsOf({ commands: [{ type: 'addPlant', ref, bedId: 'b', cropId: 'k', x: 1, y: 1 }] })).toEqual(['/commands/0/ref']);
    }
  });

  it('gives each error the invalid_command code and a readable message', () => {
    const [e] = errorsOf({ commands: [{ type: 'removePlant' }] });
    expect(e).toMatchObject({ code: 'invalid_command', path: '/commands/0/id' });
    expect(e.message).toContain('required');
  });

  it('treats prototype-ish type names as unknown commands', () => {
    expect(pathsOf({ commands: [{ type: 'constructor' }, { type: '__proto__' }] })).toEqual(['/commands/0/type', '/commands/1/type']);
  });
});

describe('restorePlantCommand', () => {
  const plant = { id: 'p', bedId: 'bed-1', cropId: 'kale', x: 30, y: 12.5, groupId: 'g', variety: 'Lacinato' };

  it('carries everything needed to put the plant back exactly, and is a valid request', () => {
    const command = restorePlantCommand(plant);
    expect(command).toEqual({ type: 'addPlant', ...plant });
    expect(parseRequest({ commands: [command] }).ok).toBe(true);
  });

  it('leaves variety out when the plant has none', () => {
    const { variety: _variety, ...bare } = plant;
    expect(restorePlantCommand(bare)).not.toHaveProperty('variety');
  });

  it('really restores a removed plant: same ids, position and variety', () => {
    const before = { ...createPlan('g'), plants: [plant] };
    let n = 0;
    const newId = () => `x${++n}`;
    const removed = applyCommands(before, [{ type: 'removePlant', id: 'p' }], { newId });
    if (!removed.ok) throw new Error('remove failed');
    const restored = applyCommands(removed.plan, [restorePlantCommand(plant)], { newId });
    expect(restored.ok && restored.plan.plants).toEqual([plant]);
  });
});
