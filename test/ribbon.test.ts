import { describe, expect, it } from 'vitest';
import { miterFrame, partialPolylineWithS, ribbonPath } from '../src/render/cracks';
import { computeFrame, generateFracture } from '../src/index';
import type { Vec2 } from '../src/types';

describe('crack ribbon geometry', () => {
  const line: Vec2[] = [
    [0, 0],
    [10, 0],
    [20, 5],
    [30, 5],
  ];

  it('partialPolylineWithS returns absolute stations and an interpolated tip', () => {
    const cum = [0, 10, 10 + Math.hypot(10, 5), 10 + Math.hypot(10, 5) + 10];
    const part = partialPolylineWithS(line, cum, 15);
    expect(part.pts.length).toBe(3);
    expect(part.s[0]).toBe(0);
    expect(part.s[1]).toBe(10);
    expect(part.s[2]).toBe(15);
    // tip lies on the second segment
    const t = 5 / Math.hypot(10, 5);
    expect(part.pts[2][0]).toBeCloseTo(10 + 10 * t, 6);
  });

  it('miterFrame: unit miters, scale clamped to 2, sane width caps', () => {
    const f = miterFrame(line);
    expect(f.mx.length).toBe(line.length);
    for (let i = 0; i < line.length; i++) {
      expect(Math.hypot(f.mx[i], f.my[i])).toBeCloseTo(1, 6);
      expect(f.scale[i]).toBeLessThanOrEqual(2);
      expect(f.scale[i]).toBeGreaterThan(0);
      expect(f.maxHalf[i]).toBeGreaterThan(0);
    }
  });

  it('ribbonPath emits a closed finite path', () => {
    const f = miterFrame(line);
    const d = ribbonPath(line, f, [1, 1.4, 0.8, 0], 0, 0);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d).not.toMatch(/NaN/);
    // 2 chains x 4 points: one M plus 7 Ls
    expect((d.match(/L/g) ?? []).length).toBe(7);
  });

  it('crackLayer integration: ribbons and filaments are sane at scrubbed ts', () => {
    const pattern = generateFracture({ mode: 'title', width: 880, height: 360, seed: 7 });
    for (const t of [0.1, 0.2, 0.5, 1]) {
      const frame = computeFrame(t, pattern, { timeline: { crackStart: 0, crackEnd: 0.6, shatterStart: Infinity } });
      const c = frame.cracks;
      for (const s of [c.corePath, c.shadowPath, c.highlightPath, c.hacklePath]) {
        expect(s).not.toMatch(/NaN/);
        expect(s).not.toMatch(/\de[+-]\d/);
      }
      if (t >= 0.5) {
        expect(c.corePath).toContain('Z'); // ribbons are closed fills
        expect(c.shadowPath).toContain('Z');
      }
    }
  });
});
