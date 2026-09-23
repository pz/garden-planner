import { ZONES } from '../data/zones';
import { zoneIdFromLatitude } from './geoZone';

/**
 * Point → USDA hardiness zone lookup against the bundled zone polygons
 * (`src/data/usdaZones.geo.json`, contiguous US only). Pure: the GeoJSON is passed in, so the
 * setup screen can lazy-load it while tests import it directly.
 */

type Position = number[]; // [lng, lat]
type Ring = Position[];

export interface ZoneFeatureCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    properties: { zone: string };
    geometry: { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] };
  }[];
}

interface ZonePolygon {
  zoneId: string;
  /** First ring is the outer boundary; any others are holes. */
  rings: Ring[];
  /** [minLng, minLat, maxLng, maxLat] of the outer ring, to skip most polygons cheaply. */
  bbox: [number, number, number, number];
}

export interface ZoneIndex {
  polygons: ZonePolygon[];
}

function ringBbox(ring: Ring): [number, number, number, number] {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLng, minLat, maxLng, maxLat];
}

export function buildZoneIndex(collection: ZoneFeatureCollection): ZoneIndex {
  const polygons: ZonePolygon[] = [];
  for (const feature of collection.features) {
    const zoneId = feature.properties.zone;
    const parts = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const rings of parts) {
      if (rings.length === 0) continue;
      polygons.push({ zoneId, rings, bbox: ringBbox(rings[0]) });
    }
  }
  return { polygons };
}

/**
 * Even-odd ray cast. Uses the half-open rule on each edge's latitude span, so a point exactly on
 * a shared boundary lands in exactly one of the two neighboring polygons (which one is arbitrary).
 */
export function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygon(lng: number, lat: number, polygon: ZonePolygon): boolean {
  const [minLng, minLat, maxLng, maxLat] = polygon.bbox;
  if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) return false;
  if (!pointInRing(lng, lat, polygon.rings[0])) return false;
  for (let h = 1; h < polygon.rings.length; h++) {
    if (pointInRing(lng, lat, polygon.rings[h])) return false;
  }
  return true;
}

/** Clamps a whole-zone id (e.g. "2", "11") into the range the app has frost data for. */
export function clampZoneId(rawZoneId: string): string {
  const n = Number.parseInt(rawZoneId, 10);
  const ids = ZONES.map((z) => Number.parseInt(z.id, 10));
  const min = Math.min(...ids);
  const max = Math.max(...ids);
  if (!Number.isFinite(n)) throw new Error(`Not a zone id: ${rawZoneId}`);
  return String(Math.min(max, Math.max(min, n)));
}

/** The mapped zone containing the point, or `null` if it's outside every polygon (ocean, abroad). */
export function zoneIdAtPoint(index: ZoneIndex, lat: number, lng: number): string | null {
  for (const polygon of index.polygons) {
    if (pointInPolygon(lng, lat, polygon)) return clampZoneId(polygon.zoneId);
  }
  return null;
}

/**
 * How far (in degrees, longitude scaled by cos(latitude)) we'll reach for the nearest mapped zone
 * when a point falls outside every polygon. The bundled map is heavily simplified, so thin
 * coastal strips — barrier islands, the Keys, Cape Cod, river borders — fall just outside it;
 * ~1° (roughly 100 km) catches those without claiming, say, Bermuda.
 */
export const NEARBY_TOLERANCE_DEG = 1;

function distanceToSegmentSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

/**
 * The zone whose boundary passes closest to the point, if within `maxDeg`; `null` otherwise.
 * Distances use an equirectangular approximation, which is plenty at this scale.
 */
export function nearestZoneIdWithin(index: ZoneIndex, lat: number, lng: number, maxDeg: number): string | null {
  const k = Math.cos((lat * Math.PI) / 180); // shrink longitude degrees toward the poles
  const px = lng * k;
  let best: { zoneId: string; distSq: number } | null = null;
  for (const polygon of index.polygons) {
    const [minLng, minLat, maxLng, maxLat] = polygon.bbox;
    if (lat < minLat - maxDeg || lat > maxLat + maxDeg) continue;
    if (lng < minLng - maxDeg / k || lng > maxLng + maxDeg / k) continue;
    const ring = polygon.rings[0];
    for (let i = 1; i < ring.length; i++) {
      const d = distanceToSegmentSq(px, lat, ring[i - 1][0] * k, ring[i - 1][1], ring[i][0] * k, ring[i][1]);
      if (d <= maxDeg * maxDeg && (!best || d < best.distSq)) best = { zoneId: polygon.zoneId, distSq: d };
    }
  }
  return best ? clampZoneId(best.zoneId) : null;
}

/**
 * - `usda-map`: the point is inside a mapped zone.
 * - `usda-map-nearby`: just outside the map (coast, border); we used the nearest mapped zone.
 * - `latitude`: no map coverage anywhere near (or the map hasn't loaded) — rough latitude estimate.
 */
export type ZoneSource = 'usda-map' | 'usda-map-nearby' | 'latitude';

/**
 * Best available zone for a location, in the order above. `index` may be `null` while the map
 * data is still loading.
 */
export function resolveZoneForLocation(
  index: ZoneIndex | null,
  lat: number,
  lng: number,
): { zoneId: string; source: ZoneSource } {
  if (index) {
    const mapped = zoneIdAtPoint(index, lat, lng);
    if (mapped) return { zoneId: mapped, source: 'usda-map' };
    const nearby = nearestZoneIdWithin(index, lat, lng, NEARBY_TOLERANCE_DEG);
    if (nearby) return { zoneId: nearby, source: 'usda-map-nearby' };
  }
  return { zoneId: zoneIdFromLatitude(lat), source: 'latitude' };
}
