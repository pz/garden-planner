import { useEffect, useMemo, useRef, useState } from 'react';
import { useGarden } from '../state/gardenStore';
import type { PlantInstance } from '../types';
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

interface GroupBox {
  groupId: string;
  cropId: string;
  /** Center of the box, in inches. */
  centerX: number;
  centerY: number;
  /** Extent along the box's own axes, in inches (not world-axis-aligned). */
  width: number;
  height: number;
  /** Rotation of the box's width-axis from the world x-axis, in degrees. */
  angleDeg: number;
}

const GROUP_BOX_PAD_IN = 3;

/**
 * Minimum-footprint oriented bounding box around a set of circles, so a diagonal
 * line of plants gets a diagonal box instead of an axis-aligned one that balloons
 * to fit the diagonal. Orientation comes from the points' principal axis (PCA on
 * the 2x2 covariance matrix) — exact for a line of points, and a reasonable
 * best-fit for any other cluster shape.
 */
function computeOrientedBox(
  points: { x: number; y: number; r: number }[],
  padIn: number,
): Omit<GroupBox, 'groupId' | 'cropId'> {
  const n = points.length;
  const cx = points.reduce((sum, p) => sum + p.x, 0) / n;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / n;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const u = dx * cosA + dy * sinA;
    const v = -dx * sinA + dy * cosA;
    minU = Math.min(minU, u - p.r);
    maxU = Math.max(maxU, u + p.r);
    minV = Math.min(minV, v - p.r);
    maxV = Math.max(maxV, v + p.r);
  }

  const localCenterU = (minU + maxU) / 2;
  const localCenterV = (minV + maxV) / 2;
  return {
    centerX: cx + localCenterU * cosA - localCenterV * sinA,
    centerY: cy + localCenterU * sinA + localCenterV * cosA,
    width: maxU - minU + padIn * 2,
    height: maxV - minV + padIn * 2,
    angleDeg: (angle * 180) / Math.PI,
  };
}

/** One bounding box per patch (a groupId shared by more than one plant) so it reads as a single entity. */
function computeGroupBoxes(plants: PlantInstance[]): GroupBox[] {
  const byGroup = new Map<string, PlantInstance[]>();
  for (const p of plants) {
    const members = byGroup.get(p.groupId);
    if (members) members.push(p);
    else byGroup.set(p.groupId, [p]);
  }
  const boxes: GroupBox[] = [];
  for (const [groupId, members] of byGroup) {
    if (members.length < 2) continue;
    const points = members.map((m) => ({ x: m.x, y: m.y, r: getCrop(m.cropId).spacingIn / 2 }));
    boxes.push({ groupId, cropId: members[0].cropId, ...computeOrientedBox(points, GROUP_BOX_PAD_IN) });
  }
  return boxes;
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

  // Apply the live move-preview position so a dragged patch member's bounding box
  // (and the plant itself) tracks the pointer instead of its last-committed spot.
  const effectivePlants = useMemo(
    () => plants.map((p) => (movePreview?.id === p.id ? { ...p, x: movePreview.x, y: movePreview.y } : p)),
    [plants, movePreview],
  );

  const groupBoxes = useMemo(() => computeGroupBoxes(effectivePlants), [effectivePlants]);

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

  // Live bounding box while a patch is actively being dragged out, so it reads as
  // one entity from the first ghost rather than only once the drag is released.
  const multiplyBox = useMemo(() => {
    if (!multiply || multiply.ghosts.length === 0) return null;
    const origin = plants.find((p) => p.id === multiply.id);
    if (!origin) return null;
    const r = getCrop(origin.cropId).spacingIn / 2;
    const points = [multiply.origin, ...multiply.ghosts].map((pt) => ({ x: pt.x, y: pt.y, r }));
    return { cropId: origin.cropId, ...computeOrientedBox(points, GROUP_BOX_PAD_IN) };
  }, [multiply, plants]);

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
        {groupBoxes.map((box) => (
          <GroupBoundingBox key={box.groupId} box={box} pxPerInch={PX_PER_INCH} />
        ))}
        {multiplyBox && <GroupBoundingBox box={multiplyBox} pxPerInch={PX_PER_INCH} active />}

        {effectivePlants.map((p) => {
          const isMultiplyOrigin = multiply?.id === p.id;
          return (
            <div key={p.id} style={{ opacity: isMultiplyOrigin ? 0.85 : 1 }}>
              <PlantToken
                plant={p}
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

function GroupBoundingBox({
  box,
  pxPerInch,
  active = false,
}: {
  box: { cropId: string; centerX: number; centerY: number; width: number; height: number; angleDeg: number };
  pxPerInch: number;
  active?: boolean;
}) {
  const color = CROP_COLORS[box.cropId] ?? 'var(--color-text)';
  return (
    <div
      style={{
        position: 'absolute',
        left: box.centerX * pxPerInch,
        top: box.centerY * pxPerInch,
        width: box.width * pxPerInch,
        height: box.height * pxPerInch,
        transform: `translate(-50%, -50%) rotate(${box.angleDeg}deg)`,
        border: `1.5px dashed ${color}`,
        borderRadius: 'var(--radius-md)',
        background: `color-mix(in oklch, ${color} ${active ? 10 : 6}%, transparent)`,
        opacity: active ? 0.9 : 1,
        pointerEvents: 'none',
      }}
    />
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
