import { useState } from 'react';
import { useGarden } from '../state/gardenStore';
import { ZONES, getZone, zoneFirstFrostDate, zoneLastFrostDate } from '../data/zones';
import { formatDate } from '../utils/dates';
import { detectZoneFromLocation, type GeoZoneStatus } from '../utils/geoZone';
import type { SunExposure } from '../types';

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
  const [geoStatus, setGeoStatus] = useState<GeoZoneStatus>('idle');
  const [detectedFromLocation, setDetectedFromLocation] = useState(false);

  const zone = getZone(zoneId);
  const year = new Date().getFullYear();

  async function handleUseLocation() {
    setGeoStatus('locating');
    try {
      const result = await detectZoneFromLocation();
      setZoneId(result.zoneId);
      setDetectedFromLocation(true);
      setGeoStatus('done');
    } catch (err) {
      if (err instanceof Error && err.message === 'unsupported') {
        setGeoStatus('unsupported');
      } else if (err instanceof GeolocationPositionError && err.code === err.PERMISSION_DENIED) {
        setGeoStatus('denied');
      } else {
        setGeoStatus('error');
      }
    }
  }

  function handleZoneSelect(id: string) {
    setZoneId(id);
    setDetectedFromLocation(false);
  }

  function handleContinue() {
    setProfile({ zoneId, sunExposure, onboarded: true });
    setBedName(bedName.trim() || plan.bed.name);
    onDone();
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '64px 24px' }}>
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
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
          <label htmlFor="zone-select" style={{ font: '600 13px Figtree' }}>
            USDA hardiness zone
          </label>
          <button
            type="button"
            onClick={handleUseLocation}
            disabled={geoStatus === 'locating'}
            style={{
              border: 'none',
              background: 'none',
              padding: 0,
              font: '600 12.5px Figtree',
              color: 'var(--color-accent-700)',
              cursor: geoStatus === 'locating' ? 'default' : 'pointer',
              opacity: geoStatus === 'locating' ? 0.6 : 1,
            }}
          >
            {geoStatus === 'locating' ? 'Locating…' : '📍 Use my location'}
          </button>
        </div>
        <select
          id="zone-select"
          value={zoneId}
          onChange={(e) => handleZoneSelect(e.target.value)}
          style={{
            width: '100%',
            padding: '12px 14px',
            borderRadius: 'var(--radius-md)',
            border: '1.5px solid var(--color-divider)',
            font: '500 15px Figtree',
            background: 'var(--color-surface-raised)',
            color: 'var(--color-text)',
          }}
        >
          {ZONES.map((z) => (
            <option key={z.id} value={z.id}>
              {z.label}
            </option>
          ))}
        </select>
        {geoStatus === 'done' && detectedFromLocation && (
          <p style={{ font: '400 12px Figtree', color: 'var(--color-accent-700)', marginTop: 6 }}>
            Estimated from your location — it&rsquo;s a rough guess from latitude alone, so adjust it if it&rsquo;s
            not right.
          </p>
        )}
        {geoStatus === 'denied' && (
          <p style={{ font: '400 12px Figtree', color: 'var(--color-text-muted)', marginTop: 6 }}>
            Location access was denied — pick your zone from the list instead.
          </p>
        )}
        {(geoStatus === 'error' || geoStatus === 'unsupported') && (
          <p style={{ font: '400 12px Figtree', color: 'var(--color-text-muted)', marginTop: 6 }}>
            Couldn&rsquo;t detect your location — pick your zone from the list instead.
          </p>
        )}
      </div>

      <div style={{ marginBottom: 28 }}>
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
                borderColor: sunExposure === opt.id ? 'var(--color-accent)' : 'var(--color-divider)',
                background: sunExposure === opt.id ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : 'var(--color-surface-raised)',
              }}
            >
              <span style={{ font: '600 13px Figtree' }}>{opt.label}</span>
              <span style={{ font: '400 11px Figtree', color: 'var(--color-text-muted)' }}>{opt.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          background: 'var(--color-surface-raised)',
          border: '1.5px solid var(--color-divider)',
          borderRadius: 'var(--radius-md)',
          padding: '16px 18px',
          marginBottom: 32,
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

      <button onClick={handleContinue} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '13px 18px' }}>
        Continue to your garden bed
      </button>
    </div>
  );
}
