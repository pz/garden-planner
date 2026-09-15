import { describe, expect, it } from 'vitest';
import { zoneIdFromLatitude } from './geoZone';

describe('zoneIdFromLatitude', () => {
  it('maps low latitudes to the warmest zone', () => {
    expect(zoneIdFromLatitude(0)).toBe('10');
    expect(zoneIdFromLatitude(10)).toBe('10');
  });

  it('maps high latitudes to the coldest zone', () => {
    expect(zoneIdFromLatitude(60)).toBe('3');
  });

  it('is symmetric across the equator (southern hemisphere)', () => {
    expect(zoneIdFromLatitude(-35)).toBe(zoneIdFromLatitude(35));
  });

  it('resolves each documented band boundary to the narrower (colder) zone', () => {
    expect(zoneIdFromLatitude(23)).toBe('10'); // inclusive of the 10/9 boundary
    expect(zoneIdFromLatitude(23.01)).toBe('9');
    expect(zoneIdFromLatitude(47)).toBe('4');
    expect(zoneIdFromLatitude(47.01)).toBe('3');
  });
});
