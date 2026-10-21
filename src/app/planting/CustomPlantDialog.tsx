import { useState } from 'react';
import type { CropDef, CropLook } from '../../types';
import { makeCustomCrop } from '../../data/crops';
import { LookSprite } from '../components/PlantSprite';
import { MAX_SPACING_IN, lengthHint, readCustomPlant } from '../customPlant';
import { formatLength } from '../layoutInteraction';
import { ACCENTS, LEAF_COLORS, SHAPES } from '../sprites';

const swatch = (on: boolean, bg: string) =>
  ({
    width: 30,
    height: 30,
    borderRadius: '50%',
    padding: 0,
    cursor: 'pointer',
    background: bg,
    border: `2px solid ${on ? 'var(--color-text)' : 'transparent'}`,
    boxShadow: on ? '0 0 0 2px var(--color-surface) inset' : 'inset 0 0 0 1px rgba(0,0,0,.12)',
    display: 'grid',
    placeItems: 'center',
  }) as const;

/** Make a plant of your own (or edit one): its name, spacing, height and how it looks. */
export function CustomPlantDialog({
  plant,
  initialName = '',
  plantCount,
  onSave,
  onDelete,
  onClose,
}: {
  /** The plant being edited; null to make a new one. */
  plant: CropDef | null;
  initialName?: string;
  /** How many of it are in the current garden (what deleting it would remove). */
  plantCount: number;
  onSave: (fields: { name: string; spacingIn: number; heightIn?: number; look: CropLook }) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(plant?.name ?? initialName);
  const [spacing, setSpacing] = useState(plant ? formatLength(plant.spacingIn) : '12″');
  const [height, setHeight] = useState(plant?.heightIn ? formatLength(plant.heightIn) : '');
  const [look, setLook] = useState<CropLook>({ shape: plant?.look?.shape ?? 'mound', leaf: plant?.look?.leaf ?? 'sage', accent: plant?.look?.accent ?? 'none' });
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const shown = { ...look, ...(plant?.look?.like ? { like: plant.look.like } : {}) };

  function change(set: (v: string) => void, value: string) {
    set(value);
    setError('');
  }

  function save() {
    const read = readCustomPlant({ name, spacing, height });
    if (!read.ok) return setError(read.error);
    onSave({ name: read.name, spacingIn: read.spacingIn, heightIn: read.heightIn, look: shown });
  }

  const label = { display: 'block', font: '600 12px Figtree', marginBottom: 5 } as const;
  const hint = { font: '400 11.5px Figtree', color: 'var(--color-neutral-700)', marginTop: 4 } as const;

  return (
    <div
      role="presentation"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'grid', placeItems: 'center', padding: 16, background: 'color-mix(in srgb, var(--color-neutral-900) 50%, transparent)' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={plant ? 'Edit plant' : 'Add your own plant'}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') save();
        }}
        style={{ width: 'min(520px, 100%)', maxHeight: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, padding: 24, borderRadius: 32, background: 'var(--color-surface)', boxShadow: 'var(--shadow-lg)' }}
      >
        <h2 style={{ font: '700 20px Figtree' }}>{plant ? 'Edit plant' : 'Add your own plant'}</h2>

        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label>
              <span style={label}>Name</span>
              <input className="input" autoFocus value={name} onChange={(e) => change(setName, e.target.value)} style={{ background: 'var(--color-bg)' }} />
            </label>
            <label>
              <span style={label}>Spacing</span>
              <input className="input" value={spacing} onChange={(e) => change(setSpacing, e.target.value)} style={{ background: 'var(--color-bg)' }} />
              <div style={hint}>{lengthHint(spacing, 'apart', 'How far apart to plant', '12″ or 1′ 6″')}</div>
            </label>
            <label>
              <span style={label}>Height</span>
              <input className="input" value={height} onChange={(e) => change(setHeight, e.target.value)} style={{ background: 'var(--color-bg)' }} />
              <div style={hint}>{lengthHint(height, 'tall', 'Optional', '18″ or 3′')}</div>
            </label>
          </div>
          <div style={{ flex: '0 0 150px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 150, height: 150, borderRadius: '50%', background: 'var(--color-bg)', display: 'grid', placeItems: 'center' }}>
              <LookSprite look={shown} diameter={130} />
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, font: '600 13px Figtree' }}>
              <LookSprite look={shown} diameter={28} />
              {name.trim() || 'New plant'}
            </span>
          </div>
        </div>

        {!plant?.look?.like && (
          <>
            <div>
              <span style={label}>Shape</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {SHAPES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-label={s.label}
                    aria-pressed={look.shape === s.id}
                    title={s.label}
                    onClick={() => setLook({ ...look, shape: s.id })}
                    style={{ display: 'grid', placeItems: 'center', gap: 2, padding: '8px 4px', border: `2px solid ${look.shape === s.id ? 'var(--color-accent)' : 'transparent'}`, borderRadius: 16, background: look.shape === s.id ? 'var(--color-accent-100)' : 'var(--color-bg)', cursor: 'pointer', font: '400 11px Figtree', color: 'var(--color-text)' }}
                  >
                    <LookSprite look={{ shape: s.id, leaf: look.leaf, accent: look.accent }} diameter={40} />
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <div>
                <span style={label}>Leaf color</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  {LEAF_COLORS.map((c) => (
                    <button key={c.id} type="button" aria-label={`Leaf color: ${c.id}`} aria-pressed={look.leaf === c.id} onClick={() => setLook({ ...look, leaf: c.id })} style={swatch(look.leaf === c.id, c.c)} />
                  ))}
                </div>
              </div>
              <div>
                <span style={label}>Flower or fruit color</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  {ACCENTS.map((c) => (
                    <button key={c.id} type="button" aria-label={`Flower or fruit: ${c.id}`} aria-pressed={look.accent === c.id} onClick={() => setLook({ ...look, accent: c.id })} style={swatch(look.accent === c.id, c.c ?? 'var(--color-bg)')}>
                      {!c.c && (
                        <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M3 13L13 3" stroke="var(--color-neutral-600)" strokeWidth={2} strokeLinecap="round" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {error && <p role="alert" style={{ font: '600 13px Figtree', color: 'var(--color-warning)' }}>{error}</p>}
        <p style={{ font: '400 11.5px Figtree', color: 'var(--color-neutral-700)' }}>Spacing can be up to {formatLength(MAX_SPACING_IN)}. Your plants are saved on this device and travel with any garden you export.</p>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
          <span>
            {plant && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ color: 'var(--color-warning)', font: '600 13px Figtree' }}
                onClick={() => {
                  if (plantCount > 0 && !confirmDelete) setConfirmDelete(true);
                  else onDelete();
                }}
              >
                {confirmDelete ? `Delete and remove ${plantCount} from garden` : 'Delete plant'}
              </button>
            )}
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={save}>
              {plant ? 'Save' : 'Add plant'}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

/** The definition a saved dialog makes (the app supplies the id). */
export function customCropFrom(id: string, fields: { name: string; spacingIn: number; heightIn?: number; look: CropLook }): CropDef {
  return makeCustomCrop({ id, ...fields });
}
