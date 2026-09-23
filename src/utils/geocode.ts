/**
 * Address / place typeahead via Photon (https://photon.komoot.io), an OpenStreetMap-based
 * geocoder built for search-as-you-type, free and keyless. URL building and response parsing
 * are pure; `searchPlaces` / `reverseGeocode` are the thin fetch wrappers the UI calls.
 */

const PHOTON_BASE = 'https://photon.komoot.io';

/** Queries shorter than this (after trimming) aren't worth a network round trip. */
export const MIN_QUERY_LENGTH = 3;

export interface PlaceResult {
  /** Stable-enough key for React lists (Photon has no single id field). */
  id: string;
  lat: number;
  lng: number;
  /** Main line, e.g. "Portland" or "123 Main Street". */
  name: string;
  /** Context line, e.g. "Oregon, United States". May be empty. */
  detail: string;
}

export function shouldSearch(query: string): boolean {
  return query.trim().length >= MIN_QUERY_LENGTH;
}

export function buildSearchUrl(query: string, opts: { limit?: number; near?: { lat: number; lng: number } } = {}): string {
  const params = new URLSearchParams({ q: query.trim(), limit: String(opts.limit ?? 6), lang: 'en' });
  if (opts.near) {
    params.set('lat', opts.near.lat.toFixed(4));
    params.set('lon', opts.near.lng.toFixed(4));
  }
  return `${PHOTON_BASE}/api/?${params}`;
}

export function buildReverseUrl(lat: number, lng: number): string {
  const params = new URLSearchParams({ lat: lat.toFixed(5), lon: lng.toFixed(5), limit: '1', lang: 'en' });
  return `${PHOTON_BASE}/reverse?${params}`;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * Turns a Photon GeoJSON response into display-ready results. Anything malformed — a non-object
 * body, features without point coordinates, features with no nameable part — is skipped rather
 * than thrown, and results whose name+detail duplicate an earlier one are dropped.
 */
export function parsePhotonResponse(body: unknown): PlaceResult[] {
  if (typeof body !== 'object' || body === null) return [];
  const features = (body as { features?: unknown }).features;
  if (!Array.isArray(features)) return [];

  const results: PlaceResult[] = [];
  const seen = new Set<string>();
  for (const feature of features) {
    const coords = (feature as { geometry?: { coordinates?: unknown } })?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const [lng, lat] = coords;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const p = ((feature as { properties?: unknown }).properties ?? {}) as Record<string, unknown>;
    const street = str(p.street);
    const housenumber = str(p.housenumber);
    const address = street ? (housenumber ? `${housenumber} ${street}` : street) : undefined;
    const name = str(p.name) ?? address ?? str(p.city);
    if (!name) continue;

    const context = [
      address !== name ? address : undefined,
      str(p.city) !== name ? str(p.city) : undefined,
      str(p.state) !== name ? str(p.state) : undefined,
      str(p.country) !== name ? str(p.country) : undefined,
    ].filter((part): part is string => part !== undefined);
    const detail = context.join(', ');

    const key = `${name}|${detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ id: `${key}|${lat},${lng}`, lat, lng, name, detail });
  }
  return results;
}

/** One-line label for a picked place, as stored on the garden profile. */
export function placeLabel(place: Pick<PlaceResult, 'name' | 'detail'>): string {
  return place.detail ? `${place.name}, ${place.detail}` : place.name;
}

export async function searchPlaces(
  query: string,
  opts: { signal?: AbortSignal; near?: { lat: number; lng: number } } = {},
): Promise<PlaceResult[]> {
  const res = await fetch(buildSearchUrl(query, { near: opts.near }), { signal: opts.signal });
  if (!res.ok) throw new Error(`Place search failed (${res.status})`);
  return parsePhotonResponse(await res.json());
}

/**
 * A coarse "where is this" label from a Photon reverse-geocode response — town and region, never
 * the street address of whatever building happens to be nearest the pin. `null` if the response
 * has nothing usable (e.g. the pin is in the ocean).
 */
export function parseReverseLocality(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const features = (body as { features?: unknown }).features;
  if (!Array.isArray(features) || features.length === 0) return null;
  const p = ((features[0] as { properties?: unknown })?.properties ?? {}) as Record<string, unknown>;
  const locality = str(p.city) ?? str(p.town) ?? str(p.village) ?? str(p.county);
  const region = str(p.state) ?? str(p.country);
  const parts = [locality, region].filter((part, i, all): part is string => part !== undefined && all.indexOf(part) === i);
  return parts.length > 0 ? parts.join(', ') : null;
}

export async function reverseGeocode(lat: number, lng: number, opts: { signal?: AbortSignal } = {}): Promise<string | null> {
  const res = await fetch(buildReverseUrl(lat, lng), { signal: opts.signal });
  if (!res.ok) throw new Error(`Reverse geocode failed (${res.status})`);
  return parseReverseLocality(await res.json());
}
