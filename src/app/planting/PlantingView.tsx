import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGarden } from '../state/gardenStore';
import type { PlantInstance, Point } from '../../types';
import { allCrops, findCrop, getCrop } from '../../data/crops';
import type { Command } from '../../api/commands';
import { bedOutline, bedToGarden, gardenBounds, gardenToBed, type Bounds } from '../../core/layout';
import { bedAt, discsOf, planMove, planStamp, radiusOf } from '../../core/placement';
import {
  brushSpots,
  canPlantAt,
  hitPlant,
  marqueeSelect,
  selectOnPress,
  stampOf,
  type StampItem,
} from '../../core/planting';
import { summarizeSelection } from '../../core/selectionSummary';
import { Compass } from '../components/Compass';
import { Icon } from '../components/Icon';
import { PlantMark } from '../components/PlantMark';
import { ToastStack, type ToastItem } from '../components/ToastStack';
import { isContextPress, isReleasedMove } from '../pointer';
import { fitView, isDrag, panBy, pinchView, screenToGarden, wheelZoomFactor, zoomAt, zoomPercent, PLANTING_PX_PER_INCH, type View } from '../viewport';
import { GardenSvg, type DrawnPlant, type Ghost, type Tag } from './GardenSvg';
import { Inspector } from './Inspector';
import { PlantPanel } from './PlantPanel';
import { ContextMenu, HelpBox, ModeChip, ZoomControls, type MenuItem } from './overlays';
import { MOD, hasMod } from './keys';
import { CustomPlantDialog, customCropFrom } from './CustomPlantDialog';
import { deleteCustomCrop, saveCustomCrop, useCustomCrops } from '../state/customCropsStore';
import { newCustomCropId } from '../state/customCrops';

/** Room kept clear of the plant list, selection panel, top chip and help box when fitting the garden. */
const FIT_INSETS = { left: 100, right: 336, top: 72, bottom: 150 };
const HISTORY_LIMIT = 40;
const RECENTS_KEY = 'planting-recents';

const uid = () => crypto.randomUUID();
const round = (p: Point): Point => ({ x: Math.round(p.x), y: Math.round(p.y) });

function readRecents(): string[] {
  const fallback = allCrops().slice(0, 6).map((c) => c.id);
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? 'null');
    const ids = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string' && !!findCrop(id)) : [];
    return ids.length ? ids.slice(0, 6) : fallback;
  } catch {
    return fallback;
  }
}

type Tool = 'select' | 'plant' | 'stamp';

type Drag =
  | { kind: 'pan'; start: Point; view0: View; moved: boolean; deselect: boolean }
  | { kind: 'pinch'; ids: [number, number]; starts: [Point, Point]; view0: View }
  | { kind: 'marquee'; a: Point; b: Point; base: string[] }
  | { kind: 'move'; start: Point; ids: string[]; delta: Point; moved: boolean; drill: string | null; copy: boolean }
  | { kind: 'brush'; bedId: string; anchor: Point; last: Point; spots: Point[] };

interface MenuState {
  at: Point;
  target: { kind: 'plant'; id: string } | { kind: 'soil'; garden: Point };
}

/** The planting view: the garden, its plant list, selection panel and gestures. */
export function PlantingView() {
  const { plan, warnings, apply } = useGarden();
  const { beds, plants, profile } = plan;
  const bounds: Bounds | null = gardenBounds(beds);
  const customList = useCustomCrops();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const crops = useMemo(() => allCrops(), [customList]);

  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [camera, setCamera] = useState<View | null>(null);

  const [tool, setTool] = useState<Tool>('select');
  const [armed, setArmed] = useState<string | null>(null);
  const [stamp, setStamp] = useState<StampItem[] | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [overBed, setOverBed] = useState(false);
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [history, setHistory] = useState<PlantInstance[][]>([]);
  const [recents, setRecents] = useState(readRecents);
  const [spaceDown, setSpaceDown] = useState(false);
  const [modDown, setModDown] = useState(false);
  const [dialog, setDialog] = useState<{ cropId: string | null; name: string } | null>(null);
  const clipboard = useRef<StampItem[]>([]);
  const pointers = useRef(new Map<number, Point>());

  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };

  // --- commands -------------------------------------------------------------------------

  const toast = useCallback((message: string, onUndo?: () => void) => setToasts((t) => [...t, { id: uid(), message, onUndo }]), []);

  /** Sends commands; on refusal nothing changed and the reason is shown. Records the plants first so Undo can bring them back. */
  const run = useCallback(
    (commands: Command[], { undoable = true }: { undoable?: boolean } = {}) => {
      const result = apply(commands);
      if (!result.ok) {
        toast(result.errors[0].message);
        return null;
      }
      if (undoable) setHistory((h) => [...h.slice(-(HISTORY_LIMIT - 1)), plants]);
      return result;
    },
    [apply, plants, toast],
  );

  const undo = useCallback(() => {
    const prev = history[history.length - 1];
    if (!prev) return;
    if (!run([{ type: 'restorePlants', plants: prev }], { undoable: false })) return;
    setHistory((h) => h.slice(0, -1));
    const ids = new Set(prev.map((p) => p.id));
    setSelection((s) => s.filter((id) => ids.has(id)));
  }, [history, run]);

  // A toast's Undo outlives the render that made it, so it calls whichever undo is current.
  const undoRef = useRef(undo);
  undoRef.current = undo;

  // --- derived geometry -----------------------------------------------------------------

  const baseDiscs = useMemo(() => discsOf(plants, beds), [plants, beds]);
  const discsById = useMemo(() => new Map(baseDiscs.map((d) => [d.id, d])), [baseDiscs]);
  const bedsById = useMemo(() => new Map(beds.map((b) => [b.id, b])), [beds]);
  const selectedPlants = useMemo(() => plants.filter((p) => selection.includes(p.id)), [plants, selection]);
  const summary = useMemo(() => summarizeSelection(plants, beds, selection, baseDiscs), [plants, beds, selection, baseDiscs]);
  const warnedGroups = useMemo(() => new Set(warnings.filter((w) => !w.dismissed).flatMap((w) => w.subjects)), [warnings]);
  const selectedGroups = new Set(selectedPlants.map((p) => p.groupId));
  const selectionWarnings = warnings.filter((w) => !w.dismissed && w.subjects.some((g) => selectedGroups.has(g)));

  const moving = drag?.kind === 'move' && drag.moved && !drag.copy ? drag : null;
  const moveDelta = moving?.delta;
  const movingIds = useMemo(() => new Set(moving?.ids ?? []), [moving?.ids]);
  const drawn = useMemo<DrawnPlant[]>(() => {
    const discs = discsOf(plants, beds, (id) => (moveDelta && movingIds.has(id) ? moveDelta : undefined));
    const cropOf = new Map(plants.map((p) => [p.id, p.cropId]));
    return discs.map((d) => ({ ...d, cropId: cropOf.get(d.id)!, bad: !!moveDelta && movingIds.has(d.id) && !bedAt(beds, d) }));
  }, [plants, beds, moveDelta, movingIds]);

  // --- camera ---------------------------------------------------------------------------

  const gardenBox: Bounds | null = bounds;
  const fit = useCallback(() => {
    if (size && gardenBox) setCamera(fitView(gardenBox, size.w, size.h, FIT_INSETS, PLANTING_PX_PER_INCH));
  }, [size, gardenBox]);
  const zoomBy = (factor: number) => size && setCamera((c) => c && zoomAt(c, size.w / 2, size.h / 2, factor));

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) setSize((s) => (s && s.w === r.width && s.h === r.height ? s : { w: r.width, h: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!camera && size && gardenBox) setCamera(fitView(gardenBox, size.w, size.h, FIT_INSETS, PLANTING_PX_PER_INCH));
  }, [camera, size, gardenBox]);

  const hasCamera = !!camera;
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !hasCamera) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const r = el!.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) setCamera((c) => c && zoomAt(c, e.clientX - r.left, e.clientY - r.top, wheelZoomFactor(e.deltaY)));
      else setCamera((c) => c && panBy(c, -e.deltaX, -e.deltaY));
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [hasCamera]);

  // --- what the pointer is over ---------------------------------------------------------

  /** Viewport-local pixels of a pointer event. */
  const localPx = (e: { clientX: number; clientY: number }): Point => {
    const r = viewportRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toGarden = (e: { clientX: number; clientY: number }, cam = camera!): Point => {
    const p = localPx(e);
    return screenToGarden(cam, p.x, p.y);
  };

  // --- modes ----------------------------------------------------------------------------

  const toSelect = useCallback(() => {
    setTool('select');
    setArmed(null);
    setStamp(null);
  }, []);

  const arm = (cropId: string) => {
    if (tool === 'plant' && armed === cropId) return toSelect();
    setTool('plant');
    setArmed(cropId);
    setStamp(null);
    setSelection([]);
    setMenu(null);
    setRecents((r) => {
      const next = [cropId, ...r.filter((id) => id !== cropId)].slice(0, 6);
      try {
        localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
      } catch {
        /* not remembered */
      }
      return next;
    });
  };

  const gardenStamp = (list: PlantInstance[]): StampItem[] =>
    stampOf(list.flatMap((p) => (discsById.get(p.id) ? [{ cropId: p.cropId, x: discsById.get(p.id)!.x, y: discsById.get(p.id)!.y, groupId: p.groupId }] : [])));

  const startStamp = (items: StampItem[]) => {
    if (items.length === 0) return;
    setStamp(items);
    setTool('stamp');
    setArmed(null);
    setMenu(null);
  };
  const duplicateSelection = () => startStamp(gardenStamp(selectedPlants));

  // --- edits ----------------------------------------------------------------------------

  const deletePlants = (ids: string[]) => {
    const gone = plants.filter((p) => ids.includes(p.id));
    if (gone.length === 0) return;
    if (!run(gone.map((p) => ({ type: 'removePlant' as const, id: p.id })))) return;
    setSelection([]);
    setMenu(null);
    toast(gone.length === 1 ? `Removed ${getCrop(gone[0].cropId).name}` : `Removed ${gone.length} plants`, () => undoRef.current());
  };
  const group = () => {
    if (selection.length < 2) return;
    run([{ type: 'groupPlants', ids: selection }]);
    setMenu(null);
  };
  const ungroup = () => {
    run([{ type: 'ungroupPlants', ids: selection }]);
    setMenu(null);
  };

  /** Plants the stamp's copies at a garden point, each patch of the original kept together (per bed). */
  const placeStamp = (items: StampItem[], at: Point) => {
    const placements = planStamp(items, beds, at);
    if (placements.length === 0) return toast('Place copies inside a bed');
    const groupIds = new Map<string, string>();
    const commands: Command[] = placements.map((pl) => {
      const key = `${pl.item.group}|${pl.bedId}`;
      if (!groupIds.has(key)) groupIds.set(key, uid());
      return { type: 'addPlant', id: uid(), groupId: groupIds.get(key), bedId: pl.bedId, cropId: pl.item.cropId, x: pl.x, y: pl.y };
    });
    const result = run(commands);
    if (result) setSelection(result.results.flatMap((r) => r.plantIds ?? []));
  };

  const plantOneAt = (cropId: string, garden: Point) => {
    const bed = bedAt(beds, garden);
    if (!bed) return toast('Plant inside a bed');
    const local = round(gardenToBed(bed, garden));
    arm(cropId);
    const result = run([{ type: 'addPlant', bedId: bed.id, cropId, x: local.x, y: local.y }]);
    if (result) setSelection(result.results.flatMap((r) => r.plantIds ?? []));
  };

  // --- gesture previews -----------------------------------------------------------------

  /** Discs of one bed in its own frame, for deciding whether a spot is taken. */
  const localDiscs = (bedId: string) => plants.filter((p) => p.bedId === bedId).map((p) => ({ x: p.x, y: p.y, r: radiusOf(p.cropId) }));

  const brushPoints = (d: Extract<Drag, { kind: 'brush' }>, to: Point) => {
    if (!armed) return d.spots;
    const bed = bedsById.get(d.bedId)!;
    const r = radiusOf(armed);
    const outline = bedOutline(bed);
    const spots = [...d.spots];
    const painted = spots.map((s) => ({ x: s.x, y: s.y, r }));
    for (const s of brushSpots(d.anchor, d.last, to, r * 2)) {
      if (canPlantAt(s, r, outline, [...localDiscs(d.bedId), ...painted])) {
        spots.push(s);
        painted.push({ x: s.x, y: s.y, r });
      }
    }
    return spots;
  };

  // --- pointer --------------------------------------------------------------------------

  const hitAt = (g: Point) => hitPlant(baseDiscs, g, camera!.zoom);

  const startPan = (e: React.PointerEvent, deselect: boolean) =>
    setDrag({ kind: 'pan', start: localPx(e), view0: camera!, moved: false, deselect });

  function onPointerDown(e: React.PointerEvent) {
    if (!camera) return;
    setMenu(null);
    if (isContextPress(e) || (e.button !== 0 && e.button !== 1)) return;
    const px = localPx(e);
    pointers.current.set(e.pointerId, px);
    viewportRef.current?.setPointerCapture(e.pointerId);

    const down = [...pointers.current];
    if (down.length === 2) {
      const [[ida, a], [idb, b]] = down;
      setDrag({ kind: 'pinch', ids: [ida, idb], starts: [a, b], view0: camera });
      return;
    }
    if (down.length > 2) return;
    if (e.button === 1 || spaceDown) {
      e.preventDefault();
      return startPan(e, false);
    }

    const g = screenToGarden(camera, px.x, px.y);
    const hit = hitAt(g);
    const onBed = !!bedAt(beds, g);
    const mods = { toggle: hasMod(e), shift: e.shiftKey };

    // Armed with a crop (or a stamp): a press on a plant, or off every bed, just goes back to selecting — and acts as a selecting press.
    let current = tool;
    if ((current === 'plant' || current === 'stamp') && (hit || !onBed)) {
      toSelect();
      current = 'select';
    }

    if (current === 'select') {
      const additive = mods.toggle || mods.shift;
      if (!hit && !additive && !onBed) return startPan(e, true);
      if (!hit) {
        const base = additive ? selection : [];
        setSelection(base);
        return setDrag({ kind: 'marquee', a: g, b: g, base });
      }
      const picked = selectOnPress(baseDiscs, hit, selection, mods);
      let ids = picked.selection;
      let copy = false;
      if (e.altKey && ids.length) copy = true;
      setSelection(ids);
      return setDrag({ kind: 'move', start: g, ids, delta: { x: 0, y: 0 }, moved: false, drill: picked.drill, copy });
    }

    if (current === 'stamp') {
      if (stamp) placeStamp(stamp, g);
      return;
    }

    // Planting: a brush stroke in the bed the press landed in.
    const bed = bedAt(beds, g)!;
    const local = round(gardenToBed(bed, g));
    const first: Extract<Drag, { kind: 'brush' }> = { kind: 'brush', bedId: bed.id, anchor: local, last: local, spots: [] };
    setDrag({ ...first, spots: brushPoints(first, local) });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!camera) return;
    const d = dragRef.current;
    if (!d) {
      // Hover: what's under the pointer, for the cursor, the hover ring and the ghost.
      const g = toGarden(e);
      if (tool === 'select') {
        const h = hitAt(g)?.id ?? null;
        if (h !== hoverId) setHoverId(h);
      } else if (hoverId) setHoverId(null);
      const inBed = !!bedAt(beds, g);
      if (inBed !== overBed) setOverBed(inBed);
      if (tool !== 'select') setCursor(g);
      return;
    }
    if (isReleasedMove(e) && d.kind !== 'pinch') return finish(e, false);
    const px = localPx(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, px);

    if (d.kind === 'pinch') {
      const [a1, b1] = d.ids.map((id) => pointers.current.get(id));
      if (a1 && b1) setCamera(pinchView(d.view0, d.starts[0], d.starts[1], a1, b1));
      return;
    }
    if (d.kind === 'pan') {
      const dx = px.x - d.start.x;
      const dy = px.y - d.start.y;
      const moved = d.moved || isDrag(dx, dy);
      if (moved) setCamera(panBy(d.view0, dx, dy));
      if (moved !== d.moved) setDrag({ ...d, moved });
      return;
    }
    const g = screenToGarden(camera, px.x, px.y);
    setCursor(g);
    if (d.kind === 'marquee') {
      setDrag({ ...d, b: g });
      setSelection(marqueeSelect(baseDiscs, d.a, g, d.base));
    } else if (d.kind === 'move') {
      const dx = g.x - d.start.x;
      const dy = g.y - d.start.y;
      if (!d.moved && Math.hypot(dx, dy) * camera.zoom < 4) return;
      setDrag({ ...d, delta: { x: Math.round(dx), y: Math.round(dy) }, moved: true });
    } else if (d.kind === 'brush') {
      const bed = bedsById.get(d.bedId)!;
      const local = gardenToBed(bed, g);
      setDrag({ ...d, last: local, spots: brushPoints(d, local) });
    }
  }

  /** Ends the gesture; `commit` is false when it was cancelled. */
  function finish(e: React.PointerEvent, commit = true) {
    pointers.current.delete(e.pointerId);
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === 'pinch') {
      if (pointers.current.size === 0) setDrag(null);
      return;
    }
    setDrag(null);
    if (!commit) return;

    if (d.kind === 'pan') {
      if (d.deselect && !d.moved) setSelection([]);
    } else if (d.kind === 'move') {
      if (!d.moved) {
        if (d.drill) setSelection([d.drill]);
        return;
      }
      if (d.copy) {
        const items = gardenStamp(plants.filter((p) => d.ids.includes(p.id)));
        const at = { x: 0, y: 0 };
        const src = baseDiscs.filter((x) => d.ids.includes(x.id));
        at.x = src.reduce((s, x) => s + x.x, 0) / src.length + d.delta.x;
        at.y = src.reduce((s, x) => s + x.y, 0) / src.length + d.delta.y;
        const placements = planStamp(items, beds, at);
        if (placements.length < items.length) return toast('Plants need to stay inside a bed');
        placeStamp(items, at);
        return;
      }
      const planned = planMove(plants, beds, d.ids, d.delta);
      if (planned.outside.length) return toast('Plants need to stay inside a bed');
      run([{ type: 'movePlants', moves: planned.moves }]);
    } else if (d.kind === 'brush') {
      if (!armed || d.spots.length === 0) return;
      const result = run([{ type: 'addPatch', bedId: d.bedId, cropId: armed, points: d.spots }]);
      if (result) setSelection(result.results.flatMap((r) => r.plantIds ?? []));
    }
  }

  function onContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    if (!camera) return;
    const g = toGarden(e);
    const at = localPx(e);
    const hit = hitAt(g);
    if (hit) {
      if (!selection.includes(hit.id)) setSelection(selectOnPress(baseDiscs, hit, [], { toggle: false, shift: false }).selection);
      setMenu({ at, target: { kind: 'plant', id: hit.id } });
    } else if (bedAt(beds, g)) setMenu({ at, target: { kind: 'soil', garden: g } });
    else setMenu(null);
  }

  // --- keyboard -------------------------------------------------------------------------

  useEffect(() => {
    function typing(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (typing(e)) return;
      const k = e.key.toLowerCase();
      if (e.key === 'Meta' || e.key === 'Control' || e.key === 'Shift') return setModDown(true);
      if (hasMod(e)) {
        if (k === 'z') {
          e.preventDefault();
          undo();
        } else if (k === 'g') {
          e.preventDefault();
          if (e.shiftKey) ungroup();
          else group();
        } else if (k === 'd' && selection.length) {
          e.preventDefault();
          duplicateSelection();
        } else if (k === 'c' && selection.length) {
          e.preventDefault();
          clipboard.current = gardenStamp(selectedPlants);
          toast(`Copied ${selection.length} plant${selection.length > 1 ? 's' : ''}`);
        } else if (k === 'x' && selection.length) {
          e.preventDefault();
          clipboard.current = gardenStamp(selectedPlants);
          deletePlants(selection);
        } else if (k === 'v' && clipboard.current.length) {
          e.preventDefault();
          startStamp(clipboard.current);
        } else if (k === 'a') {
          e.preventDefault();
          setSelection(plants.map((p) => p.id));
        }
        return;
      }
      if (e.altKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        return setSpaceDown(true);
      }
      if (e.key === '=' || e.key === '+') zoomBy(1.25);
      else if (e.key === '-') zoomBy(0.8);
      else if (e.key === '0') fit();
      else if (e.key === 'Escape') {
        if (menu) setMenu(null);
        else if (tool !== 'select') toSelect();
        else setSelection([]);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.length) {
          e.preventDefault();
          deletePlants(selection);
        }
      } else if (k === 'v') toSelect();
      else if (/^[1-6]$/.test(k) && recents[+k - 1]) arm(recents[+k - 1]);
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === ' ') setSpaceDown(false);
      if (e.key === 'Meta' || e.key === 'Control' || e.key === 'Shift') setModDown(false);
    }
    const blur = () => {
      setSpaceDown(false);
      setModDown(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', blur);
    };
  });

  // --- what to draw ---------------------------------------------------------------------

  const armedCrop = armed ? getCrop(armed) : null;
  const ghosts: Ghost[] = [];
  let tag: Tag | null = null;
  let brush: { at: Point; r: number } | null = null;
  let marquee: { a: Point; b: Point } | null = null;

  if (drag?.kind === 'marquee') marquee = { a: drag.a, b: drag.b };

  if (armedCrop && tool === 'plant') {
    const r = armedCrop.spacingIn / 2;
    const noun = armedCrop.name.toLowerCase();
    if (drag?.kind === 'brush') {
      const bed = bedsById.get(drag.bedId)!;
      for (const s of drag.spots) ghosts.push({ cropId: armedCrop.id, ...bedToGarden(bed, s), ok: true });
      if (cursor) tag = { at: cursor, text: `${drag.spots.length} ${drag.spots.length === 1 ? noun : `${noun}s`}`, warn: false };
      if (cursor) brush = { at: cursor, r };
    } else if (cursor && overBed && !hoverId) {
      brush = { at: cursor, r };
    }
  }
  if (tool === 'stamp' && stamp && cursor && !drag) {
    for (const item of stamp) {
      const at = { x: cursor.x + item.dx, y: cursor.y + item.dy };
      ghosts.push({ cropId: item.cropId, ...at, ok: !!bedAt(beds, at) });
    }
  }
  if (drag?.kind === 'move' && drag.copy && drag.moved) {
    for (const id of drag.ids) {
      const d = discsById.get(id);
      const cropId = plants.find((p) => p.id === id)?.cropId;
      if (d && cropId) {
        const at = { x: d.x + drag.delta.x, y: d.y + drag.delta.y };
        ghosts.push({ cropId, ...at, ok: !!bedAt(beds, at) });
      }
    }
    if (cursor) tag = { at: cursor, text: `Copy ${drag.ids.length}`, warn: false };
  }

  const cursorStyle = (() => {
    if (drag?.kind === 'pan' || drag?.kind === 'pinch') return 'grabbing';
    if (spaceDown) return 'grab';
    if (drag?.kind === 'move' && drag.moved) return 'grabbing';
    if (drag?.kind === 'marquee') return 'crosshair';
    if (tool === 'plant') return overBed && !hoverId ? 'none' : 'crosshair';
    if (tool === 'stamp') return 'copy';
    if (hoverId) return 'grab';
    return modDown || overBed ? 'crosshair' : 'grab';
  })();

  const pickInMenu = (ids: string[]) => {
    setSelection(ids);
    setMenu(null);
  };
  const menuItems: MenuItem[] = [];
  let menuTitle: string | undefined;
  if (menu?.target.kind === 'plant') {
    const targetId = menu.target.id;
    const hit = plants.find((p) => p.id === targetId);
    const patch = hit ? plants.filter((p) => p.groupId === hit.groupId).map((p) => p.id) : [];
    menuItems.push({ label: 'Duplicate', hint: `${MOD}D`, icon: <Icon name="copy" size={16} />, onClick: duplicateSelection });
    if (summary?.canGroup) menuItems.push({ label: 'Group into patch', hint: `${MOD}G`, icon: <Icon name="group" size={16} />, onClick: group });
    if (summary?.canUngroup) menuItems.push({ label: 'Ungroup', hint: `⇧${MOD}G`, icon: <Icon name="ungroup" size={16} />, onClick: ungroup });
    if (patch.length > 1) {
      const whole = selection.length === patch.length && patch.every((id) => selection.includes(id));
      menuItems.push(
        whole
          ? { label: 'Select just this plant', icon: <Icon name="target" size={16} />, onClick: () => pickInMenu([targetId]) }
          : { label: 'Select whole patch', icon: <Icon name="lasso" size={16} />, onClick: () => pickInMenu(patch) },
      );
    }
    menuItems.push({ label: 'Delete', hint: 'Del', icon: <Icon name="trash" size={16} />, onClick: () => deletePlants(selection) });
  } else if (menu?.target.kind === 'soil') {
    const at = menu.target.garden;
    menuTitle = 'Plant here';
    for (const [i, id] of recents.filter((r) => findCrop(r)).entries()) {
      menuItems.push({ label: getCrop(id).name, hint: String(i + 1), icon: <PlantMark cropId={id} diameter={22} />, onClick: () => plantOneAt(id, at) });
    }
  }

  const tip =
    tool === 'plant' && armedCrop
      ? `Click in a bed to place ${armedCrop.name.toLowerCase()}, or paint to fill a patch. Click a plant or outside a bed to go back to selecting.`
      : tool === 'stamp'
        ? 'Click in a bed to place copies. Click a plant or outside a bed when you’re done.'
        : selection.length
          ? 'Drag to move. Alt-drag to copy.'
          : 'Pick a plant from the list to start planting, or click a plant to select it.';

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 420, overflow: 'hidden', background: 'var(--color-accent-2-100)' }}>
      <div
        ref={viewportRef}
        data-testid="garden-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finish(e)}
        onPointerCancel={(e) => finish(e, false)}
        onPointerLeave={() => {
          setHoverId(null);
          setCursor(null);
          setOverBed(false);
        }}
        onContextMenu={onContextMenu}
        style={{ position: 'absolute', inset: 0, touchAction: 'none', userSelect: 'none', cursor: cursorStyle }}
      >
        {camera && size && (
          <GardenSvg
            camera={camera}
            size={size}
            beds={beds}
            plants={drawn}
            selected={new Set(selection)}
            hoverId={hoverId}
            warnedGroups={warnedGroups}
            ghosts={ghosts}
            marquee={marquee}
            brush={brush}
            tag={tag}
          />
        )}
      </div>

      <PlantPanel
        crops={crops}
        armedId={tool === 'plant' ? armed : null}
        selecting={tool === 'select'}
        canUndo={history.length > 0}
        onSelect={toSelect}
        onUndo={undo}
        onArm={arm}
        onAdd={(name) => setDialog({ cropId: null, name: name ?? '' })}
        onEdit={(cropId) => setDialog({ cropId, name: '' })}
      />

      {tool === 'plant' && armedCrop && (
        <ModeChip
          icon={<PlantMark cropId={armedCrop.id} diameter={28} />}
          name={armedCrop.name}
          hint={armedCrop.defaultPatch ? 'paint in a bed to sow a patch' : 'click in a bed to place, drag for several'}
          onDone={toSelect}
        />
      )}
      {tool === 'stamp' && stamp && (
        <ModeChip icon={<Icon name="copy" size={18} />} name={`Duplicating ${stamp.length} plant${stamp.length > 1 ? 's' : ''}`} hint="click in a bed to place copies" onDone={toSelect} />
      )}

      {summary && !(drag?.kind === 'marquee') && (
        <Inspector
          summary={summary}
          zoneId={profile.zoneId}
          variety={selectedPlants.length === 1 ? selectedPlants[0].variety : undefined}
          warnings={selectionWarnings}
          onClose={() => setSelection([])}
          onSetVariety={(variety) => selectedPlants[0] && run([{ type: 'setVariety', id: selectedPlants[0].id, variety: variety ?? null }], { undoable: false })}
          onDismissWarning={() =>
            run(
              selectionWarnings.map((w) => ({ type: 'dismissWarning' as const, id: w.id })),
              { undoable: false },
            )
          }
          onSelectPatch={() => selectedPlants[0] && setSelection(plants.filter((p) => p.groupId === selectedPlants[0].groupId).map((p) => p.id))}
          onGroup={group}
          onUngroup={ungroup}
          onDuplicate={duplicateSelection}
          onDelete={() => deletePlants(selection)}
          onEditPlant={() => selectedPlants[0] && setDialog({ cropId: selectedPlants[0].cropId, name: '' })}
        />
      )}

      {dialog && (
        <CustomPlantDialog
          plant={dialog.cropId ? findCrop(dialog.cropId) ?? null : null}
          initialName={dialog.name}
          plantCount={dialog.cropId ? plants.filter((p) => p.cropId === dialog.cropId).length : 0}
          onClose={() => setDialog(null)}
          onSave={(fields) => {
            const id = dialog.cropId ?? newCustomCropId();
            saveCustomCrop(customCropFrom(id, fields));
            setDialog(null);
            if (!dialog.cropId) arm(id);
          }}
          onDelete={() => {
            const id = dialog.cropId!;
            const gone = plants.filter((p) => p.cropId === id).map((p) => ({ type: 'removePlant' as const, id: p.id }));
            // The plants go first, while the crop is still known; undo can't bring back a plant of a deleted crop.
            if (gone.length && !apply(gone).ok) return toast('Could not remove those plants');
            deleteCustomCrop(id);
            setHistory([]);
            setSelection([]);
            if (armed === id) toSelect();
            setDialog(null);
          }}
        />
      )}

      <HelpBox tip={tip} />

      <div onPointerDown={(e) => e.stopPropagation()} style={{ position: 'absolute', right: 16, bottom: 16, zIndex: 3, display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ padding: 4, borderRadius: 999, background: 'var(--color-bg)', boxShadow: 'var(--shadow-md)' }}>
          <Compass northDeg={plan.northDeg ?? 0} />
        </div>
        {camera && <ZoomControls percent={zoomPercent(camera)} onZoomOut={() => zoomBy(0.8)} onZoomIn={() => zoomBy(1.25)} onFit={fit} />}
      </div>

      {menu && size && <ContextMenu at={menu.at} size={size} title={menuTitle} items={menuItems} />}

      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  );
}

