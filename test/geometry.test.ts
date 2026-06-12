import { describe, expect, it } from 'vitest';
import { fmt } from '../src/core/math';
import {
  clipPolygonToRect,
  cumulativeLengths,
  offsetPolygon,
  pointAtLength,
  signedArea,
  toCssPolygon,
} from '../src/core/geometry';
import type { Vec2 } from '../src/types';

describe('fmt', () => {
  it('strips trailing zeros and normalizes -0', () => {
    expect(fmt(1.5)).toBe('1.5');
    expect(fmt(1.0)).toBe('1');
    expect(fmt(-0.0001)).toBe('0');
    expect(fmt(-0)).toBe('0');
    expect(fmt(2.456, 2)).toBe('2.46');
    expect(fmt(NaN)).toBe('0');
    expect(fmt(1e-15)).toBe('0');
  });
  it('never emits exponent notation', () => {
    for (const v of [1e-9, 123456789.123, -1e-12, 5e5]) {
      expect(fmt(v, 4)).not.toMatch(/e/i);
    }
  });
});

describe('polygon math', () => {
  const square: Vec2[] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];

  it('signedArea is positive for screen-clockwise winding', () => {
    expect(signedArea(square)).toBe(100);
  });

  it('clipPolygonToRect keeps an inner polygon intact', () => {
    const clipped = clipPolygonToRect(square, 20, 20);
    expect(Math.abs(signedArea(clipped))).toBeCloseTo(100, 6);
  });

  it('clipPolygonToRect clips an overflowing polygon', () => {
    const big: Vec2[] = [
      [-10, -10],
      [30, -10],
      [30, 30],
      [-10, 30],
    ];
    const clipped = clipPolygonToRect(big, 20, 20);
    expect(Math.abs(signedArea(clipped))).toBeCloseTo(400, 6);
  });

  it('clipPolygonToRect returns empty for fully outside polygons', () => {
    const out: Vec2[] = [
      [100, 100],
      [110, 100],
      [110, 110],
    ];
    expect(clipPolygonToRect(out, 20, 20)).toHaveLength(0);
  });

  it('offsetPolygon grows the area outward', () => {
    const grown = offsetPolygon(square, 1);
    expect(signedArea(grown)).toBeGreaterThan(signedArea(square));
    expect(signedArea(grown)).toBeCloseTo(144, 1); // 12x12
  });

  it('pointAtLength walks the polyline', () => {
    const line: Vec2[] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    const cum = cumulativeLengths(line);
    expect(cum[2]).toBe(20);
    expect(pointAtLength(line, cum, 5)).toEqual([5, 0]);
    expect(pointAtLength(line, cum, 15)).toEqual([10, 5]);
    expect(pointAtLength(line, cum, 99)).toEqual([10, 10]);
  });

  it('toCssPolygon emits px pairs', () => {
    expect(toCssPolygon([0, 0, 10.5, 0, 10.5, 3])).toBe('polygon(0px 0px, 10.5px 0px, 10.5px 3px)');
  });
});
