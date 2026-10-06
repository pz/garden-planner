import { describe, expect, it } from 'vitest';
import { formatLatLng, normalizeLng, parseGardenLocation } from './location';

describe('normalizeLng', () => {
  it('leaves in-range longitudes alone', () => {
    expect(normalizeLng(-122.68)).toBeCloseTo(-122.68);
    expect(normalizeLng(0)).toBe(0);
  });

  it('wraps past the antimeridian in either direction', () => {
    expect(normalizeLng(190)).toBeCloseTo(-170);
    expect(normalizeLng(-190)).toBeCloseTo(170);
    expect(normalizeLng(-122.68 + 720)).toBeCloseTo(-122.68);
  });

  it('maps +180 to -180 (half-open range) and keeps -180', () => {
    expect(normalizeLng(180)).toBe(-180);
    expect(normalizeLng(-180)).toBe(-180);
    expect(normalizeLng(179.99)).toBeCloseTo(179.99);
  });
});

describe('parseGardenLocation', () => {
  it('accepts a valid location and trims its label', () => {
    expect(parseGardenLocation({ lat: 45.5, lng: -122.7, label: '  Portland  ' })).toEqual({
      lat: 45.5,
      lng: -122.7,
      label: 'Portland',
    });
  });

  it('omits a blank or non-string label', () => {
    expect(parseGardenLocation({ lat: 1, lng: 2, label: '   ' })).toEqual({ lat: 1, lng: 2 });
    expect(parseGardenLocation({ lat: 1, lng: 2, label: 42 })).toEqual({ lat: 1, lng: 2 });
  });

  it('accepts the poles exactly but rejects latitude just past them', () => {
    expect(parseGardenLocation({ lat: 90, lng: 0 })).toEqual({ lat: 90, lng: 0 });
    expect(parseGardenLocation({ lat: -90, lng: 0 })).toEqual({ lat: -90, lng: 0 });
    expect(parseGardenLocation({ lat: 90.01, lng: 0 })).toBeUndefined();
    expect(parseGardenLocation({ lat: -90.01, lng: 0 })).toBeUndefined();
  });

  it('normalizes rather than rejects an out-of-range longitude', () => {
    expect(parseGardenLocation({ lat: 10, lng: 200 })?.lng).toBeCloseTo(-160);
  });

  it('rejects non-objects, missing fields, strings and non-finite numbers', () => {
    for (const bad of [null, undefined, 'x', 5, {}, { lat: 1 }, { lat: '1', lng: '2' }, { lat: NaN, lng: 0 }, { lat: 0, lng: Infinity }]) {
      expect(parseGardenLocation(bad)).toBeUndefined();
    }
  });
});

describe('formatLatLng', () => {
  it('uses hemisphere letters instead of signs', () => {
    expect(formatLatLng({ lat: 45.523, lng: -122.676 })).toBe('45.52° N, 122.68° W');
    expect(formatLatLng({ lat: -33.87, lng: 151.21 })).toBe('33.87° S, 151.21° E');
  });

  it('treats the equator and prime meridian as N / E', () => {
    expect(formatLatLng({ lat: 0, lng: 0 })).toBe('0.00° N, 0.00° E');
  });
});
