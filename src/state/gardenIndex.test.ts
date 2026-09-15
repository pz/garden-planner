import { describe, expect, it } from 'vitest';
import { DEFAULT_INDEX, addGardenId, parseGardenIndex, removeGardenId, setActiveGardenId, type GardenIndex } from './gardenIndex';

describe('parseGardenIndex', () => {
  it('returns the default (empty) index when there is nothing stored', () => {
    expect(parseGardenIndex(null)).toEqual(DEFAULT_INDEX);
  });

  it('returns the default index for malformed JSON instead of throwing', () => {
    expect(parseGardenIndex('{not valid json')).toEqual(DEFAULT_INDEX);
  });

  it('returns the default index when the stored version does not match', () => {
    expect(parseGardenIndex(JSON.stringify({ version: 2, gardenIds: ['a'], activeGardenId: 'a' }))).toEqual(
      DEFAULT_INDEX,
    );
  });

  it('returns the parsed index when it is well-formed and versioned correctly', () => {
    const index: GardenIndex = { version: 1, gardenIds: ['a', 'b'], activeGardenId: 'b' };
    expect(parseGardenIndex(JSON.stringify(index))).toEqual(index);
  });
});

describe('addGardenId', () => {
  it('appends the id and makes it active when the roster was empty', () => {
    const next = addGardenId(DEFAULT_INDEX, 'a');
    expect(next).toEqual({ version: 1, gardenIds: ['a'], activeGardenId: 'a' });
  });

  it('appends the id without changing the active garden when the roster already has one', () => {
    const index: GardenIndex = { version: 1, gardenIds: ['a'], activeGardenId: 'a' };
    const next = addGardenId(index, 'b');
    expect(next).toEqual({ version: 1, gardenIds: ['a', 'b'], activeGardenId: 'a' });
  });

  it('is a no-op when the id is already in the roster', () => {
    const index: GardenIndex = { version: 1, gardenIds: ['a'], activeGardenId: 'a' };
    expect(addGardenId(index, 'a')).toBe(index);
  });
});

describe('removeGardenId', () => {
  it('removes a non-active garden without changing which one is active', () => {
    const index: GardenIndex = { version: 1, gardenIds: ['a', 'b'], activeGardenId: 'a' };
    const next = removeGardenId(index, 'b');
    expect(next).toEqual({ version: 1, gardenIds: ['a'], activeGardenId: 'a' });
  });

  it('falls back to the next remaining garden when the active one is removed', () => {
    const index: GardenIndex = { version: 1, gardenIds: ['a', 'b', 'c'], activeGardenId: 'b' };
    const next = removeGardenId(index, 'b');
    expect(next).toEqual({ version: 1, gardenIds: ['a', 'c'], activeGardenId: 'a' });
  });

  it('sets activeGardenId to null when removing the only remaining garden', () => {
    const index: GardenIndex = { version: 1, gardenIds: ['a'], activeGardenId: 'a' };
    expect(removeGardenId(index, 'a')).toEqual({ version: 1, gardenIds: [], activeGardenId: null });
  });

  it('is a no-op when the id is not in the roster', () => {
    const index: GardenIndex = { version: 1, gardenIds: ['a'], activeGardenId: 'a' };
    expect(removeGardenId(index, 'missing')).toBe(index);
  });
});

describe('setActiveGardenId', () => {
  it('switches to a different garden already in the roster', () => {
    const index: GardenIndex = { version: 1, gardenIds: ['a', 'b'], activeGardenId: 'a' };
    expect(setActiveGardenId(index, 'b')).toEqual({ version: 1, gardenIds: ['a', 'b'], activeGardenId: 'b' });
  });

  it('is a no-op when the id is not in the roster', () => {
    const index: GardenIndex = { version: 1, gardenIds: ['a'], activeGardenId: 'a' };
    expect(setActiveGardenId(index, 'missing')).toBe(index);
  });

  it('is a no-op when the id is already active', () => {
    const index: GardenIndex = { version: 1, gardenIds: ['a'], activeGardenId: 'a' };
    expect(setActiveGardenId(index, 'a')).toBe(index);
  });
});
