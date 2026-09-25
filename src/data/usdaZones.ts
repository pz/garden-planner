import { buildZoneIndex, type ZoneFeatureCollection, type ZoneIndex } from '../utils/zoneMap';

/**
 * The bundled USDA zone polygons (`usdaZones.geo.json`, ~80 KB gzipped) are only needed by the
 * setup screen's map, so they're loaded on demand into their own chunk and indexed once.
 */
let pending: Promise<ZoneIndex> | null = null;

export function loadZoneIndex(): Promise<ZoneIndex> {
  pending ??= import('./usdaZones.geo.json').then((mod) => buildZoneIndex(mod.default as ZoneFeatureCollection));
  // Let a failed load (e.g. flaky network fetching the chunk) be retried next time.
  pending.catch(() => {
    pending = null;
  });
  return pending;
}

/** The raw polygons, for drawing the overlay. Shares the chunk with `loadZoneIndex`. */
export async function loadZoneGeoJson(): Promise<ZoneFeatureCollection> {
  return (await import('./usdaZones.geo.json')).default as ZoneFeatureCollection;
}
