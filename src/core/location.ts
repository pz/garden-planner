import type { GardenLocation } from '../types';

/** Wraps any longitude into [-180, 180) — Leaflet happily reports 190° after panning past the antimeridian. */
export function normalizeLng(lng: number): number {
  if (lng >= -180 && lng < 180) return lng; // avoid float drift on the common case
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/**
 * Validates a location read from storage (or anywhere untrusted). Returns a clean copy, or
 * `undefined` if it isn't a usable lat/lng — callers treat that the same as "no pin placed".
 * Longitude is normalized rather than rejected; latitude outside [-90, 90] is rejected.
 */
export function parseGardenLocation(value: unknown): GardenLocation | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { lat, lng, label } = value as Record<string, unknown>;
  if (typeof lat !== 'number' || typeof lng !== 'number') return undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (lat < -90 || lat > 90) return undefined;
  const location: GardenLocation = { lat, lng: normalizeLng(lng) };
  if (typeof label === 'string' && label.trim() !== '') location.label = label.trim();
  return location;
}

/** e.g. "45.52° N, 122.68° W" — shown when we have a pin but no place name. */
export function formatLatLng({ lat, lng }: { lat: number; lng: number }): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}° ${ns}, ${Math.abs(lng).toFixed(2)}° ${ew}`;
}
