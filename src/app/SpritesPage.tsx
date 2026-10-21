import { useMemo, useState } from 'react';
import { allCrops } from '../data/crops';
import { useCustomCrops } from './state/customCropsStore';
import { PlantSprite, hasSprite } from './components/PlantSprite';
import { formatLength } from './layoutInteraction';
import { FAMILIES } from './families';

/** Every crop's sprite on one page, at several sizes, for checking the art. Reached at `/_sprites`. */
export function SpritesPage() {
  const mine = useCustomCrops(); // so a plant you just made shows up too
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const CROPS = useMemo(() => allCrops(), [mine]);
  const [rotation, setRotation] = useState(20);
  const missing = CROPS.filter((c) => !hasSprite(c.id));

  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: '24px 20px 64px' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
        <h1 style={{ font: '700 26px Figtree' }}>Plant sprites</h1>
        <span style={{ font: '400 14px Figtree', color: 'var(--color-neutral-700)' }}>
          {CROPS.length} crops{missing.length ? ` · ${missing.length} without a sprite` : ''}
        </span>
        <label style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10, font: '600 13px Figtree' }}>
          Turn
          <input type="range" min={0} max={359} value={rotation} aria-label="Turn" onChange={(e) => setRotation(+e.target.value)} />
          <span style={{ width: 36, font: '400 13px Figtree' }}>{rotation}°</span>
        </label>
      </header>
      <p style={{ font: '400 13px Figtree', color: 'var(--color-neutral-700)', marginBottom: 24 }}>
        Each plant at 120 px, at list size (30 px) and as it draws in the garden, to scale with its spacing at 100% zoom.
      </p>

      {FAMILIES.map(({ family, label }) => {
        const crops = CROPS.filter((c) => c.family === family);
        if (crops.length === 0) return null;
        return (
          <section key={family} style={{ marginBottom: 32 }}>
            <h2 style={{ font: '700 16px Figtree', marginBottom: 12 }}>{label}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 14 }}>
              {crops.map((c) => (
                <figure key={c.id} data-sprite={c.id} style={{ margin: 0, padding: 14, borderRadius: 24, background: 'var(--color-surface)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 132, height: 132, borderRadius: '50%', background: 'var(--color-neutral-200)', display: 'grid', placeItems: 'center' }}>
                    <PlantSprite cropId={c.id} diameter={120} rotation={rotation} />
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <PlantSprite cropId={c.id} diameter={30} rotation={rotation} />
                    <span style={{ display: 'inline-flex', justifyContent: 'center', alignItems: 'center', width: Math.max(8, c.spacingIn * 7), height: Math.max(8, c.spacingIn * 7), maxWidth: 110, maxHeight: 110 }}>
                      <PlantSprite cropId={c.id} diameter={Math.min(110, Math.max(8, c.spacingIn * 7))} rotation={rotation} />
                    </span>
                  </div>
                  <figcaption style={{ textAlign: 'center' }}>
                    <div style={{ font: '600 14px Figtree' }}>{c.name}</div>
                    <div style={{ font: '400 12px Figtree', color: 'var(--color-neutral-700)' }}>
                      {c.id} · {formatLength(c.spacingIn)} apart
                    </div>
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}
