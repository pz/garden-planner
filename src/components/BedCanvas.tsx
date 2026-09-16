import { useEffect, useMemo, useRef, useState } from 'react';
import { useGarden } from '../state/gardenStore';
import type { PlantInstance } from '../types';
import { getCrop } from '../data/crops';
import { conflictKey, findOverlapConflicts, fitsAt } from '../utils/spacing';
import {
  boundingBox,
  clampGroupDelta,
  computeGhosts,
  computeGroupBoxes,
  lockedAxis,
  GROUP_BOX_PAD_IN,
  AXIS_LOCK_THRESHOLD_FACTOR,
  type Point,
} from '../utils/geometry';
import { PlantToken, LONG_PRESS_MS, MOVE_THRESHOLD_PX, type GestureHandlers } from './PlantToken';
import { PlantMenu } from './PlantMenu';
import { PlantInfoCard } from './PlantInfoCard';
import { PlantingCalendar } from './PlantingCalendar';
import { GardenSwitcher } from './GardenSwitcher';
import { CROP_COLORS } from './PlantMark';
import { ToastStack, type ToastItem } from './ToastStack';

const PX_PER_INCH = 7;
const PLANT_DIAMETER = 26;

function uid(): string {
  return crypto.randomUUID();
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function BedCanvas({ onEditSetup }: { onEditSetup: () => void }) {
  const { plan, addPlants, moveGroup, removePlant, removeGroup, setVariety, dismissConflictsForGroup } = useGarden();
  const { bed, plants, profile } = plan;

  const bedRef = useRef<HTMLDivElement>(null);
  const emptyPressRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; startX: number; startY: number } | null>(
    null,
  );

  const [view, setView] = useState<'bed' | 'calendar'>('bed');
  const [menuState, setMenuState] = useState<{ clientX: number; clientY: number; xIn: number; yIn: number } | null>(
    null,
  );
  const [quickActions, setQuickActions] = useState<{ id: string; clientX: number; clientY: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // A drag moves the whole patch (every plant sharing groupId) rigidly, never a single
  // member on its own — `members` is a snapshot of the group's positions at drag start,
  // and (dx, dy) is the same translation applied to every one of them.
  const [moveState, setMoveState] = useState<{
    groupId: string;
    anchorOriginal: Point;
    members: PlantInstance[];
    dx: number;
    dy: number;
  } | null>(null);
  const [multiply, setMultiply] = useState<{ id: string; origin: Point; axis: Point | null; ghosts: Point[] } | null>(
    null,
  );

  const conflicts = useMemo(() => findOverlapConflicts(plants), [plants]);
  const dismissedKeys = useMemo(() => new Set(plan.dismissedConflictKeys), [plan.dismissedConflictKeys]);
  const warnedGroupIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of conflicts) {
      if (!dismissedKeys.has(conflictKey(c.a, c.b))) {
        s.add(c.a);
        s.add(c.b);
      }
    }
    return s;
  }, [conflicts, dismissedKeys]);
  const groupSizes = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of plants) m.set(p.groupId, (m.get(p.groupId) ?? 0) + 1);
    return m;
  }, [plants]);

  // Apply the live move-preview offset so a dragged patch's bounding box (and every
  // member plant) tracks the pointer together, instead of only the grabbed one.
  const effectivePlants = useMemo(
    () =>
      plants.map((p) =>
        moveState && p.groupId === moveState.groupId ? { ...p, x: p.x + moveState.dx, y: p.y + moveState.dy } : p,
      ),
    [plants, moveState],
  );

  const groupBoxes = useMemo(() => computeGroupBoxes(effectivePlants), [effectivePlants]);

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  // Backspace/Delete removes the selected plant, with an undo toast — but only when
  // focus isn't in a text field (e.g. the variety input), where the key should type normally.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      if (!selectedId) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const plant = plants.find((p) => p.id === selectedId);
      if (!plant) return;
      e.preventDefault();
      removePlant(plant.id);
      setSelectedId(null);
      setToasts((prev) => [
        ...prev,
        { id: uid(), message: `Removed ${getCrop(plant.cropId).name}`, onUndo: () => addPlants([plant]) },
      ]);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, plants, removePlant, addPlants]);

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
      if (!p) return;
      const members = plants.filter((pl) => pl.groupId === p.groupId);
      setMoveState({ groupId: p.groupId, anchorOriginal: { x: p.x, y: p.y }, members, dx: 0, dy: 0 });
    },
    onMoveUpdate: (_id, clientX, clientY) => {
      const coords = toBedCoords(clientX, clientY);
      if (!coords) return;
      setMoveState((prev) => {
        if (!prev) return prev;
        const rawDx = coords.x - prev.anchorOriginal.x;
        const rawDy = coords.y - prev.anchorOriginal.y;
        const { x: dx, y: dy } = clampGroupDelta(prev.members, rawDx, rawDy, bed.widthIn, bed.heightIn);
        return { ...prev, dx, dy };
      });
    },
    onMoveEnd: (_id, committed) => {
      if (committed && moveState && (moveState.dx !== 0 || moveState.dy !== 0)) {
        moveGroup(moveState.groupId, moveState.dx, moveState.dy);
      }
      setMoveState(null);
    },
    onMultiplyStart: (id) => {
      const p = plants.find((pl) => pl.id === id);
      if (p) setMultiply({ id, origin: { x: p.x, y: p.y }, axis: null, ghosts: [] });
    },
    onMultiplyUpdate: (id, clientX, clientY) => {
      const coords = toBedCoords(clientX, clientY);
      const p = plants.find((pl) => pl.id === id);
      if (!coords || !p) return;
      const spacing = getCrop(p.cropId).spacingIn;
      setMultiply((prev) => {
        if (!prev || prev.id !== id) return prev;
        const dx = coords.x - prev.origin.x;
        const dy = coords.y - prev.origin.y;
        let axis = prev.axis;
        if (!axis && Math.hypot(dx, dy) >= spacing * AXIS_LOCK_THRESHOLD_FACTOR) {
          axis = lockedAxis(dx, dy);
        }
        if (!axis) return { ...prev, ghosts: [] };
        const ghosts = computeGhosts(prev.origin, axis, coords, spacing, bed.widthIn, bed.heightIn);
        return { ...prev, axis, ghosts };
      });
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
    return { cropId: origin.cropId, ...boundingBox(points, GROUP_BOX_PAD_IN) };
  }, [multiply, plants]);

  const selectedPlant = selectedId ? plants.find((p) => p.id === selectedId) ?? null : null;
  const groupCount = selectedPlant ? plants.filter((p) => p.groupId === selectedPlant.groupId).length : 0;
  const quickActionsPlant = quickActions ? plants.find((p) => p.id === quickActions.id) ?? null : null;

  const gridPx = PX_PER_INCH * 12;

  return (
    <div style={{ padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <GardenSwitcher variant="title" onEditSetup={onEditSetup} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <ViewTab label="Bed layout" active={view === 'bed'} onClick={() => setView('bed')} />
            <ViewTab label="Planting calendar" active={view === 'calendar'} onClick={() => setView('calendar')} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <p style={{ font: '400 13px Figtree', color: 'var(--color-text-muted)' }}>
            {bed.widthIn / 12}′ × {bed.heightIn / 12}′ bed · {profile.sunExposure.replace('-', ' ')}
          </p>
          <HelpTip text="Long-press or right-click anywhere on the bed to plant." />
        </div>
      </div>

      {view === 'calendar' && <PlantingCalendar plants={plants} zoneId={profile.zoneId} />}

      {view === 'bed' && (
        <>
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
              <GroupBoundingBox
                key={box.groupId}
                box={box}
                pxPerInch={PX_PER_INCH}
                warned={warnedGroupIds.has(box.groupId)}
              />
            ))}
            {multiplyBox && <GroupBoundingBox box={multiplyBox} pxPerInch={PX_PER_INCH} active />}

            {effectivePlants.map((p) => {
              const isMultiplyOrigin = multiply?.id === p.id;
              const isSolo = (groupSizes.get(p.groupId) ?? 1) === 1;
              return (
                <div key={p.id} style={{ opacity: isMultiplyOrigin ? 0.85 : 1 }}>
                  <PlantToken
                    plant={p}
                    pxPerInch={PX_PER_INCH}
                    diameter={PLANT_DIAMETER}
                    warned={isSolo && warnedGroupIds.has(p.groupId)}
                    selected={p.id === selectedId}
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
              warned={warnedGroupIds.has(selectedPlant.groupId)}
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
              onDismissConflict={() => dismissConflictsForGroup(selectedPlant.groupId)}
            />
          )}
        </>
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

function HelpTip({ text }: { text: string }) {
  return (
    <span
      title={text}
      aria-label={text}
      role="img"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        width: 15,
        height: 15,
        borderRadius: '999px',
        border: '1.5px solid var(--color-text-muted)',
        color: 'var(--color-text-muted)',
        font: '600 10px Figtree',
        cursor: 'help',
      }}
    >
      ?
    </span>
  );
}

function ViewTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={active ? 'btn btn-primary' : 'btn btn-secondary'}
      style={{ padding: '8px 14px', font: '600 12.5px Figtree' }}
    >
      {label}
    </button>
  );
}

function GroupBoundingBox({
  box,
  pxPerInch,
  active = false,
  warned = false,
}: {
  box: { cropId: string; left: number; top: number; width: number; height: number };
  pxPerInch: number;
  active?: boolean;
  warned?: boolean;
}) {
  const color = CROP_COLORS[box.cropId] ?? 'var(--color-text)';
  return (
    <div
      style={{
        position: 'absolute',
        left: box.left * pxPerInch,
        top: box.top * pxPerInch,
        width: box.width * pxPerInch,
        height: box.height * pxPerInch,
        border: `1.5px dashed ${warned ? 'var(--color-warning)' : color}`,
        borderRadius: 'var(--radius-md)',
        background: `color-mix(in oklch, ${color} ${active ? 10 : 6}%, transparent)`,
        opacity: active ? 0.9 : 1,
        pointerEvents: 'none',
      }}
    >
      {warned && (
        <div
          style={{
            position: 'absolute',
            top: -8,
            right: -8,
            width: 18,
            height: 18,
            borderRadius: '999px',
            background: 'var(--color-warning)',
            color: '#fffdf8',
            font: '700 11px Figtree',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1.5px solid #fffdf8',
          }}
        >
          !
        </div>
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
