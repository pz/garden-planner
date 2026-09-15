import { useEffect, useRef } from 'react';
import { CROPS } from '../data/crops';
import { fitsAt } from '../utils/spacing';
import type { PlantInstance } from '../types';
import { CROP_COLORS, PlantMark } from './PlantMark';

export function PlantMenu({
  clientX,
  clientY,
  bedXIn,
  bedYIn,
  bedWidthIn,
  bedHeightIn,
  existingPlants,
  onPick,
  onClose,
}: {
  clientX: number;
  clientY: number;
  bedXIn: number;
  bedYIn: number;
  bedWidthIn: number;
  bedHeightIn: number;
  existingPlants: PlantInstance[];
  onPick: (cropId: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('pointerdown', onDocPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: clientX,
        top: clientY,
        zIndex: 50,
        background: 'var(--color-surface-raised)',
        border: '1.5px solid var(--color-text)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-lg)',
        width: 220,
        padding: 6,
        maxHeight: 320,
        overflowY: 'auto',
      }}
    >
      {CROPS.map((crop) => {
        const fits = fitsAt(bedXIn, bedYIn, crop.spacingIn, bedWidthIn, bedHeightIn, existingPlants);
        return (
          <button
            key={crop.id}
            disabled={!fits}
            onClick={() => onPick(crop.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              padding: '8px 10px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: 'transparent',
              textAlign: 'left',
              opacity: fits ? 1 : 0.4,
              cursor: fits ? 'pointer' : 'not-allowed',
            }}
            onMouseEnter={(e) => {
              if (fits) e.currentTarget.style.background = 'color-mix(in srgb, var(--color-text) 6%, transparent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <PlantMark family={crop.family} color={CROP_COLORS[crop.id]} diameter={22} />
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', font: '600 13px Figtree' }}>{crop.name}</span>
              <span style={{ display: 'block', font: '400 10.5px Figtree', color: 'var(--color-text-muted)' }}>
                {fits ? `Needs ${crop.spacingIn}" of space` : "Won't fit here"}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
