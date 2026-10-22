import { describe, expect, it } from 'vitest';
import { cleanLines, isValidLine, lineLengthIn } from './lines';

const line = (id: string, ax = 0, ay = 0, bx = 10, by = 0) => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by } });

describe('isValidLine', () => {
  it('accepts a line with two different end points', () => {
    expect(isValidLine(line('l'))).toBe(true);
    expect(isValidLine(line('l', 0, 0, 0, 1))).toBe(true);
  });
  it('rejects a zero-length line, a missing id and non-finite or missing points', () => {
    expect(isValidLine(line('l', 5, 5, 5, 5))).toBe(false);
    expect(isValidLine(line(''))).toBe(false);
    expect(isValidLine(line('l', NaN))).toBe(false);
    expect(isValidLine({ id: 'l', a: { x: 0, y: 0 } })).toBe(false);
    expect(isValidLine(null)).toBe(false);
    expect(isValidLine('line')).toBe(false);
  });
});

describe('cleanLines', () => {
  it('keeps good lines in order and drops bad ones and repeated ids', () => {
    expect(cleanLines([line('a'), { nope: 1 }, line('a', 1, 1, 2, 2), line('b')]).map((l) => l.id)).toEqual(['a', 'b']);
  });
  it('treats anything but a list as no lines', () => {
    expect(cleanLines(undefined)).toEqual([]);
    expect(cleanLines({ 0: line('a') })).toEqual([]);
  });
});

describe('lineLengthIn', () => {
  it('measures straight-line distance', () => {
    expect(lineLengthIn(line('l', 0, 0, 3, 4))).toBe(5);
  });
});
