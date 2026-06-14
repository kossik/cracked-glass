import { describe, expect, it } from 'vitest';
import { computeFrame, generateFracture, staticCrackedTimeline } from '../src/index';
import { insetPolygonTowardCentroid, ringPathD } from '../src/core/geometry';
import type { FracturePattern, ShardFrame } from '../src/types';

const heroPattern = generateFracture({ mode: 'hero', width: 960, height: 540, seed: 7 });
const radialPattern = generateFracture({ mode: 'radial', width: 960, height: 540, seed: 7 });
const heroFx = { timeline: staticCrackedTimeline } as const;

describe('edge refraction ring', () => {
  it('strength 0 (default) emits no edge layer - v0.4 anchor', () => {
    const f = computeFrame(0.5, heroPattern, heroFx);
    for (const s of f.shards) expect(s.edge).toBeNull();
  });

  it('draft quality disables the ring even at full strength', () => {
    const f = computeFrame(0.5, heroPattern, {
      ...heroFx,
      quality: 'draft',
      edgeDistortion: { strength: 1 },
    });
    for (const s of f.shards) expect(s.edge).toBeNull();
  });

  it('enabling the ring changes ONLY the edge field (everything else byte-stable)', () => {
    for (const t of [0.3, 0.5, 0.8]) {
      const base = computeFrame(t, heroPattern, heroFx);
      const withEdge = computeFrame(t, heroPattern, { ...heroFx, edgeDistortion: { strength: 0.8 } });
      const strip = (s: ShardFrame) => ({ ...s, edge: null });
      expect(JSON.stringify(withEdge.shards.map(strip))).toBe(JSON.stringify(base.shards.map(strip)));
      for (const s of withEdge.shards) expect(s.edge).not.toBeNull();
    }
  });

  it('ring path = two subpaths (outer + reversed inner), CSS clip wraps it in path()', () => {
    const f = computeFrame(0.5, heroPattern, { ...heroFx, edgeDistortion: { strength: 0.8 } });
    for (const s of f.shards) {
      const subpaths = s.edge!.d.match(/M/g) ?? [];
      expect(subpaths.length).toBe(2);
      expect(s.edge!.d.match(/Z/g)?.length).toBe(2);
      expect(s.edge!.clipPath).toBe(`path("${s.edge!.d}")`);
    }
  });

  it('inset loop lies strictly inside the outer polygon (closer to the centroid)', () => {
    for (const s of heroPattern.shards) {
      const inner = insetPolygonTowardCentroid(s.polygon, s.centroid, 12);
      expect(inner.length).toBe(s.polygon.length);
      for (let i = 0; i + 1 < inner.length; i += 2) {
        const dOuter = Math.hypot(s.polygon[i] - s.centroid[0], s.polygon[i + 1] - s.centroid[1]);
        const dInner = Math.hypot(inner[i] - s.centroid[0], inner[i + 1] - s.centroid[1]);
        expect(dInner).toBeLessThan(dOuter + 1e-9);
      }
      expect(ringPathD(s.polygon, inner).startsWith('M')).toBe(true);
    }
  });

  it('amplifies the refraction (ring offset > content offset) and stays t-structure-constant', () => {
    const fx = { ...heroFx, edgeDistortion: { strength: 1 } };
    const shape = (t: number) =>
      computeFrame(t, heroPattern, fx)
        .shards.map((s) => (s.edge ? 1 : 0))
        .join('');
    const ref = shape(0);
    for (const t of [0.2, 0.5, 0.9, 1]) expect(shape(t)).toBe(ref);
    const f = computeFrame(0.5, heroPattern, fx);
    for (const s of f.shards) {
      const e = s.edge!;
      const contentMag = Math.hypot(s.raw.refraction.dx, s.raw.refraction.dy);
      expect(Math.hypot(e.dx, e.dy)).toBeGreaterThan(contentMag * 1.5);
    }
  });
});

describe('edge spectrum (spectrum.edgeOnly)', () => {
  it('edgeOnly 0 (default) -> no ring clip on the flare - v0.4 anchor', () => {
    const f = computeFrame(0.5, radialPattern, {});
    for (const s of f.shards) {
      if (s.spectrum) {
        expect(s.spectrum.clipPath).toBeUndefined();
        expect(s.spectrum.d).toBeUndefined();
      }
    }
  });

  it('edgeOnly 0 selection/placement is byte-identical to omitting the param', () => {
    for (const t of [0.3, 0.62]) {
      const a = computeFrame(t, radialPattern, {});
      const b = computeFrame(t, radialPattern, { spectrum: { edgeOnly: 0 } });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('edgeOnly 1 clips the flare to a perimeter ring and narrows the band', () => {
    const base = computeFrame(0.62, radialPattern, {});
    const edged = computeFrame(0.62, radialPattern, { spectrum: { edgeOnly: 1 } });
    const carriersBase = base.shards.filter((s) => s.spectrum);
    const carriersEdged = edged.shards.filter((s) => s.spectrum);
    expect(carriersEdged.length).toBeGreaterThan(0);
    expect(carriersEdged.length).toBe(carriersBase.length);
    for (const s of carriersEdged) {
      expect(s.spectrum!.clipPath).toMatch(/^path\("M/);
      expect((s.spectrum!.d!.match(/M/g) ?? []).length).toBe(2);
    }
    const avgW = (list: ShardFrame[]) =>
      list.reduce((a, s) => a + s.spectrum!.width01, 0) / list.length;
    expect(avgW(carriersEdged)).toBeLessThan(avgW(carriersBase));
  });

  it('edgeOnly 1 weights the selection toward smaller shards (fixed seed)', () => {
    const pick = (edgeOnly: number, p: FracturePattern) => {
      const f = computeFrame(0.62, p, { spectrum: { edgeOnly, count: 2 } });
      const idx: number[] = [];
      f.shards.forEach((s, i) => {
        if (s.spectrum) idx.push(i);
      });
      return idx;
    };
    const avgArea = (idx: number[], p: FracturePattern) =>
      idx.reduce((a, i) => a + p.shards[i].area, 0) / Math.max(1, idx.length);
    // averaged over seeds to keep the assertion robust yet deterministic
    let smaller = 0;
    let total = 0;
    for (const seed of [1, 7, 21, 99]) {
      const p = generateFracture({ mode: 'radial', width: 960, height: 540, seed });
      const a0 = avgArea(pick(0, p), p);
      const a1 = avgArea(pick(1, p), p);
      total++;
      if (a1 <= a0) smaller++;
    }
    expect(smaller).toBeGreaterThanOrEqual(Math.ceil(total * 0.75));
  });
});

describe('M2 determinism', () => {
  it('full M2 fx: identical t in any order -> byte-identical FrameData', () => {
    const fx = {
      ...heroFx,
      edgeDistortion: { strength: 0.8, widthPx: 14, blurPx: 1 },
      spectrum: { edgeOnly: 1, count: 2 },
    };
    const ts = [0.9, 0.1, 0.5, 0.1, 0.9];
    const runs = ts.map((t) => JSON.stringify(computeFrame(t, heroPattern, fx)));
    expect(runs[1]).toBe(runs[3]);
    expect(runs[0]).toBe(runs[4]);
  });
});
