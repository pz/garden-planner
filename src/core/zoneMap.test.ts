import { describe, expect, it } from 'vitest';
import usdaZones from '../data/usdaZones.geo.json';
import { ZONES } from '../data/zones';
import { zoneIdFromLatitude } from './geoZone';
import {
  buildZoneIndex,
  clampZoneId,
  isZoneOverriddenAtLocation,
  nearestZoneIdWithin,
  pointInRing,
  resolveZoneForLocation,
  zoneIdAtPoint,
  type ZoneFeatureCollection,
} from './zoneMap';

// A 10×10 square (lng 0..10, lat 0..10) with a 2×2 hole at lng/lat 4..6.
const square = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
  [0, 0],
];
const hole = [
  [4, 4],
  [6, 4],
  [6, 6],
  [4, 6],
  [4, 4],
];

const synthetic: ZoneFeatureCollection = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { zone: '6' }, geometry: { type: 'Polygon', coordinates: [square, hole] } },
    // Sits exactly in the hole, as a separate zone — like a mountain inside a valley.
    { type: 'Feature', properties: { zone: '4' }, geometry: { type: 'MultiPolygon', coordinates: [[hole]] } },
    // Out-of-range zones, to exercise clamping through the lookup.
    {
      type: 'Feature',
      properties: { zone: '12' },
      geometry: { type: 'Polygon', coordinates: [[[20, 0], [21, 0], [21, 1], [20, 1], [20, 0]]] },
    },
    {
      type: 'Feature',
      properties: { zone: '1' },
      geometry: { type: 'Polygon', coordinates: [[[30, 0], [31, 0], [31, 1], [30, 1], [30, 0]]] },
    },
  ],
};
const syntheticIndex = buildZoneIndex(synthetic);

describe('pointInRing', () => {
  it('finds interior points and rejects exterior ones', () => {
    expect(pointInRing(5, 5, square)).toBe(true);
    expect(pointInRing(-0.01, 5, square)).toBe(false);
    expect(pointInRing(10.01, 5, square)).toBe(false);
  });

  it('counts points just inside each edge as inside', () => {
    expect(pointInRing(0.001, 5, square)).toBe(true);
    expect(pointInRing(9.999, 5, square)).toBe(true);
    expect(pointInRing(5, 0.001, square)).toBe(true);
    expect(pointInRing(5, 9.999, square)).toBe(true);
  });

  it('puts a point on a shared edge in exactly one of the two neighbors', () => {
    const left = [[0, 0], [5, 0], [5, 10], [0, 10], [0, 0]];
    const right = [[5, 0], [10, 0], [10, 10], [5, 10], [5, 0]];
    const hits = [pointInRing(5, 5, left), pointInRing(5, 5, right)].filter(Boolean);
    expect(hits).toHaveLength(1);
  });
});

describe('zoneIdAtPoint', () => {
  it('returns the zone of the containing polygon', () => {
    expect(zoneIdAtPoint(syntheticIndex, 1, 1)).toBe('6'); // (lat, lng)
  });

  it('treats a hole as outside its polygon, so the polygon filling the hole wins', () => {
    expect(zoneIdAtPoint(syntheticIndex, 5, 5)).toBe('4');
    expect(zoneIdAtPoint(syntheticIndex, 3.99, 5)).toBe('6'); // just outside the hole
  });

  it('returns null outside every polygon', () => {
    expect(zoneIdAtPoint(syntheticIndex, 50, 50)).toBeNull();
    // inside the bbox of nothing, but between polygons
    expect(zoneIdAtPoint(syntheticIndex, 0.5, 15)).toBeNull();
  });

  it('clamps mapped zones outside the range the app has frost data for', () => {
    expect(zoneIdAtPoint(syntheticIndex, 0.5, 20.5)).toBe('10');
    expect(zoneIdAtPoint(syntheticIndex, 0.5, 30.5)).toBe('3');
  });
});

describe('nearestZoneIdWithin', () => {
  // The square's right edge is at lng 10; the zone-12 polygon's left edge is at lng 20.
  it('finds the zone whose edge is within the tolerance', () => {
    expect(nearestZoneIdWithin(syntheticIndex, 5, 10.9, 1)).toBe('6');
  });

  it('includes a point exactly at the tolerance but not just beyond it', () => {
    // at lat 0 longitude isn't scaled, so the distance is exactly 1°
    expect(nearestZoneIdWithin(syntheticIndex, 0, 11, 1)).toBe('6');
    expect(nearestZoneIdWithin(syntheticIndex, 0, 11.01, 1)).toBeNull();
  });

  it('picks the closer of two zones', () => {
    expect(nearestZoneIdWithin(syntheticIndex, 0.5, 14, 10)).toBe('6'); // 4° from the square, 6° from zone 12
    expect(nearestZoneIdWithin(syntheticIndex, 0.5, 16, 10)).toBe('10'); // 4° from zone 12 (clamped), 6° from the square
  });

  it('scales longitude by latitude, so the same longitude gap is a shorter distance near the poles', () => {
    const far: ZoneFeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { zone: '5' },
          geometry: { type: 'Polygon', coordinates: [[[0, 59], [10, 59], [10, 61], [0, 61], [0, 59]]] },
        },
      ],
    };
    const index = buildZoneIndex(far);
    // 1.5° of longitude east of the edge at lat 60 is ~0.75° of real distance (cos 60° = 0.5)
    expect(nearestZoneIdWithin(index, 60, 11.5, 1)).toBe('5');
  });
});

describe('clampZoneId', () => {
  it('passes through every zone the app knows about', () => {
    for (const z of ZONES) expect(clampZoneId(z.id)).toBe(z.id);
  });

  it('clamps one past each end of the range', () => {
    expect(clampZoneId('2')).toBe('3');
    expect(clampZoneId('11')).toBe('10');
  });

  it('throws on something that is not a zone number', () => {
    expect(() => clampZoneId('abc')).toThrow();
  });
});

describe('resolveZoneForLocation', () => {
  it('prefers the map when the point is covered', () => {
    expect(resolveZoneForLocation(syntheticIndex, 5, 5)).toEqual({ zoneId: '4', source: 'usda-map' });
  });

  it('uses the nearest mapped zone just outside the map', () => {
    expect(resolveZoneForLocation(syntheticIndex, 5, 10.5)).toEqual({ zoneId: '6', source: 'usda-map-nearby' });
  });

  it('falls back to the latitude estimate outside map coverage', () => {
    expect(resolveZoneForLocation(syntheticIndex, 51.5, -0.12)).toEqual({
      zoneId: zoneIdFromLatitude(51.5),
      source: 'latitude',
    });
  });

  it('falls back to the latitude estimate while the map data has not loaded', () => {
    expect(resolveZoneForLocation(null, 5, 5)).toEqual({ zoneId: zoneIdFromLatitude(5), source: 'latitude' });
  });
});

describe('isZoneOverriddenAtLocation', () => {
  it('is false when the saved zone is the one the pin resolves to', () => {
    expect(isZoneOverriddenAtLocation(syntheticIndex, 5, 5, '4')).toBe(false);
    // including a latitude-fallback zone outside the map
    expect(isZoneOverriddenAtLocation(syntheticIndex, 51.5, -0.12, zoneIdFromLatitude(51.5))).toBe(false);
  });

  it('is true when the saved zone differs from the pin, i.e. was picked by hand', () => {
    expect(isZoneOverriddenAtLocation(syntheticIndex, 5, 5, '6')).toBe(true);
  });
});

describe('bundled USDA zone map', () => {
  const index = buildZoneIndex(usdaZones as ZoneFeatureCollection);

  it('only contains zones that clamp into the app range, and covers every app zone', () => {
    const ids = new Set((usdaZones as ZoneFeatureCollection).features.map((f) => f.properties.zone));
    for (const id of ids) expect(() => clampZoneId(id)).not.toThrow();
    for (const z of ZONES) expect(ids.has(z.id)).toBe(true);
  });

  // Cities chosen well inside a single whole zone on the 2012 USDA map, so simplification of
  // the bundled polygons can't flip them.
  it.each([
    ['Portland, OR', 45.52, -122.68, '8'],
    ['Minneapolis, MN', 44.98, -93.27, '4'],
    ['Phoenix, AZ', 33.45, -112.07, '9'],
    ['Boston, MA', 42.36, -71.06, '6'],
    ['Dallas, TX', 32.78, -96.8, '8'],
    ['Salt Lake City, UT', 40.76, -111.89, '7'],
    ['Bemidji, MN', 47.47, -94.88, '3'],
    ['Miami, FL', 25.76, -80.19, '10'],
  ])('puts %s in zone %s', (_name, lat, lng, zone) => {
    expect(resolveZoneForLocation(index, lat, lng)).toEqual({ zoneId: zone, source: 'usda-map' });
  });

  it('beats the latitude estimate where they disagree (Pacific Northwest is mild for its latitude)', () => {
    expect(zoneIdFromLatitude(47.61)).toBe('3'); // Seattle by latitude alone
    expect(resolveZoneForLocation(index, 47.61, -122.33).zoneId).toBe('8');
  });

  // Thin coastal strips get simplified away in the bundled polygons; the nearby fallback covers them.
  it.each([
    ['Key West, FL', 24.56, -81.78, '10'],
    ['Outer Banks, NC', 35.56, -75.47, '8'],
    ['Provincetown, MA', 42.05, -70.19, '7'],
  ])('still gives %s a USDA zone (%s) via the nearby fallback', (_name, lat, lng, zone) => {
    expect(resolveZoneForLocation(index, lat, lng)).toEqual({ zoneId: zone, source: 'usda-map-nearby' });
  });

  it('has no coverage outside the contiguous US', () => {
    expect(zoneIdAtPoint(index, 21.31, -157.86)).toBeNull(); // Honolulu
    expect(zoneIdAtPoint(index, 51.5, -0.12)).toBeNull(); // London
    expect(zoneIdAtPoint(index, 35, -140)).toBeNull(); // open Pacific
    expect(resolveZoneForLocation(index, 21.31, -157.86).source).toBe('latitude');
    expect(resolveZoneForLocation(index, 51.5, -0.12).source).toBe('latitude');
  });
});
