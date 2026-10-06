import { describe, expect, it } from 'vitest';
import {
  MAX_WHEEL_ZOOM_DELTA,
  MAX_ZOOM,
  MIN_ZOOM,
  contentTransform,
  fitView,
  gardenToScreen,
  isDrag,
  panBy,
  pinchView,
  screenToGarden,
  wheelZoomFactor,
  zoomAt,
  zoomPercent,
} from './viewport';


describe('view math', () => {
  const view = { zoom: 2, x: 10, y: 20 };

  it('maps screen offsets to garden points', () => {
    expect(screenToGarden(view, 0, 0)).toEqual({ x: 10, y: 20 });
    expect(screenToGarden(view, 40, 10)).toEqual({ x: 30, y: 25 });
  });

  it('zoomAt keeps the point under the cursor fixed', () => {
    const next = zoomAt(view, 40, 10, 2);
    expect(next.zoom).toBe(4);
    expect(screenToGarden(next, 40, 10)).toEqual(screenToGarden(view, 40, 10));
  });

  it('zoomAt clamps at both ends', () => {
    expect(zoomAt(view, 0, 0, 1000).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(view, 0, 0, 0.0001).zoom).toBe(MIN_ZOOM);
  });

  it('panBy moves the camera against the drag', () => {
    expect(panBy(view, 20, -10)).toEqual({ zoom: 2, x: 0, y: 25 });
  });

  it('fitView centers the garden in the area the insets leave clear', () => {
    const insets = { left: 100, right: 0, top: 0, bottom: 0 };
    const v = fitView({ x0: 0, y0: 0, x1: 100, y1: 50 }, 600, 300, insets);
    expect(v.zoom).toBe(5); // 500px / 100″ and 300px / 50″ → the tighter 5
    const center = screenToGarden(v, 100 + 250, 150);
    expect(center.x).toBeCloseTo(50);
    expect(center.y).toBeCloseTo(25);
  });

  it('fitView frames a default patch for an empty garden', () => {
    const v = fitView(null, 960, 480, { left: 0, right: 0, top: 0, bottom: 0 });
    expect(v.zoom).toBe(10);
    expect(screenToGarden(v, 0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('zoomPercent is relative to the planting view’s scale', () => {
    expect(zoomPercent({ zoom: 7, x: 0, y: 0 })).toBe(100);
    expect(zoomPercent({ zoom: 3.5, x: 0, y: 0 })).toBe(50);
  });
});

describe('gardenToScreen', () => {
  it('inverts screenToGarden', () => {
    const view = { zoom: 2.5, x: 30, y: -12 };
    const p = screenToGarden(view, 140, 66);
    const back = gardenToScreen(view, p);
    expect(back.x).toBeCloseTo(140);
    expect(back.y).toBeCloseTo(66);
  });
});

describe('isDrag', () => {
  it('treats exactly the slop as still a click, and anything past it as a drag', () => {
    expect(isDrag(3, 0)).toBe(false);
    expect(isDrag(3.01, 0)).toBe(true);
    expect(isDrag(3, 3)).toBe(true);
  });
});

describe('wheelZoomFactor', () => {
  it('zooms in for a scroll up and out for a scroll down, symmetrically', () => {
    expect(wheelZoomFactor(-10)).toBeGreaterThan(1);
    expect(wheelZoomFactor(10)).toBeLessThan(1);
    expect(wheelZoomFactor(-10) * wheelZoomFactor(10)).toBeCloseTo(1);
    expect(wheelZoomFactor(0)).toBe(1);
  });

  it('caps a mouse-wheel notch at the same step as the maximum delta', () => {
    expect(wheelZoomFactor(100)).toBe(wheelZoomFactor(MAX_WHEEL_ZOOM_DELTA));
    expect(wheelZoomFactor(-100)).toBe(wheelZoomFactor(-MAX_WHEEL_ZOOM_DELTA));
    expect(wheelZoomFactor(MAX_WHEEL_ZOOM_DELTA - 1)).toBeGreaterThan(wheelZoomFactor(MAX_WHEEL_ZOOM_DELTA));
  });
});

describe('fitView maxZoom', () => {
  const none = { left: 0, right: 0, top: 0, bottom: 0 };
  it('does not zoom in past the cap, and keeps the garden centered', () => {
    const v = fitView({ x0: 0, y0: 0, x1: 100, y1: 50 }, 1000, 500, none, 7);
    expect(v.zoom).toBe(7);
    // The garden's center (50, 25) lands at the viewport's center.
    expect(screenToGarden(v, 500, 250)).toEqual({ x: 50, y: 25 });
  });
  it('still zooms out to fit a garden larger than the viewport', () => {
    expect(fitView({ x0: 0, y0: 0, x1: 1000, y1: 500 }, 500, 250, none, 7).zoom).toBeCloseTo(0.5);
  });
});

describe('contentTransform', () => {
  it('puts content at its place in the garden, scaled to the camera', () => {
    const view = { zoom: 14, x: 10, y: 20 };
    const t = contentTransform(view, { x: 12, y: 21 }, 7);
    expect(t).toEqual({ x: 28, y: 14, scale: 2 });
    // A point 7px (1″) into the content draws at translate + 7 × scale.
    const g = screenToGarden(view, t.x + 7 * t.scale, t.y);
    expect(g).toEqual({ x: 13, y: 21 });
  });
});

describe('pinchView', () => {
  const start = { zoom: 7, x: 0, y: 0 };
  it('zooms by the change in finger distance around their midpoint', () => {
    const v = pinchView(start, { x: 100, y: 100 }, { x: 200, y: 100 }, { x: 50, y: 100 }, { x: 250, y: 100 });
    expect(v.zoom).toBe(14);
    // The garden point that was under the midpoint (150, 100) is still under it.
    expect(screenToGarden(v, 150, 100).x).toBeCloseTo(screenToGarden(start, 150, 100).x);
  });
  it('pans with the fingers when the distance is unchanged', () => {
    const v = pinchView(start, { x: 100, y: 100 }, { x: 200, y: 100 }, { x: 130, y: 120 }, { x: 230, y: 120 });
    expect(v.zoom).toBe(7);
    expect(v.x).toBeCloseTo(-30 / 7);
    expect(v.y).toBeCloseTo(-20 / 7);
  });
  it('respects the zoom limits', () => {
    const v = pinchView(start, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, { x: 1000, y: 0 });
    expect(v.zoom).toBe(MAX_ZOOM);
  });
  it('holds still if the fingers started on the same point', () => {
    expect(pinchView(start, { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 50, y: 5 }).zoom).toBe(7);
  });
});