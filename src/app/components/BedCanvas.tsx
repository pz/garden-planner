import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useGarden } from '../state/gardenStore';
import type { Bed, PlantInstance } from '../../types';
import { getCrop } from '../../data/crops';
import { duplicateSpot } from '../../core/spacing';
import { restorePlantCommand, type Command } from '../../api/commands';
import {
  boundingBox,
  clampGroupDelta,
  clampToOutline,
  computeGhosts,
  computeGroupBoxes,
  isInsideOutline,
  lockedAxis,
  GROUP_BOX_PAD_IN,
  AXIS_LOCK_THRESHOLD_FACTOR,
  type Point,
} from '../../core/geometry';
import { PLANTING_PX_PER_INCH, contentTransform, fitView, isDrag, panBy, pinchView, screenToGarden, wheelZoomFactor, zoomAt, zoomPercent, type View } from '../viewport';
import { bedOutline, drawnCornerRadius, gardenBounds, gardenToBed, type Bounds } from '../../core/layout';
import { labelAnchor, outerRadiusPx } from '../layoutInteraction';
import { isContextPress, isReleasedMove, polygonClipPath } from '../pointer';
import { PlantToken, LONG_PRESS_MS, MOVE_THRESHOLD_PX, type GestureHandlers } from './PlantToken';
import { PlantMenu } from './PlantMenu';
import { PlantInfoCard } from './PlantInfoCard';
import { PlantingCalendar } from './PlantingCalendar';
import { GardenSwitcher } from './GardenSwitcher';
import { CROP_COLORS } from './PlantMark';
import { ToastStack, type ToastItem } from './ToastStack';
import { LayoutEditor } from './LayoutEditor';
import { Icon } from './Icon';

const PX_PER_INCH = PLANTING_PX_PER_INCH;
const PLANT_DIAMETER = 26;
const BED_BORDER_PX = 2.5;
/** Room above each bed for its name. */
const BED_LABEL_PX = 26;
/** Clear space kept around the garden when it's fitted to the viewport. */
const FIT_PADDING_PX = 24;
const FIT_INSETS = { left: FIT_PADDING_PX, right: FIT_PADDING_PX, top: FIT_PADDING_PX, bottom: FIT_PADDING_PX };

function uid(): string {
  return crypto.randomUUID();
}

export function BedCanvas({ onEditSetup }: { onEditSetup: () => void }) {
  const { plan, warnings, apply } = useGarden();
  const { beds, plants, profile } = plan;

  const bedRefs = useRef(new Map<string, HTMLDivElement>());
  const viewportRef = useRef<HTMLDivElement>(null);
  /** The viewport's size, once measured. */
  const [vpSize, setVpSize] = useState<{ w: number; h: number } | null>(null);
  /** The pan/zoom camera over the garden; null until the viewport is measured and the garden fitted. */
  const [camera, setCamera] = useState<View | null>(null);
  const [panning, setPanning] = useState(false);
  /** Pointers currently down on the viewport (offsets from its top-left), and what they're doing. */
  const pointersRef = useRef(new Map<number, Point>());
  const gestureRef = useRef<
    | { kind: 'pan'; id: number; start: Point; view0: View; moved: boolean }
    | { kind: 'pinch'; ids: [number, number]; starts: [Point, Point]; view0: View }
    | null
  >(null);
  const emptyPressRef = useRef<{
    bedId: string;
    timer: ReturnType<typeof setTimeout> | null;
    startX: number;
    startY: number;
  } | null>(null);

  const [mode, setMode] = useState<'plant' | 'layout'>('plant');
  const [view, setView] = useState<'bed' | 'calendar'>('bed');
  const [menuState, setMenuState] = useState<{
    bedId: string;
    clientX: number;
    clientY: number;
    xIn: number;
    yIn: number;
  } | null>(null);
  const [quickActions, setQuickActions] = useState<{ id: string; clientX: number; clientY: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // A drag moves the whole patch (every plant sharing groupId) rigidly, never a single
  // member on its own — `members` is a snapshot of the group's positions at drag start,
  // and (dx, dy) is the same translation applied to every one of them.
  const [moveState, setMoveState] = useState<{
    bedId: string;
    groupId: string;
    anchorOriginal: Point;
    members: PlantInstance[];
    dx: number;
    dy: number;
  } | null>(null);
  const [multiply, setMultiply] = useState<{
    bedId: string;
    id: string;
    origin: Point;
    axis: Point | null;
    ghosts: Point[];
  } | null>(null);

  // Patches and plants with a warning the user hasn't dismissed get the warning badge.
  const warnedGroupIds = useMemo(() => new Set(warnings.filter((w) => !w.dismissed).flatMap((w) => w.subjects)), [warnings]);
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

  // A patch never spans beds, so each box belongs to the bed of its group's plants.
  const groupBoxes = useMemo(() => {
    const bedOfGroup = new Map(effectivePlants.map((p) => [p.groupId, p.bedId]));
    return computeGroupBoxes(effectivePlants).map((box) => ({ ...box, bedId: bedOfGroup.get(box.groupId) }));
  }, [effectivePlants]);

  const bedById = useMemo(() => new Map(beds.map((b) => [b.id, b])), [beds]);
  const bounds = gardenBounds(beds);
  const plantsIn = (bedId: string) => plants.filter((p) => p.bedId === bedId);

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  /** Runs commands; if the API refuses them, nothing changed and the reason is shown. */
  const run = useCallback(
    (commands: Command[]): boolean => {
      const result = apply(commands);
      if (!result.ok) setToasts((prev) => [...prev, { id: uid(), message: result.errors[0].message }]);
      return result.ok;
    },
    [apply],
  );

  // Backspace/Delete removes the selected plant, with an undo toast — but only when
  // focus isn't in a text field (e.g. the variety input), where the key should type normally.
  useEffect(() => {
    if (mode !== 'plant') return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      if (!selectedId) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const plant = plants.find((p) => p.id === selectedId);
      if (!plant) return;
      e.preventDefault();
      if (!run([{ type: 'removePlant', id: plant.id }])) return;
      setSelectedId(null);
      setToasts((prev) => [
        ...prev,
        { id: uid(), message: `Removed ${getCrop(plant.cropId).name}`, onUndo: () => void run([restorePlantCommand(plant)]) },
      ]);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode, selectedId, plants, run]);

  function toggleLayout() {
    setMode((m) => (m === 'plant' ? 'layout' : 'plant'));
    setView('bed');
    setSelectedId(null);
    setMenuState(null);
    setQuickActions(null);
  }

  /** The bed-local point under the pointer, unclamped (it may be outside the bed's shape). */
  function toBedLocal(bedId: string, clientX: number, clientY: number): Point | null {
    const el = viewportRef.current;
    const bed = bedById.get(bedId);
    if (!el || !bed || !camera) return null;
    // Screen → garden (through the pan/zoom camera) → the bed's own, possibly turned, frame. A
    // turned or scaled bed's on-screen box isn't its frame, so this can't be measured off the
    // bed's element.
    const rect = el.getBoundingClientRect();
    return gardenToBed(bed, screenToGarden(camera, clientX - rect.left, clientY - rect.top));
  }

  function toBedCoords(bedId: string, clientX: number, clientY: number): Point | null {
    const bed = bedById.get(bedId);
    const raw = toBedLocal(bedId, clientX, clientY);
    return bed && raw ? clampToOutline(raw, bedOutline(bed)) : null;
  }

  /** Whether a press lands on the bed itself, not the empty corners of its box (ellipse, polygon). */
  function pressIsOnBed(bedId: string, clientX: number, clientY: number): boolean {
    const bed = bedById.get(bedId);
    const raw = toBedLocal(bedId, clientX, clientY);
    return !!bed && !!raw && isInsideOutline(raw, bedOutline(bed));
  }

  function openMenuAt(bedId: string, clientX: number, clientY: number) {
    const coords = toBedCoords(bedId, clientX, clientY);
    if (!coords) return;
    setSelectedId(null);
    setMenuState({ bedId, clientX, clientY, xIn: coords.x, yIn: coords.y });
  }

  function handleBedContextMenu(e: React.MouseEvent, bedId: string) {
    if (!pressIsOnBed(bedId, e.clientX, e.clientY)) return;
    e.preventDefault();
    openMenuAt(bedId, e.clientX, e.clientY);
  }

  function handleBedPointerDown(e: React.PointerEvent, bedId: string) {
    const t = e.target as HTMLElement;
    if (t !== bedRefs.current.get(bedId) && !t.hasAttribute('data-bed-hit')) return; // ignore bubbled events from plants
    if (isContextPress(e)) return; // the contextmenu event opens the menu for these
    if (!pressIsOnBed(bedId, e.clientX, e.clientY)) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const timer = setTimeout(() => {
      openMenuAt(bedId, startX, startY);
      emptyPressRef.current = null;
    }, LONG_PRESS_MS);
    emptyPressRef.current = { bedId, timer, startX, startY };
  }

  function handleBedPointerMove(e: React.PointerEvent) {
    const st = emptyPressRef.current;
    if (!st) return;
    if (isReleasedMove(e)) return cancelEmptyPress();
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

  function cancelEmptyPress() {
    const st = emptyPressRef.current;
    if (st?.timer) clearTimeout(st.timer);
    emptyPressRef.current = null;
  }

  // --- pan and zoom ---------------------------------------------------------------------

  const showGarden = mode === 'plant' && view === 'bed' && !!bounds;
  /** The garden's box (name strip included) in garden coordinates; also where its content is anchored. */
  const gardenBox: Bounds | null = bounds && { ...bounds, y0: bounds.y0 - BED_LABEL_PX / PX_PER_INCH };

  const fitGarden = () => {
    if (vpSize && gardenBox) setCamera(fitView(gardenBox, vpSize.w, vpSize.h, FIT_INSETS, PX_PER_INCH));
  };
  const zoomBy = (factor: number) => {
    if (vpSize) setCamera((c) => c && zoomAt(c, vpSize.w / 2, vpSize.h / 2, factor));
  };

  // Measure the viewport while it's on screen, and start each visit (and each garden) fitted.
  useEffect(() => {
    const el = viewportRef.current;
    if (!showGarden || !el) {
      setVpSize(null);
      setCamera(null);
      return;
    }
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) setVpSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [showGarden]);
  useEffect(() => setCamera(null), [plan.id]);
  useEffect(() => {
    if (showGarden && vpSize && !camera && gardenBox) {
      setCamera(fitView(gardenBox, vpSize.w, vpSize.h, FIT_INSETS, PX_PER_INCH));
    }
  }, [showGarden, vpSize, camera, gardenBox]);

  // Wheel: pinch / ⌘-scroll zooms around the pointer, plain scroll pans. Needs a non-passive
  // listener so the page doesn't scroll or zoom as well.
  const hasCamera = !!camera;
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !hasCamera) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const r = el!.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        setCamera((c) => c && zoomAt(c, e.clientX - r.left, e.clientY - r.top, wheelZoomFactor(e.deltaY)));
      } else {
        setCamera((c) => c && panBy(c, -e.deltaX, -e.deltaY));
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [hasCamera]);

  // +, − and 0 zoom in, out and fit, unless a text field has the keyboard.
  useEffect(() => {
    if (!showGarden) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.key === '=' || e.key === '+') zoomBy(1.25);
      else if (e.key === '-') zoomBy(0.8);
      else if (e.key === '0') fitGarden();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  function localPoint(e: React.PointerEvent): Point {
    const r = viewportRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // Pressing the ground or a bed's bare surface pans; a press on a plant never gets here (the
  // plant handles it). A drag that starts on a bed also cancels its long-press-to-plant, and a
  // second finger turns the gesture into a pinch.
  function onViewportDown(e: React.PointerEvent) {
    if ((e.button !== 0 && e.button !== 1) || isContextPress(e) || !camera) return;
    const p = localPoint(e);
    pointersRef.current.set(e.pointerId, p);
    const down = [...pointersRef.current];
    if (down.length === 2) {
      cancelEmptyPress();
      const [[ida, a], [idb, b]] = down;
      gestureRef.current = { kind: 'pinch', ids: [ida, idb], starts: [a, b], view0: camera };
      viewportRef.current?.setPointerCapture(e.pointerId);
      setPanning(true);
    } else if (down.length === 1) {
      gestureRef.current = { kind: 'pan', id: e.pointerId, start: p, view0: camera, moved: false };
    }
  }

  function onViewportMove(e: React.PointerEvent) {
    const g = gestureRef.current;
    if (!g || !pointersRef.current.has(e.pointerId)) return;
    if (isReleasedMove(e)) return onViewportUp(e); // pointerup was swallowed; don't pan
    const p = localPoint(e);
    pointersRef.current.set(e.pointerId, p);
    if (g.kind === 'pinch') {
      const [a1, b1] = g.ids.map((id) => pointersRef.current.get(id));
      if (a1 && b1) setCamera(pinchView(g.view0, g.starts[0], g.starts[1], a1, b1));
    } else if (e.pointerId === g.id) {
      const dx = p.x - g.start.x;
      const dy = p.y - g.start.y;
      if (!g.moved && isDrag(dx, dy)) {
        g.moved = true;
        cancelEmptyPress();
        viewportRef.current?.setPointerCapture(e.pointerId);
        setPanning(true);
      }
      if (g.moved) setCamera(panBy(g.view0, dx, dy));
    }
  }

  function onViewportUp(e: React.PointerEvent) {
    if (!pointersRef.current.delete(e.pointerId)) return;
    const g = gestureRef.current;
    const left = [...pointersRef.current];
    if (g?.kind === 'pinch' && left.length === 1 && camera) {
      // One finger stays down after a pinch: carry on panning from where the camera is now.
      gestureRef.current = { kind: 'pan', id: left[0][0], start: left[0][1], view0: camera, moved: true };
      return;
    }
    if (left.length === 0) {
      gestureRef.current = null;
      setPanning(false);
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
      setMoveState({ bedId: p.bedId, groupId: p.groupId, anchorOriginal: { x: p.x, y: p.y }, members, dx: 0, dy: 0 });
    },
    onMoveUpdate: (_id, clientX, clientY) => {
      if (!moveState) return;
      const bed = bedById.get(moveState.bedId);
      const coords = toBedCoords(moveState.bedId, clientX, clientY);
      if (!coords || !bed) return;
      setMoveState((prev) => {
        if (!prev) return prev;
        const rawDx = coords.x - prev.anchorOriginal.x;
        const rawDy = coords.y - prev.anchorOriginal.y;
        const { x: dx, y: dy } = clampGroupDelta(prev.members, rawDx, rawDy, bedOutline(bed));
        return { ...prev, dx, dy };
      });
    },
    onMoveEnd: (_id, committed) => {
      if (committed && moveState && (moveState.dx !== 0 || moveState.dy !== 0)) {
        run([{ type: 'movePatch', groupId: moveState.groupId, dx: moveState.dx, dy: moveState.dy }]);
      }
      setMoveState(null);
    },
    onMultiplyStart: (id) => {
      const p = plants.find((pl) => pl.id === id);
      if (p) setMultiply({ bedId: p.bedId, id, origin: { x: p.x, y: p.y }, axis: null, ghosts: [] });
    },
    onMultiplyUpdate: (id, clientX, clientY) => {
      const p = plants.find((pl) => pl.id === id);
      const bed = p && bedById.get(p.bedId);
      const coords = p && toBedCoords(p.bedId, clientX, clientY);
      if (!coords || !p || !bed) return;
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
        const ghosts = computeGhosts(prev.origin, axis, coords, spacing, bedOutline(bed));
        return { ...prev, axis, ghosts };
      });
    },
    onMultiplyEnd: (id, committed) => {
      if (committed && multiply && multiply.id === id && multiply.ghosts.length > 0) {
        const origin = plants.find((pl) => pl.id === id);
        if (origin) {
          // The new plants join the dragged plant's patch.
          run(
            multiply.ghosts.map((g) => ({
              type: 'addPlant' as const,
              bedId: origin.bedId,
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
  const menuBed = menuState ? bedById.get(menuState.bedId) : undefined;

  const gridPx = PX_PER_INCH * 12;
  const gridBackground = `repeating-linear-gradient(90deg, transparent 0 ${gridPx - 1}px, #e6dbc6 ${gridPx - 1}px ${gridPx}px), repeating-linear-gradient(0deg, #f6efe0 0 ${gridPx - 1}px, #efe6d2 ${gridPx - 1}px ${gridPx}px)`;
  const isLayout = mode === 'layout';

  function renderBed(bed: Bed) {
    if (!bounds) return null;
    const label = labelAnchor(bed);
    const bedMultiply = multiply?.bedId === bed.id ? multiply : null;
    const bedPlants = effectivePlants.filter((p) => p.bedId === bed.id);
    const isPolygon = bed.shape === 'polygon' && !!bed.points;
    // Bordered beds center their border box; a polygon (no border) centers its plantable area.
    const edge = isPolygon ? 0 : BED_BORDER_PX;
    return (
      <Fragment key={bed.id}>
        <div
          style={{
            position: 'absolute',
            // Above the highest point of the bed's outline (from the left end of a flat top edge, or
            // centered over a single highest point), so it's never far from the shape itself.
            left: (label.x - bounds.x0) * PX_PER_INCH + (label.align === 'start' ? 4 : 0),
            top: (label.y - bounds.y0) * PX_PER_INCH + BED_LABEL_PX - 6,
            transform: label.align === 'middle' ? 'translate(-50%, -100%)' : 'translateY(-100%)',
            font: '600 13px Figtree',
            color: 'var(--color-text-muted)',
            whiteSpace: 'nowrap',
          }}
        >
          {bed.name}
        </div>
        <div
          // A zero-size anchor at the bed's center; the bed turns about it.
          style={{
            position: 'absolute',
            left: (bed.cx - bounds.x0) * PX_PER_INCH,
            top: (bed.cy - bounds.y0) * PX_PER_INCH + BED_LABEL_PX,
          }}
        >
          <div
            ref={(el) => {
              if (el) bedRefs.current.set(bed.id, el);
              else bedRefs.current.delete(bed.id);
            }}
            data-bed-id={bed.id}
            onContextMenu={(e) => handleBedContextMenu(e, bed.id)}
            onPointerDown={(e) => handleBedPointerDown(e, bed.id)}
            onPointerMove={handleBedPointerMove}
            onPointerUp={handleBedPointerUp}
            style={{
              position: 'absolute',
              // content-box so the plantable area is exactly widthIn × heightIn inside the border.
              boxSizing: 'content-box',
              left: -(bed.widthIn * PX_PER_INCH) / 2 - edge,
              top: -(bed.heightIn * PX_PER_INCH) / 2 - edge,
              width: bed.widthIn * PX_PER_INCH,
              height: bed.heightIn * PX_PER_INCH,
              transform: bed.rotationDeg ? `rotate(${bed.rotationDeg}deg)` : undefined,
              touchAction: 'none',
              userSelect: 'none',
              // An elliptical or polygonal bed's box covers ground (and other beds) that
              // isn't the bed; only its shape (the hit layer below) and plants catch presses.
              pointerEvents: bed.shape === 'rect' ? undefined : 'none',
              ...(isPolygon
                ? {} // A border can't follow a polygon, so it's drawn as an SVG outline instead.
                : {
                    border: `${BED_BORDER_PX}px solid var(--color-text)`,
                    // An ellipse's 50% radius gives an inner edge that is exactly its outline.
                    borderRadius: bed.shape === 'ellipse' ? '50%' : outerRadiusPx(drawnCornerRadius(bed), PX_PER_INCH, BED_BORDER_PX),
                    background: gridBackground,
                    boxShadow: 'var(--shadow-md)',
                  }),
            }}
          >
            {bed.shape !== 'rect' && (
              <div
                data-bed-hit=""
                style={{
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: 'auto',
                  borderRadius: bed.shape === 'ellipse' ? '50%' : undefined,
                  clipPath: isPolygon && bed.points ? polygonClipPath(bed.points, PX_PER_INCH) : undefined,
                }}
              />
            )}
            {bed.shape === 'polygon' && bed.points && <PolygonBedShape points={bed.points} widthIn={bed.widthIn} heightIn={bed.heightIn} />}
            {groupBoxes
              .filter((box) => box.bedId === bed.id)
              .map((box) => (
                <GroupBoundingBox
                  key={box.groupId}
                  box={box}
                  pxPerInch={PX_PER_INCH}
                  warned={warnedGroupIds.has(box.groupId)}
                />
              ))}
            {bedMultiply && multiplyBox && <GroupBoundingBox box={multiplyBox} pxPerInch={PX_PER_INCH} active />}

            {bedPlants.map((p) => {
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
                    counterRotateDeg={bed.rotationDeg}
                  />
                </div>
              );
            })}

            {bedMultiply?.ghosts.map((g, i) => {
              const origin = plants.find((p) => p.id === bedMultiply.id);
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

            {bedMultiply && bedMultiply.ghosts.length > 0 && (
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
                  transform: bed.rotationDeg ? `rotate(${-bed.rotationDeg}deg)` : undefined,
                }}
              >
                +{bedMultiply.ghosts.length}
              </div>
            )}
          </div>
        </div>
      </Fragment>
    );
  }

  return (
    <div style={{ padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <GardenSwitcher variant="title" onEditSetup={onEditSetup} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {isLayout ? (
              <>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    font: '500 13px Figtree',
                    color: 'var(--color-accent-700)',
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--color-accent)' }} />
                  Editing layout
                </span>
                <button onClick={toggleLayout} className="btn btn-primary" style={{ padding: '8px 14px', font: '600 12.5px Figtree' }}>
                  <Icon name="check" size={15} />
                  Done
                </button>
              </>
            ) : (
              <>
                <button onClick={toggleLayout} className="btn btn-secondary" style={{ padding: '8px 14px', font: '600 12.5px Figtree' }}>
                  <Icon name="ruler" size={15} />
                  Edit layout
                </button>
                <ViewTab label="Bed layout" active={view === 'bed'} onClick={() => setView('bed')} />
                <ViewTab label="Planting calendar" active={view === 'calendar'} onClick={() => setView('calendar')} />
              </>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <p style={{ font: '400 13px Figtree', color: 'var(--color-text-muted)' }}>
            {beds.length} {beds.length === 1 ? 'bed' : 'beds'} · {profile.sunExposure.replace('-', ' ')}
          </p>
          {!isLayout && <HelpTip text="Long-press or right-click anywhere on a bed to plant. Drag to pan; pinch, ⌘/Ctrl-scroll or +/− to zoom; 0 to fit." />}
        </div>
      </div>

      {isLayout && <LayoutEditor />}

      {!isLayout && view === 'calendar' && <PlantingCalendar plants={plants} zoneId={profile.zoneId} />}

      {!isLayout && view === 'bed' && !bounds && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 12,
            padding: '28px 24px',
            borderRadius: 'var(--radius-lg)',
            border: '1.5px dashed var(--color-divider)',
          }}
        >
          <p style={{ font: '400 17px Caveat, cursive', color: '#9a8c76' }}>No beds yet — add one to start planting.</p>
          <button onClick={toggleLayout} className="btn btn-primary" style={{ padding: '8px 14px', font: '600 12.5px Figtree' }}>
            <Icon name="ruler" size={15} />
            Edit layout
          </button>
        </div>
      )}

      {!isLayout && view === 'bed' && bounds && (
        <>
          {plants.length === 0 && (
            // One hint for the whole garden, outside the beds: centered in a bed it would cross an
            // ellipse's curve or a polygon's notch, and repeated in every bed it's just noise.
            <p style={{ font: '400 17px Caveat, cursive', color: '#9a8c76', marginBottom: -4 }}>
              Empty so far — long-press or right-click a bed to plant something.
            </p>
          )}
          <div
              ref={viewportRef}
              data-testid="garden-viewport"
              onPointerDown={onViewportDown}
              onPointerMove={onViewportMove}
              onPointerUp={onViewportUp}
              onPointerCancel={onViewportUp}
              // A canvas has no use for the browser's menu: right-click / Ctrl-click on the ground
              // or just outside a bed's shape does nothing instead of popping it over the garden.
              onContextMenu={(e) => e.preventDefault()}
              // The garden is drawn at a fixed scale inside this frame, which the camera pans and
              // zooms over; a narrow window just shows less of it instead of squashing it.
              style={{
                position: 'relative',
                height: 'max(420px, calc(100vh - 230px))',
                overflow: 'hidden',
                borderRadius: 'var(--radius-lg)',
                border: '1.5px solid var(--color-divider)',
                background: '#f9f4ed',
                touchAction: 'none',
                cursor: panning ? 'grabbing' : 'grab',
              }}
            >
              {camera && gardenBox && (() => {
                const t = contentTransform(camera, { x: gardenBox.x0, y: gardenBox.y0 }, PX_PER_INCH);
                return (
                  <div
                    data-testid="garden-content"
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      width: (gardenBox.x1 - gardenBox.x0) * PX_PER_INCH,
                      height: (gardenBox.y1 - gardenBox.y0) * PX_PER_INCH,
                      transformOrigin: '0 0',
                      transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale})`,
                    }}
                  >
                    {beds.map(renderBed)}
                  </div>
                );
              })()}
              {camera && <ZoomControls percent={zoomPercent(camera)} onZoomOut={() => zoomBy(0.8)} onZoomIn={() => zoomBy(1.25)} onFit={fitGarden} />}
          </div>

          {menuState && menuBed && (
            <PlantMenu
              clientX={menuState.clientX}
              clientY={menuState.clientY}
              bedXIn={menuState.xIn}
              bedYIn={menuState.yIn}
              outline={bedOutline(menuBed)}
              existingPlants={plantsIn(menuBed.id)}
              onPick={(cropId) => {
                run([{ type: 'addPlant', bedId: menuBed.id, cropId, x: menuState.xIn, y: menuState.yIn }]);
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
                run([{ type: 'removePlant', id: quickActionsPlant.id }]);
                setQuickActions(null);
              }}
              onDuplicate={() => {
                const bed = bedById.get(quickActionsPlant.bedId);
                if (bed) {
                  const spot = duplicateSpot(quickActionsPlant, bedOutline(bed), plantsIn(bed.id));
                  if (spot) run([{ type: 'addPlant', bedId: bed.id, cropId: quickActionsPlant.cropId, x: spot.x, y: spot.y }]);
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
              onSetVariety={(variety) => run([{ type: 'setVariety', id: selectedPlant.id, variety: variety ?? null }])}
              onRemove={() => {
                run([{ type: 'removePlant', id: selectedPlant.id }]);
                setSelectedId(null);
              }}
              onRemoveGroup={() => {
                run([{ type: 'removePatch', groupId: selectedPlant.groupId }]);
                setSelectedId(null);
              }}
              onDismissConflict={() =>
                run(
                  warnings
                    .filter((w) => !w.dismissed && w.subjects.includes(selectedPlant.groupId))
                    .map((w) => ({ type: 'dismissWarning' as const, id: w.id })),
                )
              }
            />
          )}
        </>
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

/** A polygon bed's fill, 1′ grid and border, drawn behind its plants (which sit in the same frame). */
function PolygonBedShape({ points, widthIn, heightIn }: { points: Point[]; widthIn: number; heightIn: number }) {
  const pad = BED_BORDER_PX;
  const gridPx = PX_PER_INCH * 12;
  const d = points.map((q) => `${q.x * PX_PER_INCH + pad},${q.y * PX_PER_INCH + pad}`).join(' ');
  // useId can contain characters that aren't safe inside url(#…), so keep only the plain ones.
  const id = `bed-grid-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg
      width={widthIn * PX_PER_INCH + pad * 2}
      height={heightIn * PX_PER_INCH + pad * 2}
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: -pad,
        top: -pad,
        overflow: 'visible',
        pointerEvents: 'none',
        filter: 'drop-shadow(0 3px 5px color-mix(in srgb, #201e1d 16%, transparent))',
      }}
    >
      <defs>
        <pattern id={id} width={gridPx} height={gridPx} x={pad} y={pad} patternUnits="userSpaceOnUse">
          <rect width={gridPx} height={gridPx} fill="#f6efe0" />
          <path d={`M${gridPx - 0.5} 0V${gridPx}M0 ${gridPx - 0.5}H${gridPx}`} stroke="#e6dbc6" strokeWidth={1} />
        </pattern>
      </defs>
      <polygon
        points={d}
        fill={`url(#${id})`}
        stroke="var(--color-text)"
        strokeWidth={BED_BORDER_PX}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ZoomControls({
  percent,
  onZoomOut,
  onZoomIn,
  onFit,
}: {
  percent: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFit: () => void;
}) {
  const round = { width: 32, height: 32, padding: 0, justifyContent: 'center', borderRadius: 999, borderColor: 'transparent' } as const;
  return (
    <div
      // Presses on the controls must not start a pan.
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        right: 16,
        bottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: 4,
        borderRadius: 999,
        background: 'var(--color-bg)',
        boxShadow: 'var(--shadow-md)',
        cursor: 'default',
      }}
    >
      <button className="btn btn-secondary" title="Zoom out (−)" aria-label="Zoom out" onClick={onZoomOut} style={round}>
        <Icon name="minus" size={16} />
      </button>
      <button
        className="btn btn-secondary"
        title="Fit garden (0)"
        aria-label="Fit garden"
        onClick={onFit}
        style={{ borderColor: 'transparent', minWidth: 58, padding: '6px 8px', font: '600 13px Figtree' }}
      >
        {percent}%
      </button>
      <button className="btn btn-secondary" title="Zoom in (+)" aria-label="Zoom in" onClick={onZoomIn} style={round}>
        <Icon name="plus" size={16} />
      </button>
      <button className="btn btn-secondary" title="Fit garden (0)" aria-label="Fit garden to view" onClick={onFit} style={round}>
        <Icon name="fit" size={16} />
      </button>
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
