import { describe, expect, it } from 'vitest';
import { loadZoneGeoJson, loadZoneIndex } from './usdaZones';

describe('loadZoneIndex', () => {
  it('indexes the bundled polygons once and reuses the result', async () => {
    const first = loadZoneIndex();
    expect(loadZoneIndex()).toBe(first);
    const index = await first;
    expect(index.polygons.length).toBeGreaterThan(0);
  });
});

describe('loadZoneGeoJson', () => {
  it('returns one feature per whole zone, each tagged with a zone id', async () => {
    const collection = await loadZoneGeoJson();
    const zones = collection.features.map((f) => f.properties.zone);
    expect(new Set(zones).size).toBe(zones.length);
    for (const z of zones) expect(z).toMatch(/^\d+$/);
  });
});
