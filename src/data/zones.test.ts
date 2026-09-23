import { describe, expect, it } from 'vitest';
import { ZONES, getZone, zoneFirstFrostDate, zoneLastFrostDate } from './zones';

describe('getZone', () => {
  it('returns the matching zone by id', () => {
    expect(getZone('6').label).toBe('Zone 6');
  });

  it('falls back to a default zone for an unknown id', () => {
    const fallback = getZone('does-not-exist');
    expect(fallback).toBe(ZONES[3]); // documented fallback: index 3
  });
});

describe('zoneLastFrostDate / zoneFirstFrostDate', () => {
  it('builds a Date from the zone month/day for the given year', () => {
    const zone = getZone('6'); // last frost Apr 15, first frost Oct 15
    expect(zoneLastFrostDate(zone, 2024)).toEqual(new Date(2024, 3, 15));
    expect(zoneFirstFrostDate(zone, 2024)).toEqual(new Date(2024, 9, 15));
  });

  it('produces a last-frost date strictly before the first-frost date for every zone', () => {
    for (const zone of ZONES) {
      expect(zoneLastFrostDate(zone, 2024).getTime()).toBeLessThan(zoneFirstFrostDate(zone, 2024).getTime());
    }
  });
});

describe('ZONES data integrity', () => {
  it('has unique ids that are consecutive whole numbers, coldest first', () => {
    const ids = ZONES.map((z) => Number(z.id));
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id, i) => expect(id).toBe(ids[0] + i));
  });

  it('gives every zone a distinct hex map color', () => {
    for (const z of ZONES) expect(z.mapColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(new Set(ZONES.map((z) => z.mapColor.toLowerCase())).size).toBe(ZONES.length);
  });
});
