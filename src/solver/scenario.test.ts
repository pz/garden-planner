import { describe, expect, it } from 'vitest';
import { parseScenario } from './scenario';

const base = { garden: 'g', spec: 's', expect: [] as unknown[] };
const paths = (raw: unknown) => {
  const r = parseScenario(raw);
  return r.ok ? [] : r.errors.map((e) => e.path);
};

describe('parseScenario', () => {
  it('accepts every expectation kind', () => {
    const r = parseScenario({
      ...base,
      description: 'd',
      options: { seed: 3, iterations: 0 },
      expect: [
        { kind: 'placed', crop: 'tomato', gte: 1, lte: 4 },
        { kind: 'placed', crop: 'tomato', eq: 0 },
        { kind: 'status', crop: 'melon', status: 'unmet', reason: 'season_too_short' },
        { kind: 'introducedWarnings', warningKind: 'spacing', severity: 'problem', max: 0 },
        { kind: 'unchanged', groupIds: ['g'] },
        { kind: 'removed', groupIds: ['g'] },
        { kind: 'inBeds', crop: 'tomato', bedIds: ['a'] },
        { kind: 'score', gte: -5 },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it('fails the load on an unknown expectation kind', () => {
    expect(paths({ ...base, expect: [{ kind: 'placd', crop: 'x', gte: 1 }] })).toEqual(['/expect/0/kind']);
  });

  it('rejects unknown fields at every level, so a typo cannot drop a check', () => {
    expect(paths({ ...base, extra: 1 })).toEqual(['/extra']);
    expect(paths({ ...base, options: { sed: 1 } })).toEqual(['/options/sed']);
    expect(paths({ ...base, expect: [{ kind: 'placed', crop: 'x', gt: 1, gte: 1 }] })).toEqual(['/expect/0/gt']);
  });

  it('requires garden, spec and an expect array', () => {
    expect(paths({})).toEqual(['/garden', '/spec', '/expect']);
    expect(paths(null)).toEqual(['']);
  });

  it('checks each kind’s required fields', () => {
    expect(paths({ ...base, expect: [{ kind: 'placed', crop: 'x' }] })).toEqual(['/expect/0']);
    expect(paths({ ...base, expect: [{ kind: 'status', crop: 'x', status: 'great' }] })).toEqual(['/expect/0/status']);
    expect(paths({ ...base, expect: [{ kind: 'status', crop: 'x', status: 'unmet', reason: 'rain' }] })).toEqual(['/expect/0/reason']);
    expect(paths({ ...base, expect: [{ kind: 'introducedWarnings', warningKind: 'spacing' }] })).toEqual(['/expect/0/max']);
    expect(paths({ ...base, expect: [{ kind: 'unchanged', groupIds: [] }] })).toEqual(['/expect/0/groupIds']);
    expect(paths({ ...base, expect: [{ kind: 'score' }] })).toEqual(['/expect/0/gte']);
  });
});
