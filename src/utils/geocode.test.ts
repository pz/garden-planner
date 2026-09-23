import { describe, expect, it } from 'vitest';
import {
  MIN_QUERY_LENGTH,
  buildReverseUrl,
  buildSearchUrl,
  parsePhotonResponse,
  parseReverseLocality,
  placeLabel,
  shouldSearch,
} from './geocode';

function feature(properties: Record<string, unknown>, coordinates: unknown = [-122.68, 45.52]) {
  return { type: 'Feature', geometry: { type: 'Point', coordinates }, properties };
}

describe('shouldSearch', () => {
  it('waits for the minimum length, ignoring surrounding whitespace', () => {
    expect(MIN_QUERY_LENGTH).toBe(3);
    expect(shouldSearch('po')).toBe(false);
    expect(shouldSearch('  po  ')).toBe(false);
    expect(shouldSearch('por')).toBe(true);
  });
});

describe('buildSearchUrl / buildReverseUrl', () => {
  it('encodes the trimmed query and a result limit', () => {
    const url = new URL(buildSearchUrl('  123 Main St & Co  '));
    expect(url.origin + url.pathname).toBe('https://photon.komoot.io/api/');
    expect(url.searchParams.get('q')).toBe('123 Main St & Co');
    expect(url.searchParams.get('limit')).toBe('6');
  });

  it('adds a location bias only when asked', () => {
    expect(new URL(buildSearchUrl('portland')).searchParams.has('lat')).toBe(false);
    const biased = new URL(buildSearchUrl('portland', { near: { lat: 43.66123, lng: -70.25567 } }));
    expect(biased.searchParams.get('lat')).toBe('43.6612');
    expect(biased.searchParams.get('lon')).toBe('-70.2557');
  });

  it('builds a reverse lookup for one result', () => {
    const url = new URL(buildReverseUrl(45.5, -122.7));
    expect(url.pathname).toBe('/reverse');
    expect(url.searchParams.get('lat')).toBe('45.50000');
    expect(url.searchParams.get('lon')).toBe('-122.70000');
    expect(url.searchParams.get('limit')).toBe('1');
  });
});

describe('parsePhotonResponse', () => {
  it('turns a city into name + context, with lat/lng swapped out of GeoJSON order', () => {
    const [place] = parsePhotonResponse({
      features: [feature({ name: 'Portland', state: 'Oregon', country: 'United States' })],
    });
    expect(place).toMatchObject({ name: 'Portland', detail: 'Oregon, United States', lat: 45.52, lng: -122.68 });
  });

  it('names a street address by house number + street and keeps the city as context', () => {
    const [place] = parsePhotonResponse({
      features: [feature({ housenumber: '123', street: 'Main Street', city: 'Springfield', state: 'Illinois' })],
    });
    expect(place.name).toBe('123 Main Street');
    expect(place.detail).toBe('Springfield, Illinois');
  });

  it('keeps the address as context for a named place (a park, a school)', () => {
    const [place] = parsePhotonResponse({
      features: [feature({ name: 'Laurelhurst Park', street: 'SE Cesar Chavez Blvd', city: 'Portland' })],
    });
    expect(place.detail).toBe('SE Cesar Chavez Blvd, Portland');
  });

  it('does not repeat the name in the context (a city whose state has the same name)', () => {
    const [place] = parsePhotonResponse({ features: [feature({ name: 'New York', city: 'New York', state: 'New York' })] });
    expect(place.detail).toBe('');
  });

  it('drops duplicate name+context results', () => {
    const f = feature({ name: 'Springfield', state: 'Illinois' });
    expect(parsePhotonResponse({ features: [f, feature({ name: 'Springfield', state: 'Illinois' }, [-89, 39])] })).toHaveLength(1);
  });

  it('skips features without usable point coordinates or anything to call them', () => {
    const results = parsePhotonResponse({
      features: [
        feature({ name: 'No coords' }, null),
        feature({ name: 'Bad coords' }, ['a', 'b']),
        feature({ name: 'NaN coords' }, [NaN, 1]),
        feature({ country: 'Nameless' }),
        { geometry: null },
        null,
        feature({ name: 'Good' }),
      ],
    });
    expect(results.map((r) => r.name)).toEqual(['Good']);
  });

  it('returns no results for a body that is not a feature collection', () => {
    for (const bad of [null, undefined, 'oops', 42, {}, { features: 'nope' }]) {
      expect(parsePhotonResponse(bad)).toEqual([]);
    }
  });
});

describe('placeLabel', () => {
  it('joins name and context, or uses the name alone', () => {
    expect(placeLabel({ name: 'Portland', detail: 'Oregon, United States' })).toBe('Portland, Oregon, United States');
    expect(placeLabel({ name: 'Portland', detail: '' })).toBe('Portland');
  });
});

describe('parseReverseLocality', () => {
  it('uses town and state, never the street address', () => {
    expect(
      parseReverseLocality({
        features: [feature({ name: 'Some Cafe', housenumber: '5', street: 'Elm St', city: 'Burlington', state: 'Vermont' })],
      }),
    ).toBe('Burlington, Vermont');
  });

  it('falls back through town / village / county, and to country without a state', () => {
    expect(parseReverseLocality({ features: [feature({ village: 'Hope', state: 'Idaho' })] })).toBe('Hope, Idaho');
    expect(parseReverseLocality({ features: [feature({ county: 'Rural County', state: 'Kansas' })] })).toBe(
      'Rural County, Kansas',
    );
    expect(parseReverseLocality({ features: [feature({ city: 'Paris', country: 'France' })] })).toBe('Paris, France');
  });

  it('does not repeat a city that shares its state name', () => {
    expect(parseReverseLocality({ features: [feature({ city: 'New York', state: 'New York' })] })).toBe('New York');
  });

  it('returns null for empty or malformed responses', () => {
    for (const bad of [null, {}, { features: [] }, { features: [feature({})] }, { features: 'x' }]) {
      expect(parseReverseLocality(bad)).toBeNull();
    }
  });
});
