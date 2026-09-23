import { Suspense, lazy, useState } from 'react';
import { useGarden } from '../state/gardenStore';
import { getZone, zoneFirstFrostDate, zoneLastFrostDate } from '../data/zones';
import { formatDate } from '../utils/dates';
import type { ZoneSource } from '../utils/zoneMap';
import { GardenSwitcher } from './GardenSwitcher';
import { ZonePicker } from './ZonePicker';
import type { LocationPick } from './LocationPicker';
import type { GardenLocation, SunExposure } from '../types';

// Leaflet + the zone polygons are only needed here, so keep them out of the main bundle.
const LocationPicker = lazy(() => import('./LocationPicker').then((m) => ({ default: m.LocationPicker })));

const ZONE_SOURCE_NOTE: Record<ZoneSource | 'manual', string> = {
  manual: 'Picked by hand. Moving the pin will look your zone up again.',
  'usda-map': 'From the USDA hardiness zone map at your pin.',
  'usda-map-nearby': 'From the nearest area on the USDA zone map — your pin is just off its edge, so double-check it.',
  latitude:
    'Your pin is outside the US zone map, so this is a rough estimate from latitude alone — adjust it if it’s not right.',
};

const SUN_OPTIONS: { id: SunExposure; label: string; hint: string }[] = [
  { id: 'full-sun', label: 'Full sun', hint: '6+ hours of direct sun' },
  { id: 'part-shade', label: 'Part shade', hint: '3–6 hours of direct sun' },
  { id: 'shade', label: 'Shade', hint: 'Under 3 hours of direct sun' },
];

export function SetupScreen({ onDone }: { onDone: () => void }) {
  const { plan, setProfile, setBedName } = useGarden();
  const [bedName, setBedNameInput] = useState(plan.bed.name);
  const [zoneId, setZoneId] = useState(plan.profile.zoneId);
  const [sunExposure, setSunExposure] = useState<SunExposure>(plan.profile.sunExposure);
  const [location, setLocation] = useState<GardenLocation | undefined>(plan.profile.location);
  /** Where the current zone came from this session; `null` until the pin moves or a zone is picked. */
  const [zoneSource, setZoneSource] = useState<ZoneSource | 'manual' | null>(null);

  const zone = getZone(zoneId);
  const year = new Date().getFullYear();

  function handlePick(pick: LocationPick) {
    setLocation(pick.location);
    setZoneId(pick.zoneId);
    setZoneSource(pick.source);
  }

  function handleZoneSelect(id: string) {
    setZoneId(id);
    setZoneSource('manual');
  }

  function handleContinue() {
    setProfile(location ? { zoneId, sunExposure, onboarded: true, location } : { zoneId, sunExposure, onboarded: true });
    setBedName(bedName.trim() || plan.bed.name);
    onDone();
  }

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: '64px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: -8 }}>
        <GardenSwitcher />
      </div>
      <p style={{ font: '400 17px Caveat, cursive', color: 'var(--color-text-muted)', marginBottom: 4 }}>
        Let&rsquo;s get your garden started
      </p>
      <h1 style={{ fontSize: 30, marginBottom: 28 }}>A little about your garden</h1>

      <label style={{ display: 'block', marginBottom: 22 }}>
        <span style={{ display: 'block', font: '600 13px Figtree', marginBottom: 8 }}>Bed name</span>
        <input
          value={bedName}
          placeholder="e.g. The back porch bed"
          onChange={(e) => setBedNameInput(e.target.value)}
          style={{
            width: '100%',
            padding: '12px 14px',
            borderRadius: 'var(--radius-md)',
            border: '1.5px solid var(--color-divider)',
            font: '500 15px Figtree',
            background: 'var(--color-surface-raised)',
            color: 'var(--color-text)',
          }}
        />
      </label>

      <div style={{ marginBottom: 22 }}>
        <span style={{ display: 'block', font: '600 13px Figtree', marginBottom: 4 }}>Where&rsquo;s your garden?</span>
        <p style={{ font: '400 12.5px/1.45 Figtree', color: 'var(--color-text-muted)', marginBottom: 10 }}>
          Search for your address or town, use your location, or drag the map until the pin sits on your garden.
          We&rsquo;ll look up your hardiness zone as you go.
        </p>
        <Suspense fallback={<div style={{ height: 390 }} />}>
          <LocationPicker location={location} zoneId={zoneId} onPick={handlePick} />
        </Suspense>
      </div>

      <div style={{ marginBottom: 22 }}>
        <span id="zone-picker-label" style={{ display: 'block', font: '600 13px Figtree', marginBottom: 8 }}>
          USDA hardiness zone
        </span>
        <ZonePicker zoneId={zoneId} onSelect={handleZoneSelect} />
        {(zoneSource || !location) && (
          <p
            data-testid="zone-source-note"
            style={{
              font: '400 12px Figtree',
              color:
                zoneSource === 'usda-map'
                  ? 'var(--color-accent-2-700)'
                  : zoneSource === 'usda-map-nearby' || zoneSource === 'latitude'
                    ? 'var(--color-accent-700)'
                    : 'var(--color-text-muted)',
              marginTop: 8,
            }}
          >
            {zoneSource ? ZONE_SOURCE_NOTE[zoneSource] : 'Place your pin to look up your zone, or pick one yourself.'}
          </p>
        )}
      </div>

      <div
        style={{
          background: 'var(--color-surface-raised)',
          border: '1.5px solid var(--color-divider)',
          borderRadius: 'var(--radius-md)',
          padding: '16px 18px',
          marginBottom: 22,
        }}
      >
        <p style={{ font: '600 13px Figtree', marginBottom: 8 }}>What that means for you</p>
        <p style={{ font: '400 13px/1.5 Figtree', color: 'var(--color-text-muted)' }}>
          Your average last spring frost is around <strong>{formatDate(zoneLastFrostDate(zone, year))}</strong>,
          and your average first fall frost is around{' '}
          <strong>{formatDate(zoneFirstFrostDate(zone, year))}</strong>. We&rsquo;ll use these to suggest planting
          and harvest dates for whatever you grow.
        </p>
      </div>

      <div style={{ marginBottom: 32 }}>
        <span style={{ display: 'block', font: '600 13px Figtree', marginBottom: 8 }}>Sun exposure</span>
        <div style={{ display: 'flex', gap: 10 }}>
          {SUN_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setSunExposure(opt.id)}
              className="btn"
              style={{
                flex: 1,
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 2,
                padding: '12px 14px',
                borderRadius: 'var(--radius-md)',
                borderColor: sunExposure === opt.id ? 'var(--color-accent)' : 'var(--color-divider)',
                background: sunExposure === opt.id ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : 'var(--color-surface-raised)',
              }}
            >
              <span style={{ font: '600 13px Figtree' }}>{opt.label}</span>
              <span style={{ font: '400 11px/1.4 Figtree', color: 'var(--color-text-muted)' }}>{opt.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <button onClick={handleContinue} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '13px 18px' }}>
        Continue to your garden bed
      </button>
    </div>
  );
}
