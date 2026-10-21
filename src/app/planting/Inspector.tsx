import { useState, type ReactNode } from 'react';
import { getCrop } from '../../data/crops';
import type { Warning, WarningKind } from '../../api/types';
import { getTip } from '../../data/tips';
import { getZone } from '../../data/zones';
import { formatDate, scheduleFor } from '../../core/dates';
import type { SelectionSummary } from '../../core/selectionSummary';
import { Icon, type IconName } from '../components/Icon';
import { PlantMark } from '../components/PlantMark';
import { formatLength } from '../layoutInteraction';
import { useDismissedTip } from '../state/dismissedTipsStore';
import { familyLabel } from '../families';
import { MOD } from './keys';

const WARNING_TITLES: Record<Exclude<WarningKind, 'spacing'>, string> = {
  shade: '! In shade from a neighbor',
  companion: '! Usually kept apart',
};

const SOW_LABEL = { transplant: 'Transplant', 'direct-sow': 'Direct sow' } as const;

export function selectionTitle(s: SelectionSummary): string {
  if (s.cropId) {
    const name = getCrop(s.cropId).name;
    return s.kind === 'plant' ? name : s.kind === 'patch' ? `${name} patch` : `${s.count} ${name.toLowerCase()} plants`;
  }
  return s.mixedPatch ? 'Mixed patch' : `${s.count} plants`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, font: '400 13.5px Figtree' }}>
      <span style={{ color: 'var(--color-neutral-700)' }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function Action({ icon, label, hint, onClick, quiet }: { icon: IconName; label: string; hint?: string; onClick: () => void; quiet?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn btn-secondary"
      style={{
        width: '100%',
        justifyContent: 'center',
        padding: '9px 14px',
        font: '600 13.5px Figtree',
        ...(quiet ? { background: 'var(--color-neutral-300)', borderColor: 'transparent' } : {}),
      }}
    >
      <Icon name={icon} size={16} />
      {label}
      {hint && <span style={{ font: '400 11.5px Figtree', opacity: 0.6 }}>{hint}</span>}
    </button>
  );
}

/** The right-hand panel for the selection: what it is, how it's spaced, and what can be done with it. */
export function Inspector({
  summary,
  zoneId,
  variety,
  warnings,
  onClose,
  onSetVariety,
  onDismissWarning,
  onSelectPatch,
  onGroup,
  onUngroup,
  onDuplicate,
  onDelete,
}: {
  summary: SelectionSummary;
  zoneId: string;
  /** Of the one selected plant; undefined for a selection of several. */
  variety: string | undefined;
  /** The warnings about the selected patches that haven't been dismissed. */
  warnings: Warning[];
  onClose: () => void;
  onSetVariety: (variety: string | undefined) => void;
  onDismissWarning: () => void;
  onSelectPatch: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const crop = summary.cropId ? getCrop(summary.cropId) : null;
  const title = selectionTitle(summary);
  const single = summary.kind === 'plant' && crop;
  const [draft, setDraft] = useState<{ key: string; text: string } | null>(null);
  const draftKey = `${summary.cropId}:${variety ?? ''}`;
  const text = draft && draft.key === draftKey ? draft.text : variety ?? '';
  const tip = crop ? getTip(crop.id) : undefined;
  const tipState = useDismissedTip(crop?.id ?? '');
  const schedule = crop ? scheduleFor(crop, getZone(zoneId), new Date().getFullYear()) : null;

  const stats: ReactNode[] = [];
  if (summary.count > 1) stats.push(<Stat key="n" label="Plants" value={String(summary.count)} />);
  if (summary.spacingIn !== null) stats.push(<Stat key="sp" label="Spacing" value={formatLength(summary.spacingIn)} />);
  if (summary.areaIn) stats.push(<Stat key="ar" label="Area" value={`${formatLength(summary.areaIn.w)} × ${formatLength(summary.areaIn.h)}`} />);
  if (summary.harvestDays !== null) stats.push(<Stat key="hv" label="Harvest" value={`~${summary.harvestDays} days`} />);
  stats.push(<Stat key="bd" label={summary.bedNames.length > 1 ? 'Beds' : 'Bed'} value={summary.bedNames.join(', ')} />);

  return (
    <aside
      aria-label="Selection"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        right: 16,
        top: 16,
        maxHeight: 'calc(100% - 96px)',
        width: 300,
        zIndex: 4,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRadius: 28,
        background: 'var(--color-surface)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', background: 'var(--color-bg)' }}>
        <button type="button" onClick={onClose} aria-label="Deselect" title="Deselect (Esc)" style={{ border: 'none', background: 'none', padding: 4, color: 'var(--color-text)', display: 'flex' }}>
          <Icon name="back" size={18} />
        </button>
        <h2 style={{ font: '700 19px Figtree', margin: 0 }}>{title}</h2>
      </div>

      <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
        {crop ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--color-bg)', display: 'grid', placeItems: 'center' }}>
              <PlantMark cropId={crop.id} diameter={46} />
            </span>
            <div>
              <div style={{ font: '600 14px Figtree' }}>{familyLabel(crop.family)}</div>
              <div style={{ font: '400 13px Figtree', color: 'var(--color-neutral-700)' }}>{SOW_LABEL[crop.sowMethod]}</div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {summary.crops.map((c) => (
              <div key={c.cropId} style={{ display: 'flex', alignItems: 'center', gap: 10, font: '400 13.5px Figtree' }}>
                <PlantMark cropId={c.cropId} diameter={24} />
                <span style={{ flex: 1 }}>{getCrop(c.cropId).name}</span>
                <span style={{ color: 'var(--color-neutral-700)' }}>×{c.count}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{stats}</div>

        {summary.partOfPatch && (
          <div style={{ font: '400 13px Figtree', color: 'var(--color-neutral-700)' }}>
            One plant from a patch of {summary.partOfPatch}.{' '}
            <button type="button" onClick={onSelectPatch} style={{ border: 'none', background: 'none', padding: 0, font: '600 13px Figtree', color: 'var(--color-accent-700)', cursor: 'pointer' }}>
              Select patch
            </button>
          </div>
        )}

        {warnings.length > 0 && (
          <div style={{ background: 'color-mix(in srgb, var(--color-warning) 10%, transparent)', border: '1.5px solid var(--color-warning)', borderRadius: 'var(--radius-md)', padding: '10px 12px' }}>
            {warnings.some((w) => w.kind === 'spacing') && crop && (
              <>
                <p style={{ font: '600 12.5px Figtree', color: 'var(--color-warning)', marginBottom: 6 }}>
                  ! {summary.count > 1 ? 'This patch is' : 'Planted'} too close to a neighbor
                </p>
                <p style={{ font: '400 11.5px/1.4 Figtree', color: 'var(--color-text-muted)', marginBottom: 8 }}>
                  {crop.name} wants at least {crop.spacingIn}" from the next plant or patch. Move {summary.count > 1 ? 'this patch' : 'one of them'} apart, or dismiss if you're fine with it.
                </p>
              </>
            )}
            {warnings
              .filter((w) => w.kind !== 'spacing')
              .map((w) => (
                <div key={w.id} style={{ marginBottom: 8 }}>
                  <p style={{ font: '600 12.5px Figtree', color: 'var(--color-warning)', marginBottom: 4 }}>{WARNING_TITLES[w.kind as Exclude<WarningKind, 'spacing'>]}</p>
                  <p style={{ font: '400 11.5px/1.4 Figtree', color: 'var(--color-text-muted)' }}>
                    {w.message}
                    {w.suggestion ? ` ${w.suggestion}` : ''}
                  </p>
                </div>
              ))}
            <button type="button" onClick={onDismissWarning} className="btn btn-secondary" style={{ padding: '5px 12px', font: '600 11.5px Figtree' }}>
              Dismiss this warning
            </button>
          </div>
        )}

        {single && (
          <label>
            <span style={{ display: 'block', font: '600 12px Figtree', marginBottom: 6 }}>Variety (optional)</span>
            <input
              className="input"
              value={text}
              placeholder="e.g. Cherokee Purple"
              onChange={(e) => setDraft({ key: draftKey, text: e.target.value })}
              onBlur={() => {
                const next = text.trim() || undefined;
                if (next !== variety) onSetVariety(next);
                setDraft(null);
              }}
              style={{ background: 'var(--color-bg)' }}
            />
          </label>
        )}

        {crop && schedule && (
          <div>
            <span style={{ display: 'block', font: '600 12px Figtree', marginBottom: 8 }}>Planting &amp; harvest</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {schedule.startIndoors && <Stat label="Start indoors" value={formatDate(schedule.startIndoors)} />}
              <Stat label={schedule.sowOrTransplantLabel} value={formatDate(schedule.sowOrTransplant)} />
              <Stat label="Expected harvest" value={formatDate(schedule.harvest)} />
            </div>
          </div>
        )}

        {crop && tip && !tipState.dismissed && (
          <div style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', padding: '10px 12px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <p style={{ flex: 1, font: '400 13px/1.5 Figtree', color: '#6b6155' }}>{tip}</p>
            <button type="button" onClick={tipState.dismiss} aria-label="Dismiss tip" title="Dismiss tip" style={{ border: 'none', background: 'none', color: 'var(--color-text-muted)', padding: 2, display: 'flex' }}>
              <Icon name="x" size={14} />
            </button>
          </div>
        )}
        {crop && tip && tipState.dismissed && (
          <button type="button" onClick={tipState.restore} style={{ alignSelf: 'flex-start', border: 'none', background: 'none', padding: 0, font: '400 12px Figtree', color: 'var(--color-text-muted)', textDecoration: 'underline', cursor: 'pointer' }}>
            Show growing tip
          </button>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {summary.canGroup && <Action icon="group" label="Group into patch" hint={`${MOD}G`} onClick={onGroup} />}
          {summary.canUngroup && <Action icon="ungroup" label="Ungroup" hint={`⇧${MOD}G`} onClick={onUngroup} />}
          <Action icon="copy" label="Duplicate" hint={`${MOD}D`} onClick={onDuplicate} />
          <Action icon="trash" label={summary.count > 1 ? `Delete ${summary.count} plants` : 'Delete plant'} onClick={onDelete} quiet />
        </div>
      </div>
    </aside>
  );
}
