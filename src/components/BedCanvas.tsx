import { useEffect, useMemo, useRef, useState } from 'react';
import { useGarden } from '../state/gardenStore';
import { getCrop } from '../data/crops';
import { findOverlapWarnings, fitsAt } from '../utils/spacing';
import { PlantToken, LONG_PRESS_MS, MOVE_THRESHOLD_PX, type GestureHandlers } from './PlantToken';
import { PlantMenu } from './PlantMenu';
import { PlantInfoCard } from './PlantInfoCard';
import { CROP_COLORS } from './PlantMark';

const PX_PER_INCH = 7;
const PLANT_DIAMETER = 26;

function uid(): string {
  return crypto.randomUUID();
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

interface Point {
  x: number;
  y: number;
}

function computeGhosts(origin: Point, cursor: Point, spacingIn: number, boundW: number, boundH: number): Point[] {
  const dx = cursor.x - origin.x;
  const dy = cursor.y - origin.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < spacingIn * 0.6) return [];
  const steps = Math.floor(dist / spacingIn);
  const ux = dx / dist;
  const uy = dy / dist;
  const pts: Point[] = [];
  for (let i = 1; i <= steps; i++) {
    const x = origin.x + ux * spacingIn * i;
    const y = origin.y + uy * spacingIn * i;
    const r = spacingIn / 2;
    if (x - r < 0 || y - r < 0 || x + r > boundW || y + r > boundH) continue;
    pts.push({ x, y });
  }
  return pts;
}

export function BedCanvas({ onEditSetup }: { onEditSetup: () => void }) {
  const { plan, addPlants, movePlant, removePlant, removeGroup, setVariety, dismissWarning } = useGarden();
  const { bed, plants, profile } = plan;

  const bedRef = useRef<HTMLDivElement>(null);
  const emptyPressRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; startX: number; startY: number } | null>(
    null,
  );

  const [menuState, setMenuState] = useState<{ clientX: number; clientY: number; xIn: number; yIn: number } | null>(
    null,
  );
  const [quickActions, setQuickActions] = useState<{ id: string; clientX: number; clientY: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [movePreview, setMovePreview] = useState<{ id: string; x: number; y: number } | null>(null);
  const [multiply, setMultiply] = useState<{ id: string; origin: Point; ghosts: Point[] } | null>(null);

  const warned = useMemo(() => findOverlapWarnings(plants), [plants]);

  function toBedCoords(clientX: number, clientY: number): Point | null {
    if (!bedRef.current) return null;
    const rect = bedRef.current.getBoundingClientRect();
    return {
      x: clamp((clientX - rect.left) / PX_PER_INCH, 0, bed.widthIn),
      y: clamp((clientY - rect.top) / PX_PER_INCH, 0, bed.heightIn),
    };
  }

  function openMenuAt(clientX: number, clientY: number) {
    const coords = toBedCoords(clientX, clientY);
    if (!coords) return;
    setSelectedId(null);
    setMenuState({ clientX, clientY, xIn: coords.x, yIn: coords.y });
  }

  function handleBedContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    openMenuAt(e.clientX, e.clientY);
  }

  function handleBedPointerDown(e: React.PointerEvent) {
    if (e.target !== bedRef.current) return; // ignore bubbled events from plants
    if (e.button === 2) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const timer = setTimeout(() => {
      openMenuAt(startX, startY);
      emptyPressRef.current = null;
    }, LONG_PRESS_MS);
    emptyPressRef.current = { timer, startX, startY };
  }

  function handleBedPointerMove(e: React.PointerEvent) {
    const st = emptyPressRef.current;
    if (!st) return;
    const dist = Math.hypot(e.clientX - st.startX, e.clientY - st.startY);
    if (dist > MOVE_THRESHOLD_PX && st.timer) {
      clearTimeout(st.timer);
      emptyPressRef.current = null;
    }
  }

  function handleBedPointerUp() {
    const st = emptyPressRef.current;
    if (st?.timer) clearTimeout(st.timer);
    emptyPressRef.current = null;
  }

  const gestureHandlers: GestureHandlers = {
    onSelect: (id) => {
      setSelectedId(id);
      setQuickActions(null);
    },
    onQuickActions: (id, clientX, clientY) => setQuickActions({ id, clientX, clientY }),
    onMoveStart: (id) => {
      const p = plants.find((pl) => pl.id === id);
      if (p) setMovePreview({ id, x: p.x, y: p.y });
    },
    onMoveUpdate: (id, clientX, clientY) => {
      const coords = toBedCoords(clientX, clientY);
      if (coords) setMovePreview({ id, x: coords.x, y: coords.y });
    },
    onMoveEnd: (id, committed) => {
      if (committed && movePreview && movePreview.id === id) {
        movePlant(id, movePreview.x, movePreview.y);
      }
      setMovePreview(null);
    },
    onMultiplyStart: (id) => {
      const p = plants.find((pl) => pl.id === id);
      if (p) setMultiply({ id, origin: { x: p.x, y: p.y }, ghosts: [] });
    },
    onMultiplyUpdate: (id, clientX, clientY) => {
      const coords = toBedCoords(clientX, clientY);
      const p = plants.find((pl) => pl.id === id);
      if (!coords || !p) return;
      const spacing = getCrop(p.cropId).spacingIn;
      setMultiply((prev) =>
        prev && prev.id === id
          ? { ...prev, ghosts: computeGhosts(prev.origin, coords, spacing, bed.widthIn, bed.heightIn) }
          : prev,
      );
    },
    onMultiplyEnd: (id, committed) => {
      if (committed && multiply && multiply.id === id && multiply.ghosts.length > 0) {
        const origin = plants.find((pl) => pl.id === id);
        if (origin) {
          addPlants(
            multiply.ghosts.map((g) => ({
              id: uid(),
              cropId: origin.cropId,
              x: g.x,
              y: g.y,
              groupId: origin.groupId,
            })),
          );
        }
      }
      setMultiply(null);
    },
  };

  const selectedPlant = selectedId ? plants.find((p) => p.id === selectedId) ?? null : null;
  const groupCount = selectedPlant ? plants.filter((p) => p.groupId === selectedPlant.groupId).length : 0;
  const quickActionsPlant = quickActions ? plants.find((p) => p.id === quickActions.id) ?? null : null;

  const gridPx = PX_PER_INCH * 12;

  return (
    <div style={{ padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 22 }}>{bed.name}</h1>
          <p style={{ font: '400 13px Figtree', color: 'var(--color-text-muted)', marginTop: 4 }}>
            {bed.widthIn / 12}′ × {bed.heightIn / 12}′ bed · {profile.sunExposure.replace('-', ' ')} · long-press or
            right-click anywhere to plant
          </p>
        </div>
        <button onClick={onEditSetup} className="btn btn-secondary">
          Edit setup
        </button>
      </div>

      <div
        ref={bedRef}
        onContextMenu={handleBedContextMenu}
        onPointerDown={handleBedPointerDown}
        onPointerMove={handleBedPointerMove}
        onPointerUp={handleBedPointerUp}
        style={{
          position: 'relative',
          width: bed.widthIn * PX_PER_INCH,
          maxWidth: '100%',
          height: bed.heightIn * PX_PER_INCH,
          border: '2.5px solid var(--color-text)',
          borderRadius: 'var(--radius-lg)',
          background: `repeating-linear-gradient(90deg, transparent 0 ${gridPx - 1}px, #e6dbc6 ${gridPx - 1}px ${gridPx}px), repeating-linear-gradient(0deg, #f6efe0 0 ${gridPx - 1}px, #efe6d2 ${gridPx - 1}px ${gridPx}px)`,
          touchAction: 'none',
          userSelect: 'none',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        {plants.map((p) => {
          const isMoving = movePreview?.id === p.id;
          const isMultiplyOrigin = multiply?.id === p.id;
          const renderPlant = isMoving ? { ...p, x: movePreview!.x, y: movePreview!.y } : p;
          return (
            <div key={p.id} style={{ opacity: isMultiplyOrigin ? 0.85 : 1 }}>
              <PlantToken
                plant={renderPlant}
                pxPerInch={PX_PER_INCH}
                diameter={PLANT_DIAMETER}
                warned={warned.has(p.id) && !p.warningDismissed}
                handlers={gestureHandlers}
              />
            </div>
          );
        })}

        {multiply?.ghosts.map((g, i) => {
          const origin = plants.find((p) => p.id === multiply.id);
          if (!origin) return null;
          const color = CROP_COLORS[origin.cropId];
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: g.x * PX_PER_INCH,
                top: g.y * PX_PER_INCH,
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'none',
                opacity: 0.55,
              }}
            >
              <div
                style={{
                  border: `1.5px dashed ${color}`,
                  borderRadius: '999px',
                  width: PLANT_DIAMETER,
                  height: PLANT_DIAMETER,
                }}
              />
            </div>
          );
        })}

        {multiply && multiply.ghosts.length > 0 && (
          <div
            style={{
              position: 'absolute',
              left: 12,
              bottom: 12,
              background: 'var(--color-text)',
              color: '#fffdf8',
              borderRadius: '999px',
              padding: '5px 12px',
              font: '600 12px Figtree',
              pointerEvents: 'none',
            }}
          >
            +{multiply.ghosts.length}
          </div>
        )}

        {plants.length === 0 && !menuState && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
              padding: 24,
              textAlign: 'center',
            }}
          >
            <p style={{ font: '400 17px Caveat, cursive', color: '#9a8c76', maxWidth: 320 }}>
              Empty so far — long-press or right-click the bed to plant something.
            </p>
          </div>
        )}
      </div>

      {menuState && (
        <PlantMenu
          clientX={menuState.clientX}
          clientY={menuState.clientY}
          bedXIn={menuState.xIn}
          bedYIn={menuState.yIn}
          bedWidthIn={bed.widthIn}
          bedHeightIn={bed.heightIn}
          existingPlants={plants}
          onPick={(cropId) => {
            addPlants([{ id: uid(), cropId, x: menuState.xIn, y: menuState.yIn, groupId: uid() }]);
            setMenuState(null);
          }}
          onClose={() => setMenuState(null)}
        />
      )}

      {quickActionsPlant && quickActions && (
        <QuickActionsPopover
          clientX={quickActions.clientX}
          clientY={quickActions.clientY}
          onClose={() => setQuickActions(null)}
          onRemove={() => {
            removePlant(quickActionsPlant.id);
            setQuickActions(null);
          }}
          onDuplicate={() => {
            const spacing = getCrop(quickActionsPlant.cropId).spacingIn;
            const nx = clamp(quickActionsPlant.x + spacing * 0.8, 0, bed.widthIn);
            const ny = clamp(quickActionsPlant.y, 0, bed.heightIn);
            if (fitsAt(nx, ny, spacing, bed.widthIn, bed.heightIn, plants)) {
              addPlants([{ id: uid(), cropId: quickActionsPlant.cropId, x: nx, y: ny, groupId: uid() }]);
            }
            setQuickActions(null);
          }}
        />
      )}

      {selectedPlant && (
        <PlantInfoCard
          plant={selectedPlant}
          zoneId={profile.zoneId}
          warned={warned.has(selectedPlant.id) && !selectedPlant.warningDismissed}
          groupCount={groupCount}
          onClose={() => setSelectedId(null)}
          onSetVariety={(variety) => setVariety(selectedPlant.id, variety)}
          onRemove={() => {
            removePlant(selectedPlant.id);
            setSelectedId(null);
          }}
          onRemoveGroup={() => {
            removeGroup(selectedPlant.groupId);
            setSelectedId(null);
          }}
          onDismissWarning={() => dismissWarning(selectedPlant.id)}
        />
      )}
    </div>
  );
}

function QuickActionsPopover({
  clientX,
  clientY,
  onClose,
  onRemove,
  onDuplicate,
}: {
  clientX: number;
  clientY: number;
  onClose: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [onClose]);

  return (
    <div
      ref={ref}
      onPointerDownCapture={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: clientX,
        top: clientY,
        zIndex: 50,
        background: 'var(--color-text)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-lg)',
        overflow: 'hidden',
        display: 'flex',
      }}
    >
      <button
        onClick={onDuplicate}
        style={{ border: 'none', background: 'none', color: '#fffdf8', padding: '9px 14px', font: '600 12px Figtree' }}
      >
        Duplicate
      </button>
      <button
        onClick={onRemove}
        style={{ border: 'none', background: 'none', color: '#ffb4a3', padding: '9px 14px', font: '600 12px Figtree' }}
      >
        Remove
      </button>
      <button
        onClick={onClose}
        style={{ border: 'none', background: 'none', color: '#c8c0b3', padding: '9px 12px', font: '600 12px Figtree' }}
      >
        ✕
      </button>
    </div>
  );
}
