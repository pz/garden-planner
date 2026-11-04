import { describe, expect, it } from 'vitest';
import { HARD_SPACING_FACTOR, edgeSpill, isProblemSpacing, isSpacingConflict, requiredGap, spacingPenalty, violatesHardSpacing } from './rules';

describe('spacing thresholds', () => {
  it('averages the two spacings', () => {
    expect(requiredGap(10, 24)).toBe(17);
  });
  it('is no conflict exactly at the gap, a conflict just inside it', () => {
    expect(isSpacingConflict(10, 10)).toBe(false);
    expect(isSpacingConflict(9.99, 10)).toBe(true);
  });
  it('is a problem only strictly inside 0.7 of the gap', () => {
    expect(isProblemSpacing(7, 10)).toBe(false);
    expect(isProblemSpacing(6.99, 10)).toBe(true);
  });
  it('forbids placing at or just above the problem line, but not clearly outside it', () => {
    expect(violatesHardSpacing(6.99, 10)).toBe(true);
    expect(violatesHardSpacing(7, 10)).toBe(true);
    expect(violatesHardSpacing(7.001, 10)).toBe(false);
  });
});

describe('spacingPenalty', () => {
  it('is 0 at and beyond the gap, 1 at the hard floor, and quadratic between', () => {
    expect(spacingPenalty(10, 10)).toBe(0);
    expect(spacingPenalty(12, 10)).toBe(0);
    expect(spacingPenalty(10 * HARD_SPACING_FACTOR, 10)).toBeCloseTo(1, 12);
    expect(spacingPenalty(8.5, 10)).toBeCloseTo(0.25, 12); // halfway to the floor
    expect(spacingPenalty(9.99, 10)).toBeGreaterThan(0);
    expect(spacingPenalty(9.99, 10)).toBeLessThan(0.0002);
  });
});

describe('edgeSpill', () => {
  const rect = { shape: 'rect' as const, widthIn: 48, heightIn: 48, cornerRadiusIn: 0 };
  it('is 0 for a plant whose room is wholly inside, and when it just touches the wall', () => {
    expect(edgeSpill({ x: 24, y: 24 }, 12, rect)).toBe(0);
    expect(edgeSpill({ x: 6, y: 24 }, 12, rect)).toBe(0);
  });
  it('counts 3 of 8 samples for a plant on a straight wall, 5 of 8 in a corner', () => {
    expect(edgeSpill({ x: 0, y: 24 }, 12, rect)).toBe(3 / 8);
    expect(edgeSpill({ x: 24, y: 48 }, 12, rect)).toBe(3 / 8);
    expect(edgeSpill({ x: 0, y: 0 }, 12, rect)).toBe(5 / 8);
  });
  it('is 1 well outside the bed', () => {
    expect(edgeSpill({ x: -50, y: -50 }, 12, rect)).toBe(1);
  });
  it('sees an ellipse’s curve', () => {
    const e = { shape: 'ellipse' as const, widthIn: 48, heightIn: 48 };
    expect(edgeSpill({ x: 24, y: 24 }, 12, e)).toBe(0);
    expect(edgeSpill({ x: 24, y: 1 }, 12, e)).toBeGreaterThan(0);
  });
});
