import { describe, expect, it } from 'vitest';
import { MAX_SPACING_IN, lengthHint, readCustomPlant } from './customPlant';

const read = (name: string, spacing: string, height = '') => readCustomPlant({ name, spacing, height });

describe('readCustomPlant', () => {
  it('reads a name and spacing, treating a bare number as inches', () => {
    expect(read('  Rhubarb ', '24')).toEqual({ ok: true, name: 'Rhubarb', spacingIn: 24 });
    expect(read('Rhubarb', "2'")).toEqual({ ok: true, name: 'Rhubarb', spacingIn: 24 });
    expect(read('Rhubarb', '1\' 6"', '3\'')).toEqual({ ok: true, name: 'Rhubarb', spacingIn: 18, heightIn: 36 });
  });

  it('needs a name', () => {
    expect(read('   ', '12')).toEqual({ ok: false, error: 'Give your plant a name.' });
  });

  it('accepts spacing from 1″ to 10′ inclusive and refuses beyond', () => {
    expect(read('x', '1').ok).toBe(true);
    expect(read('x', '0.9').ok).toBe(false);
    expect(read('x', String(MAX_SPACING_IN)).ok).toBe(true);
    expect(read('x', String(MAX_SPACING_IN + 1)).ok).toBe(false);
    expect(read('x', 'wide').ok).toBe(false);
    expect(read('x', '').ok).toBe(false);
  });

  it('treats height as optional, but refuses one it cannot read or that is too tall', () => {
    expect(read('x', '12', '   ')).toEqual({ ok: true, name: 'x', spacingIn: 12 });
    expect(read('x', '12', 'tall')).toMatchObject({ ok: false });
    expect(read('x', '12', '240').ok).toBe(true);
    expect(read('x', '12', '241').ok).toBe(false);
  });
});

describe('lengthHint', () => {
  it('echoes what it understood, nudges when it cannot, and shows the placeholder when empty', () => {
    expect(lengthHint('18', 'apart', 'How far apart', '12″')).toBe('= 1′ 6″ apart');
    expect(lengthHint('lots', 'apart', 'How far apart', '12″')).toBe('Try 12″');
    expect(lengthHint('', 'apart', 'How far apart', '12″')).toBe('How far apart');
  });
});
