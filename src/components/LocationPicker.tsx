import { useEffect, useId, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getZone } from '../data/zones';
import { loadZoneGeoJson, loadZoneIndex } from '../data/usdaZones';
import { placeLabel, reverseGeocode, searchPlaces, shouldSearch, type PlaceResult } from '../utils/geocode';
import { getBrowserPosition } from '../utils/geoZone';
import { formatLatLng, normalizeLng } from '../utils/location';
import { isZoneOverriddenAtLocation, resolveZoneForLocation, type ZoneIndex, type ZoneSource } from '../utils/zoneMap';
import type { GardenLocation } from '../types';

export interface LocationPick {
  location: GardenLocation;
  zoneId: string;
  source: ZoneSource;
}

/** Contiguous-US bounds, for the initial view when the garden has no pin yet. */
const US48_BOUNDS = L.latLngBounds([24.5, -124.8], [49.4, -66.9]);
const PLACED_ZOOM = 11;
const SEARCH_DEBOUNCE_MS = 300;
const REVERSE_DEBOUNCE_MS = 600;

/**
 * Esri's Light Gray Canvas: keyless, and split into a base layer and a labels layer so place names
 * can sit above the zone overlay. (CARTO's equivalent now needs an API key.) Tiles stop at z16.
 */
const esriTiles = (layer: string) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${layer}/MapServer/tile/{z}/{y}/{x}`;
const MAX_ZOOM = 16;
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.esri.com">Esri</a>, HERE, Garmin, OpenStreetMap · Zones: <a href="https://github.com/kgjenkins/ophz">OPHZ</a>';

type GeoStatus = 'idle' | 'locating' | 'denied' | 'error';
type SearchStatus = 'idle' | 'loading' | 'done' | 'error';

/**
 * Map-based garden location picker. The pin is fixed at the map's center — the user drags the
 * map underneath it (or searches, or uses their location) and every move reports the new
 * location and its zone via `onPick`. Nothing is reported until the user actually moves the map,
 * so opening setup never silently overwrites a zone they picked by hand.
 */
export function LocationPicker({
  location,
  zoneId,
  zoneFromPin,
  onPick,
  onSavedZoneOverridden,
}: {
  location: GardenLocation | undefined;
  /** The zone currently selected on the setup screen, shown on the map's location chip. */
  zoneId: string;
  /**
   * False when the user picked the zone by hand, so it no longer comes from the pin. The pin goes
   * gray (and the chip drops the zone) until the user moves it again.
   */
  zoneFromPin: boolean;
  onPick: (pick: LocationPick) => void;
  /** Called once the zone map loads if the saved zone doesn't match the saved pin (hand-picked). */
  onSavedZoneOverridden: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  /** Where the map opens; later `location` changes come from the map itself, so it's read once. */
  const initialLocationRef = useRef(location);
  const initialZoneIdRef = useRef(zoneId);
  const onSavedZoneOverriddenRef = useRef(onSavedZoneOverridden);
  useEffect(() => {
    onSavedZoneOverriddenRef.current = onSavedZoneOverridden;
  }, [onSavedZoneOverridden]);
  const mapRef = useRef<L.Map | null>(null);
  const indexRef = useRef<ZoneIndex | null>(null);
  const onPickRef = useRef(onPick);
  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);
  /**
   * Whether the user has moved the pin this session. Until then we never report — the map firing
   * `move` on resize or while loading mustn't override a zone the user picked by hand.
   */
  const interactedRef = useRef(false);
  /** Set when we reported a latitude-only estimate because the zone map hadn't loaded yet. */
  const reportedWithoutIndexRef = useRef(false);
  /** Place name for the current center, cleared as soon as the user drags away from it. */
  const labelRef = useRef<string | undefined>(location?.label);
  const reverseTimer = useRef<number | undefined>(undefined);
  const reverseAbort = useRef<AbortController | null>(null);

  const [placed, setPlaced] = useState(location !== undefined);
  const [dragging, setDragging] = useState(false);
  const [geoStatus, setGeoStatus] = useState<GeoStatus>('idle');
  /** Bumped to reset the search box once the pin leaves the place it names. */
  const [searchKey, setSearchKey] = useState(0);

  function emit() {
    const map = mapRef.current;
    if (!map || !interactedRef.current) return;
    const center = map.getCenter();
    const lat = center.lat;
    const lng = normalizeLng(center.lng);
    const zone = resolveZoneForLocation(indexRef.current, lat, lng);
    reportedWithoutIndexRef.current = indexRef.current === null;
    const next: GardenLocation = labelRef.current ? { lat, lng, label: labelRef.current } : { lat, lng };
    onPickRef.current({ location: next, ...zone });
  }

  function lookUpLabelSoon() {
    window.clearTimeout(reverseTimer.current);
    reverseAbort.current?.abort();
    reverseTimer.current = window.setTimeout(async () => {
      const map = mapRef.current;
      if (!map || !interactedRef.current) return;
      const center = map.getCenter();
      const controller = new AbortController();
      reverseAbort.current = controller;
      try {
        const label = await reverseGeocode(center.lat, normalizeLng(center.lng), { signal: controller.signal });
        if (controller.signal.aborted || !label) return;
        labelRef.current = label;
        emit();
      } catch {
        // No label is fine — we fall back to showing coordinates.
      }
    }, REVERSE_DEBOUNCE_MS);
  }

  /** Moves the pin somewhere programmatically (search result, browser location). */
  function placeAt(lat: number, lng: number, label: string | undefined) {
    const map = mapRef.current;
    if (!map) return;
    window.clearTimeout(reverseTimer.current);
    reverseAbort.current?.abort();
    markInteracted();
    labelRef.current = label;
    map.setView([lat, lng], Math.max(map.getZoom(), PLACED_ZOOM));
    emit(); // setView may be a no-op move if we're already there
  }

  function markInteracted() {
    interactedRef.current = true;
    setPlaced(true);
  }

  /** The user is moving the pin away from wherever its current label describes. */
  function startManualMove() {
    markInteracted();
    if (labelRef.current) setSearchKey((k) => k + 1);
    labelRef.current = undefined;
    window.clearTimeout(reverseTimer.current);
    reverseAbort.current?.abort();
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = L.map(container, {
      // Zoom around the pin, never the cursor, so zooming doesn't move the garden.
      scrollWheelZoom: 'center',
      doubleClickZoom: 'center',
      touchZoom: 'center',
      zoomSnap: 0.5,
      maxZoom: MAX_ZOOM,
      worldCopyJump: true,
      attributionControl: true,
    });
    mapRef.current = map;
    map.attributionControl.setPrefix(false);
    const initial = initialLocationRef.current;
    if (initial) map.setView([initial.lat, initial.lng], PLACED_ZOOM);
    else map.fitBounds(US48_BOUNDS);

    map.createPane('zones').style.zIndex = '350';
    const labels = map.createPane('labels');
    labels.style.zIndex = '450';
    labels.style.pointerEvents = 'none';

    L.tileLayer(esriTiles('World_Light_Gray_Base'), { attribution: TILE_ATTRIBUTION, maxZoom: MAX_ZOOM }).addTo(map);
    L.tileLayer(esriTiles('World_Light_Gray_Reference'), { maxZoom: MAX_ZOOM, pane: 'labels' }).addTo(map);

    const zonesRenderer = L.canvas({ pane: 'zones', padding: 1 });
    let cancelled = false;
    loadZoneGeoJson()
      .then((geojson) => {
        if (cancelled) return;
        L.geoJSON(geojson as GeoJSON.FeatureCollection, {
          pane: 'zones',
          interactive: false,
          style: (feature) => ({
            // The overlay is ~19k vertices, so draw it on canvas. Canvas only redraws when a drag
            // ends; generous padding keeps zones drawn under the pin for the whole drag.
            renderer: zonesRenderer,
            stroke: false,
            fillColor: getZone(String(feature?.properties?.zone)).mapColor,
            fillOpacity: 0.42,
          }),
        }).addTo(map);
      })
      .catch(() => {
        // The overlay is a nice-to-have; the picker still works without it.
      });
    loadZoneIndex()
      .then((index) => {
        if (cancelled) return;
        indexRef.current = index;
        const saved = initialLocationRef.current;
        if (
          saved &&
          !interactedRef.current &&
          isZoneOverriddenAtLocation(index, saved.lat, saved.lng, initialZoneIdRef.current)
        ) {
          onSavedZoneOverriddenRef.current();
        }
        if (reportedWithoutIndexRef.current) emit(); // upgrade an estimate made before the index arrived
      })
      .catch(() => {});

    let frame = 0;
    map.on('move', () => {
      if (!interactedRef.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(emit);
    });
    map.on('moveend', () => {
      if (interactedRef.current && !labelRef.current) lookUpLabelSoon();
    });
    map.on('dragstart', () => {
      startManualMove();
      setDragging(true);
    });
    map.on('dragend', () => setDragging(false));
    map.on('click', (e: L.LeafletMouseEvent) => {
      startManualMove();
      map.panTo(e.latlng);
    });
    map.on('keydown', (e: L.LeafletKeyboardEvent) => {
      if (e.originalEvent.key.startsWith('Arrow')) startManualMove();
    });

    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(container);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(reverseTimer.current);
      reverseAbort.current?.abort();
      resize.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  async function handleUseLocation() {
    setGeoStatus('locating');
    try {
      const { latitude, longitude } = await getBrowserPosition();
      setGeoStatus('idle');
      placeAt(latitude, longitude, undefined);
    } catch (err) {
      const denied = typeof GeolocationPositionError !== 'undefined' && err instanceof GeolocationPositionError && err.code === err.PERMISSION_DENIED;
      setGeoStatus(denied ? 'denied' : 'error');
    }
  }

  const zone = getZone(zoneId);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <PlaceSearch
          key={searchKey}
          near={() => {
            const c = mapRef.current?.getCenter();
            return interactedRef.current && c ? { lat: c.lat, lng: normalizeLng(c.lng) } : undefined;
          }}
          onSelect={(place) => placeAt(place.lat, place.lng, placeLabel(place))}
        />
        <button
          type="button"
          className="btn"
          onClick={handleUseLocation}
          disabled={geoStatus === 'locating'}
          title="Use my current location"
          style={{ flexShrink: 0, padding: '10px 14px', opacity: geoStatus === 'locating' ? 0.6 : 1 }}
        >
          {geoStatus === 'locating' ? 'Locating…' : '📍 My location'}
        </button>
      </div>
      {geoStatus === 'denied' && (
        <p style={{ font: '400 12px Figtree', color: 'var(--color-text-muted)', marginBottom: 8 }}>
          Location access was denied — search for your town or drag the map instead.
        </p>
      )}
      {geoStatus === 'error' && (
        <p style={{ font: '400 12px Figtree', color: 'var(--color-text-muted)', marginBottom: 8 }}>
          Couldn&rsquo;t detect your location — search for your town or drag the map instead.
        </p>
      )}

      <div
        style={{
          position: 'relative',
          height: 320,
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          border: '1.5px solid var(--color-divider)',
          background: '#e8e4dc',
        }}
      >
        <div ref={containerRef} data-testid="location-map" style={{ position: 'absolute', inset: 0 }} />

        <CenterPin placed={placed} lifted={dragging} inactive={placed && !zoneFromPin} />

        {!placed && (
          <div style={chipStyle({ bottom: 26, left: '50%', transform: 'translateX(-50%)' })}>
            Drag the map to place your pin
          </div>
        )}
        {placed && location && (
          <div
            data-testid="location-chip"
            style={chipStyle({ left: 10, bottom: 26, maxWidth: 'calc(100% - 20px)', display: 'flex', alignItems: 'center', gap: 8 })}
          >
            {zoneFromPin && (
              <>
                <span
                  aria-hidden
                  style={{ width: 12, height: 12, borderRadius: 3, background: zone.mapColor, flexShrink: 0, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15)' }}
                />
                <strong style={{ flexShrink: 0 }}>{zone.label}</strong>
              </>
            )}
            <span style={{ color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {location.label ?? formatLatLng(location)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function chipStyle(position: React.CSSProperties): React.CSSProperties {
  return {
    position: 'absolute',
    zIndex: 1000,
    pointerEvents: 'none',
    padding: '6px 12px',
    borderRadius: 999,
    background: 'color-mix(in srgb, var(--color-surface-raised) 94%, transparent)',
    boxShadow: 'var(--shadow-md)',
    font: '500 12.5px Figtree',
    color: 'var(--color-text)',
    whiteSpace: 'nowrap',
    ...position,
  };
}

/** The drop pin, drawn over the map's exact center; its tip marks the garden. */
/** `inactive`: the zone was picked by hand, so the pin is shown gray until it's moved again. */
function CenterPin({ placed, lifted, inactive }: { placed: boolean; lifted: boolean; inactive: boolean }) {
  return (
    <div
      aria-hidden
      style={{ position: 'absolute', left: '50%', top: '50%', zIndex: 1000, pointerEvents: 'none', width: 0, height: 0 }}
    >
      {/* ground shadow at the exact center */}
      <div
        style={{
          position: 'absolute',
          left: -6,
          top: -3,
          width: 12,
          height: 6,
          borderRadius: '50%',
          background: 'rgba(0,0,0,0.28)',
          transform: lifted ? 'scale(0.7)' : 'none',
          transition: 'transform 0.15s ease',
        }}
      />
      <svg
        data-testid="center-pin"
        data-inactive={inactive}
        width="30"
        height="40"
        viewBox="0 0 30 40"
        style={{
          position: 'absolute',
          left: -15,
          top: -40,
          opacity: placed ? 1 : 0.55,
          transform: lifted ? 'translateY(-8px)' : 'none',
          transition: 'transform 0.15s ease, opacity 0.15s ease',
          filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.3))',
        }}
      >
        <path
          d="M15 39C15 39 28 23.5 28 14A13 13 0 0 0 2 14C2 23.5 15 39 15 39Z"
          fill={inactive ? 'color-mix(in srgb, var(--color-text) 35%, var(--color-surface-raised))' : 'var(--color-accent)'}
          stroke={inactive ? 'color-mix(in srgb, var(--color-text) 55%, var(--color-surface-raised))' : 'var(--color-accent-700)'}
          strokeWidth="1.5"
          style={{ transition: 'fill 0.15s ease, stroke 0.15s ease' }}
        />
        <circle cx="15" cy="14" r="5" fill="#fffdf8" />
      </svg>
    </div>
  );
}

/** Address / city typeahead. Results come from Photon; picking one moves the map there. */
function PlaceSearch({
  near,
  onSelect,
}: {
  near: () => { lat: number; lng: number } | undefined;
  onSelect: (place: PlaceResult) => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const nearRef = useRef(near);
  useEffect(() => {
    nearRef.current = near;
  }, [near]);

  useEffect(() => {
    if (!shouldSearch(query)) return; // nothing to show; the list hides itself for short queries
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStatus('loading');
      try {
        const found = await searchPlaces(query, { signal: controller.signal, near: nearRef.current() });
        setResults(found);
        setHighlight(0);
        setStatus('done');
      } catch {
        if (!controller.signal.aborted) setStatus('error');
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  function choose(place: PlaceResult) {
    setQuery(placeLabel(place));
    setOpen(false);
    onSelect(place);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && results.length > 0) {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => (h + 1) % results.length);
    } else if (e.key === 'ArrowUp' && results.length > 0) {
      e.preventDefault();
      setHighlight((h) => (h - 1 + results.length) % results.length);
    } else if (e.key === 'Enter' && open && results[highlight]) {
      e.preventDefault();
      choose(results[highlight]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const showList = open && shouldSearch(query) && status !== 'idle';

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <input
        type="search"
        role="combobox"
        aria-label="Search for your address or town"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results[highlight] ? `${listId}-${highlight}` : undefined}
        value={query}
        placeholder="Search an address, town, or ZIP"
        onChange={(e) => {
          setQuery(e.target.value);
          // Drop the previous query's results right away so a stale one can't be picked mid-debounce.
          setResults([]);
          setStatus(shouldSearch(e.target.value) ? 'loading' : 'idle');
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
        style={{
          width: '100%',
          padding: '10px 14px',
          borderRadius: 999,
          border: '1.5px solid var(--color-divider)',
          font: '500 14px Figtree',
          background: 'var(--color-surface-raised)',
          color: 'var(--color-text)',
        }}
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            zIndex: 1100,
            margin: 0,
            padding: 6,
            listStyle: 'none',
            background: 'var(--color-surface-raised)',
            border: '1.5px solid var(--color-divider)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          {results.map((place, i) => (
            <li
              key={place.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === highlight}
              // mousedown, not click, so it fires before the input's blur closes the list
              onMouseDown={(e) => {
                e.preventDefault();
                choose(place);
              }}
              onMouseEnter={() => setHighlight(i)}
              style={{
                padding: '8px 10px',
                borderRadius: 10,
                cursor: 'pointer',
                background: i === highlight ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : 'transparent',
              }}
            >
              <div style={{ font: '600 13.5px Figtree' }}>{place.name}</div>
              {place.detail && <div style={{ font: '400 12px Figtree', color: 'var(--color-text-muted)' }}>{place.detail}</div>}
            </li>
          ))}
          {results.length === 0 && (
            <li style={{ padding: '8px 10px', font: '400 12.5px Figtree', color: 'var(--color-text-muted)' }}>
              {status === 'loading' ? 'Searching…' : status === 'error' ? 'Search isn’t available right now — drag the map instead.' : 'No matches'}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
