import { useEffect, useMemo, useRef, useState } from 'react';
import { useGarden } from '../state/gardenStore';
import type { PlantInstance } from '../types';
import { getCrop } from '../data/crops';
import { conflictKey, findOverlapConflicts, fitsAt } from '../utils/spacing';
import {
  boundingBox,
  clampGroupDelta,
  clampPan,
  clampZoom,
  clientToBedCoords,
  computeFitZoom,
  computeGhosts,
  computeGroupBoxes,
  contentPointAt,
  lockedAxis,
  panToAlign,
  GROUP_BOX_PAD_IN,
  AXIS_LOCK_THRESHOLD_FACTOR,
  type Point,
  type Size,
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

  // Single-pointer gesture on empty bed background: starts as a pending long-press (to open
  // the add-plant menu) and switches to a pan the moment it moves past the threshold — the
  // same "held still" vs. "dragging" split PlantToken uses for move vs. multiply.
  const emptyGestureRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    mode: 'pending' | 'panning';
    startPan: Point;
    timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);

  // Two-finger pinch-to-zoom, tracked independently of the single-pointer gesture above —
  // a second finger touching down always cancels it and takes over.
  const pinchRef = useRef<{
    idA: number;
    idB: number;
    startDist: number;
    startZoom: number;
    // The bed-space (unscaled content px) point under the pinch's midpoint at gesture start,
    // kept fixed under the *current* midpoint as fingers move — lets one continuous gesture
    // pan and zoom together, the same way a real pinch does.
    anchorContentPx: Point;
  } | null>(null);
  const activePointersRef = useRef<Map<number, Point>>(new Map());

  const [view, setView] = useState<'bed' | 'calendar'>('bed');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [viewportSize, setViewportSize] = useState<Size>({ width: 0, height: 0 });
  const [isPanning, setIsPanning] = useState(false);
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

  // The bed's true (unscaled) pixel size — fixed regardless of window width. Panning and
  // zooming happen around this, instead of the bed itself resizing to fit the viewport.
  const contentSize: Size = useMemo(
    () => ({ width: bed.widthIn * PX_PER_INCH, height: bed.heightIn * PX_PER_INCH }),
    [bed.widthIn, bed.heightIn],
  );
  const scaledContentSize: Size = useMemo(
    () => ({ width: contentSize.width * zoom, height: contentSize.height * zoom }),
    [contentSize, zoom],
  );
  // Lets the resize observer below read the latest zoom without re-subscribing on every change.
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // A narrower window no longer shrinks the bed — it just reveals less of it. Re-clamp pan
  // right where the resize is observed, so the viewport never ends up showing empty margin
  // where content should be.
  useEffect(() => {
    const el = bedRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const nextViewportSize = { width: entry.contentRect.width, height: entry.contentRect.height };
      setViewportSize(nextViewportSize);
      setPan((prev) =>
        clampPan(prev, nextViewportSize, {
          width: contentSize.width * zoomRef.current,
          height: contentSize.height * zoomRef.current,
        }),
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [contentSize]);

  function viewportLocalPoint(clientX: number, clientY: number): Point | null {
    const rect = bedRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function zoomAt(anchorViewportLocal: Point, nextZoom: number) {
    const newZoom = clampZoom(nextZoom);
    const anchorContentPx = contentPointAt(anchorViewportLocal, pan, zoom);
    const rawPan = panToAlign(anchorContentPx, anchorViewportLocal, newZoom);
    setZoom(newZoom);
    setPan(clampPan(rawPan, viewportSize, { width: contentSize.width * newZoom, height: contentSize.height * newZoom }));
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    const anchor = viewportLocalPoint(e.clientX, e.clientY);
    if (!anchor) return;
    zoomAt(anchor, zoom * Math.exp(-e.deltaY * 0.0015));
  }

  function zoomByButton(factor: number) {
    if (viewportSize.width === 0 || viewportSize.height === 0) return;
    zoomAt({ x: viewportSize.width / 2, y: viewportSize.height / 2 }, zoom * factor);
  }

  function fitView() {
    if (viewportSize.width === 0 || viewportSize.height === 0) return;
    const newZoom = computeFitZoom(viewportSize, contentSize);
    setZoom(newZoom);
    setPan(clampPan({ x: 0, y: 0 }, viewportSize, { width: contentSize.width * newZoom, height: contentSize.height * newZoom }));
  }

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
    const viewportLocal = viewportLocalPoint(clientX, clientY);
    if (!viewportLocal) return null;
    return clientToBedCoords(viewportLocal, pan, zoom, PX_PER_INCH, bed.widthIn, bed.heightIn);
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

  function startPinch() {
    const ids = [...activePointersRef.current.keys()];
    if (ids.length < 2) return;
    const [idA, idB] = ids;
    const a = activePointersRef.current.get(idA);
    const b = activePointersRef.current.get(idB);
    const midLocal = a && b ? viewportLocalPoint((a.x + b.x) / 2, (a.y + b.y) / 2) : null;
    if (!a || !b || !midLocal) return;
    pinchRef.current = {
      idA,
      idB,
      startDist: Math.hypot(a.x - b.x, a.y - b.y),
      startZoom: zoom,
      anchorContentPx: contentPointAt(midLocal, pan, zoom),
    };
  }

  // Empty-background gestures: a stationary hold opens the add-plant menu (long-press or
  // right-click); dragging instead pans the viewport; a second finger touching down starts a
  // pinch-zoom, taking over from whichever single-pointer gesture was in progress.
  function handleBedPointerDown(e: React.PointerEvent) {
    if (e.button === 2) return;
    // Some browsers can throw here for a second/third simultaneous touch pointer — capture is
    // an enhancement (keeps receiving move/up if a finger slides off the element), not required
    // for the gesture tracking below, so a failure here shouldn't abort it.
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      // ignored — see above
    }
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointersRef.current.size >= 2) {
      if (emptyGestureRef.current?.timer) clearTimeout(emptyGestureRef.current.timer);
      emptyGestureRef.current = null;
      setIsPanning(false);
      startPinch();
      return;
    }

    if (emptyGestureRef.current || pinchRef.current) return;
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const timer = setTimeout(() => {
      openMenuAt(startClientX, startClientY);
      emptyGestureRef.current = null;
    }, LONG_PRESS_MS);
    emptyGestureRef.current = { pointerId: e.pointerId, startClientX, startClientY, mode: 'pending', startPan: pan, timer };
  }

  function handleBedPointerMove(e: React.PointerEvent) {
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (pinchRef.current) {
      const { idA, idB, startDist, startZoom, anchorContentPx } = pinchRef.current;
      const a = activePointersRef.current.get(idA);
      const b = activePointersRef.current.get(idB);
      const midLocal = a && b ? viewportLocalPoint((a.x + b.x) / 2, (a.y + b.y) / 2) : null;
      if (!a || !b || !midLocal || startDist === 0) return;
      const newZoom = clampZoom(startZoom * (Math.hypot(a.x - b.x, a.y - b.y) / startDist));
      const rawPan = panToAlign(anchorContentPx, midLocal, newZoom);
      setZoom(newZoom);
      setPan(clampPan(rawPan, viewportSize, { width: contentSize.width * newZoom, height: contentSize.height * newZoom }));
      return;
    }

    const st = emptyGestureRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    const dist = Math.hypot(e.clientX - st.startClientX, e.clientY - st.startClientY);
    if (st.mode === 'pending') {
      if (dist <= MOVE_THRESHOLD_PX) return;
      if (st.timer) clearTimeout(st.timer);
      st.mode = 'panning';
      setIsPanning(true);
    }
    const rawPan = { x: st.startPan.x + (e.clientX - st.startClientX), y: st.startPan.y + (e.clientY - st.startClientY) };
    setPan(clampPan(rawPan, viewportSize, scaledContentSize));
  }

  function handleBedPointerUp(e: React.PointerEvent) {
    activePointersRef.current.delete(e.pointerId);
    if (pinchRef.current && (e.pointerId === pinchRef.current.idA || e.pointerId === pinchRef.current.idB)) {
      pinchRef.current = null;
    }
    const st = emptyGestureRef.current;
    if (st && st.pointerId === e.pointerId) {
      if (st.timer) clearTimeout(st.timer);
      emptyGestureRef.current = null;
      setIsPanning(false);
    }
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
            onPointerCancel={handleBedPointerUp}
            onWheel={handleWheel}
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: 720,
              aspectRatio: '3 / 2',
              minHeight: 260,
              maxHeight: '70vh',
              overflow: 'hidden',
              border: '1.5px solid var(--color-divider)',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--color-surface)',
              touchAction: 'none',
              userSelect: 'none',
              boxShadow: 'var(--shadow-md)',
              cursor: isPanning ? 'grabbing' : 'grab',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: contentSize.width,
                height: contentSize.height,
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: '0 0',
                border: '2.5px solid var(--color-text)',
                borderRadius: 'var(--radius-lg)',
                background: `repeating-linear-gradient(90deg, transparent 0 ${gridPx - 1}px, #e6dbc6 ${gridPx - 1}px ${gridPx}px), repeating-linear-gradient(0deg, #f6efe0 0 ${gridPx - 1}px, #efe6d2 ${gridPx - 1}px ${gridPx}px)`,
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

            <ZoomControl zoom={zoom} onZoomIn={() => zoomByButton(1.25)} onZoomOut={() => zoomByButton(1 / 1.25)} onFit={fitView} />
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

function ZoomControl({
  zoom,
  onZoomIn,
  onZoomOut,
  onFit,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}) {
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        right: 10,
        bottom: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        background: 'var(--color-surface-raised)',
        border: '1.5px solid var(--color-divider)',
        borderRadius: '999px',
        padding: '3px 4px',
        boxShadow: 'var(--shadow-sm)',
        touchAction: 'none',
      }}
    >
      <ZoomButton label="−" onClick={onZoomOut} />
      <span style={{ font: '600 11px Figtree', color: 'var(--color-text-muted)', minWidth: 36, textAlign: 'center' }}>
        {Math.round(zoom * 100)}%
      </span>
      <ZoomButton label="+" onClick={onZoomIn} />
      <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--color-divider)', margin: '0 2px' }} />
      <button
        onClick={onFit}
        className="btn btn-secondary"
        style={{ border: 'none', padding: '5px 10px', font: '600 11px Figtree' }}
      >
        Fit
      </button>
    </div>
  );
}

function ZoomButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={label === '+' ? 'Zoom in' : 'Zoom out'}
      style={{
        width: 24,
        height: 24,
        borderRadius: '999px',
        border: 'none',
        background: 'none',
        font: '700 14px Figtree',
        color: 'var(--color-text)',
      }}
    >
      {label}
    </button>
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
