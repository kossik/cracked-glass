import { describe, expect, it } from 'vitest';
import { computeFrame, generateFracture, staticCrackedTimeline } from '../src/index';
import { segmentIntersection, unflattenPts } from '../src/core/geometry';
import type { Vec2 } from '../src/types';

const finite = (arr: ArrayLike<number>) => {
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) return false;
  }
  return true;
};

/** True when the closed polygon has no self-intersections (non-adjacent edges only). */
function isSimplePolygon(flat: number[]): boolean {
  const pts = unflattenPts(flat);
  const n = pts.length;
  const edge = (i: number): [Vec2, Vec2] => [pts[i], pts[(i + 1) % n]];
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent through the closure
      const [a1, a2] = edge(i);
      const [b1, b2] = edge(j);
      const hit = segmentIntersection(a1, a2, b1, b2);
      if (hit && hit.ta > 1e-6 && hit.ta < 1 - 1e-6 && hit.tb > 1e-6 && hit.tb < 1 - 1e-6) {
        return false;
      }
    }
  }
  return true;
}

describe('hero fracture mode', () => {
  it('same options -> bit-identical pattern', () => {
    for (const count of [1, 2, 3]) {
      const a = generateFracture({ mode: 'hero', width: 960, height: 540, seed: 7, hero: { count } });
      const b = generateFracture({ mode: 'hero', width: 960, height: 540, seed: 7, hero: { count } });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('emits exactly hero.count free shards, zero cracks, zero micro', () => {
    for (const seed of [1, 7, 99, 12345]) {
      for (const count of [1, 2, 3]) {
        const p = generateFracture({ mode: 'hero', width: 960, height: 540, seed, hero: { count } });
        expect(p.shards.length).toBe(count);
        expect(p.cracks.length).toBe(0);
        expect(p.micro.length).toBe(0);
        expect(p.mode).toBe('hero');
      }
    }
  });

  it('polygons are finite, positive-area, simple (no self-intersections)', () => {
    for (const seed of [1, 2, 3, 7, 42, 99, 1234, 99999]) {
      const p = generateFracture({
        mode: 'hero',
        width: 960,
        height: 540,
        seed,
        hero: { count: 3, sizeFrac: 0.3 },
        jaggedness: 1,
        edgeDetail: 3,
      });
      for (const s of p.shards) {
        expect(finite(s.polygon)).toBe(true);
        expect(s.area).toBeGreaterThan(100);
        expect(isSimplePolygon(s.polygon)).toBe(true);
      }
    }
  });

  it('overlap pulls the two shards together', () => {
    const apart = generateFracture({ mode: 'hero', width: 960, height: 540, seed: 7, hero: { count: 2, overlap: 0 } });
    const close = generateFracture({ mode: 'hero', width: 960, height: 540, seed: 7, hero: { count: 2, overlap: 1 } });
    const dist = (p: typeof apart) =>
      Math.hypot(
        p.shards[0].centroid[0] - p.shards[1].centroid[0],
        p.shards[0].centroid[1] - p.shards[1].centroid[1],
      );
    expect(dist(close)).toBeLessThan(dist(apart));
  });
});

describe('hero levitation', () => {
  const pattern = generateFracture({ mode: 'hero', width: 960, height: 540, seed: 7 });
  const fx = { timeline: staticCrackedTimeline } as const;

  it('moves the shard as a pure function of t and loops over [0, 1]', () => {
    const f0 = computeFrame(0, pattern, fx);
    const f05 = computeFrame(0.5, pattern, fx);
    const f1 = computeFrame(1, pattern, fx);
    const r0 = f0.shards[0].raw.rigid;
    const r05 = f05.shards[0].raw.rigid;
    const r1 = f1.shards[0].raw.rigid;
    expect(Math.hypot(r05.dx - r0.dx, r05.dy - r0.dy)).toBeGreaterThan(0.5);
    // integer cycles -> t=0 and t=1 are the same pose (seamless loop)
    expect(r1.dx).toBeCloseTo(r0.dx, 9);
    expect(r1.dy).toBeCloseTo(r0.dy, 9);
    expect(r1.rotZ).toBeCloseTo(r0.rotZ, 9);
  });

  it('float zeroed -> rigid pose is static across t', () => {
    const still = { ...fx, float: { bobPx: 0, swayPx: 0, rotDeg: 0, cycles: 1 } };
    const a = computeFrame(0.2, pattern, still).shards[0].raw.rigid;
    const b = computeFrame(0.8, pattern, still).shards[0].raw.rigid;
    expect(a).toEqual(b);
  });

  it('FrameData structure is constant across t', () => {
    const shape = (t: number) => {
      const f = computeFrame(t, pattern, fx);
      return f.shards
        .map((s) => `${s.chroma.length}:${s.smear.length}:${s.bevel.length}:${s.facet ? 1 : 0}:${s.spectrum ? 1 : 0}`)
        .join('|');
    };
    const ref = shape(0);
    for (const t of [0.1, 0.33, 0.5, 0.77, 1]) expect(shape(t)).toBe(ref);
  });

  it('no forced outlier on a lone hero shard', () => {
    const f = computeFrame(0.5, pattern, fx);
    // a forced 'slipped' outlier would offset the shard by outliers.slipPx (10px) - the
    // levitation amplitude (<= bob+sway = 16px combined; per-axis <= 10) stays below that
    expect(Math.abs(f.shards[0].raw.rigid.dx)).toBeLessThanOrEqual(6);
    expect(Math.abs(f.shards[0].raw.rigid.dy)).toBeLessThanOrEqual(10);
  });
});

describe('byte anchors: hero additions change nothing for existing modes', () => {
  it('fx.float is ignored outside hero mode', () => {
    for (const mode of ['title', 'radial', 'collapse'] as const) {
      const p = generateFracture({ mode, width: 800, height: 450, seed: 42 });
      for (const t of [0, 0.25, 0.62, 1]) {
        const plain = computeFrame(t, p);
        const floated = computeFrame(t, p, { float: { bobPx: 500, swayPx: 500, rotDeg: 90, cycles: 7 } });
        expect(JSON.stringify(floated)).toBe(JSON.stringify(plain));
      }
    }
  });
});
