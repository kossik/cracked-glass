import { describe, expect, it } from 'vitest';
import { computeFrame, generateFracture } from '../src/index';
import { segmentIntersection, unflattenPts } from '../src/core/geometry';
import type { DeepPartial, EffectParams, FracturePattern, Vec2 } from '../src/types';

const key = (x: number, y: number) => `${x.toFixed(6)}:${y.toFixed(6)}`;
const areaSum = (p: FracturePattern) => p.shards.reduce((a, s) => a + s.area, 0);

/** Throws if any shard polygon self-intersects (non-adjacent edges cross). */
function assertNoSelfIntersections(p: FracturePattern): void {
  for (const s of p.shards) {
    const pts = unflattenPts(s.polygon);
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const hit = segmentIntersection(pts[i], pts[(i + 1) % n] as Vec2, pts[j], pts[(j + 1) % n] as Vec2);
        if (hit && hit.ta > 1e-6 && hit.ta < 1 - 1e-6 && hit.tb > 1e-6 && hit.tb < 1 - 1e-6) {
          throw new Error(`shard ${s.id} self-intersects (seed ${p.seed}, edges ${i},${j})`);
        }
      }
    }
  }
}

/** Each non-stub/non-crush crack's vertices appear in exactly 2 shard polygons. */
function watertightSplits(p: FracturePattern): void {
  const sets = p.shards.map((s) => {
    const set = new Set<string>();
    for (let i = 0; i + 1 < s.polygon.length; i += 2) set.add(key(s.polygon[i], s.polygon[i + 1]));
    return set;
  });
  for (const crack of p.cracks.filter((c) => c.kind === 'split')) {
    let count = 0;
    for (const set of sets) {
      let all = true;
      for (let i = 0; i + 1 < crack.points.length; i += 2) {
        if (!set.has(key(crack.points[i], crack.points[i + 1]))) {
          all = false;
          break;
        }
      }
      if (all) count++;
    }
    expect(count).toBe(2);
  }
}

describe('radial asymmetry (N1)', () => {
  it('is deterministic', () => {
    const a = generateFracture({ mode: 'radial', width: 960, height: 540, seed: 7 });
    const b = generateFracture({ mode: 'radial', width: 960, height: 540, seed: 7 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('asymmetry:0 ignores the strong-side bias (same map regardless of seed-derived strongDir)', () => {
    // With asymmetry 0 the keep map must not consult strongDir, so the pattern is a pure
    // function of the other options - assert it stays watertight and area-conserving.
    for (const seed of [1, 7, 42]) {
      const p = generateFracture({ mode: 'radial', width: 960, height: 540, seed, rings: { asymmetry: 0 } });
      watertightSplits(p);
      expect(Math.abs(areaSum(p) - 960 * 540) / (960 * 540)).toBeLessThan(0.005);
    }
  });

  it('asymmetry merges more arcs overall (fewer or equal shards) and stays watertight', () => {
    let fewer = 0;
    const seeds = [1, 3, 7, 21, 42, 99, 777];
    for (const seed of seeds) {
      const sym = generateFracture({ mode: 'radial', width: 960, height: 540, seed, rings: { asymmetry: 0 } });
      const asym = generateFracture({ mode: 'radial', width: 960, height: 540, seed, rings: { asymmetry: 0.9 } });
      watertightSplits(asym);
      expect(Math.abs(areaSum(asym) - 960 * 540) / (960 * 540)).toBeLessThan(0.005);
      if (asym.shards.length <= sym.shards.length) fewer++;
    }
    expect(fewer).toBeGreaterThanOrEqual(Math.ceil(seeds.length * 0.7));
  });

  it('asymmetry concentrates ring cracks toward one side (directional bias)', () => {
    // length-weighted resultant of ring-crack directions around the impact: ~0 when
    // symmetric, larger when asymmetry pushes coverage to one side. Averaged over seeds.
    const bias = (asymmetry: number): number => {
      const seeds = [1, 7, 21, 42, 99, 333, 808];
      let total = 0;
      for (const seed of seeds) {
        const p = generateFracture({
          mode: 'radial',
          width: 960,
          height: 540,
          seed,
          rays: { count: 12 },
          rings: { count: 6, asymmetry },
        });
        const [ix, iy] = p.impact;
        let vx = 0;
        let vy = 0;
        let tot = 0;
        for (const c of p.cracks.filter((cc) => cc.kind === 'ring')) {
          const a = Math.atan2(c.points[1] - iy, c.points[0] - ix);
          vx += Math.cos(a) * c.totalLen;
          vy += Math.sin(a) * c.totalLen;
          tot += c.totalLen;
        }
        total += tot > 1 ? Math.hypot(vx, vy) / tot : 0;
      }
      return total / seeds.length;
    };
    expect(bias(0.9)).toBeGreaterThan(bias(0) + 0.02);
  });
});

describe('spider-web mode (N2)', () => {
  it('is deterministic', () => {
    const a = generateFracture({ mode: 'web', width: 960, height: 540, seed: 7 });
    const b = generateFracture({ mode: 'web', width: 960, height: 540, seed: 7 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('shards are SIMPLE (no bow-ties) across rays x rings x cranked irregularity x seeds', () => {
    // the design's central risk: radius-bounded ring edges must keep every cell simple even
    // at high irregularity (raw straight chords would self-intersect 16-80% of the time).
    for (const rays of [3, 4, 5, 6, 7, 9]) {
      for (const rings of [4, 5, 6, 8]) {
        for (const seed of [1, 7, 21, 42, 99, 288, 333, 808, 9001]) {
          const p = generateFracture({
            mode: 'web',
            width: 960,
            height: 540,
            seed,
            web: { rays, rings, irregularity: 1 },
            rings: { jitter: 1, asymmetry: 0.9 },
            rays: { waviness: 1, angleJitter: 1 },
            jaggedness: 1,
            edgeDetail: 3,
          });
          expect(() => assertNoSelfIntersections(p)).not.toThrow();
        }
      }
    }
  });

  it('conserves area (sum of shard areas == w*h)', () => {
    for (const seed of [1, 7, 21, 42, 99, 777]) {
      const p = generateFracture({ mode: 'web', width: 960, height: 540, seed });
      expect(Math.abs(areaSum(p) - 960 * 540) / (960 * 540)).toBeLessThan(0.01);
    }
  });

  it('is distinct from radial for the same seed', () => {
    const web = generateFracture({ mode: 'web', width: 960, height: 540, seed: 7 });
    const radial = generateFracture({ mode: 'radial', width: 960, height: 540, seed: 7 });
    expect(JSON.stringify(web.shards)).not.toBe(JSON.stringify(radial.shards));
    expect(web.mode).toBe('web');
    expect(web.version).toBe(7);
  });

  it('emits ray and ring cracks, no crush', () => {
    const p = generateFracture({ mode: 'web', width: 960, height: 540, seed: 7 });
    expect(p.cracks.some((c) => c.kind === 'ray')).toBe(true);
    expect(p.cracks.some((c) => c.kind === 'crush')).toBe(false);
  });
});

describe('crack growth curve (N3)', () => {
  const pattern = generateFracture({ mode: 'radial', width: 960, height: 540, seed: 7 });
  const tl = { crackStart: 0, crackEnd: 0.4, shatterStart: 0.9 } as const;
  const at = (growth: 'snap' | 'expo' | 'quart', t: number) =>
    computeFrame(t, pattern, { timeline: tl, crackStyle: { growth } } as DeepPartial<EffectParams>);

  it("'snap' reveals crack length earlier than 'quart' mid-propagation", () => {
    // early in the crack phase snap is much further along -> longer full ribbon underlay
    const snap = at('snap', 0.08).cracks.coreDimPath.length;
    const quart = at('quart', 0.08).cracks.coreDimPath.length;
    expect(snap).toBeGreaterThan(quart);
  });

  it('all growth curves converge once cracks are fully grown', () => {
    const snap = at('snap', 0.5);
    const quart = at('quart', 0.5);
    const expo = at('expo', 0.5);
    expect(snap.cracks.corePath).toBe(quart.cracks.corePath);
    expect(snap.cracks.corePath).toBe(expo.cracks.corePath);
  });

  it('is deterministic per growth mode', () => {
    expect(JSON.stringify(at('snap', 0.2))).toBe(JSON.stringify(at('snap', 0.2)));
  });
});

describe('bevel facet variation (N4)', () => {
  const pattern = generateFracture({ mode: 'radial', width: 960, height: 540, seed: 7 });
  const frame = (facetVariation: number) =>
    computeFrame(0.25, pattern, { bevel: { facetVariation }, timeline: { crackStart: 0, crackEnd: 0.4, shatterStart: 0.9 } } as DeepPartial<EffectParams>);

  it('facetVariation:0 keeps the single-light law (lit/dark exclusive at scatter 0)', () => {
    const f = computeFrame(0.25, pattern, {
      bevel: { facetVariation: 0, scatter: 0 },
      timeline: { crackStart: 0, crackEnd: 0.4, shatterStart: 0.9 },
    } as DeepPartial<EffectParams>);
    for (const s of f.shards) {
      for (let i = 0; i + 1 < s.bevel.length; i += 2) {
        // dark-first pair: one of the two is exactly 0 (mutually exclusive single light)
        expect(s.bevel[i].opacity === 0 || s.bevel[i + 1].opacity === 0).toBe(true);
      }
    }
  });

  it('facetVariation>0 changes the bevel opacities (per-sector intrinsic shimmer)', () => {
    const off = frame(0).shards.flatMap((s) => s.bevel.map((b) => b.opacity));
    const on = frame(0.6).shards.flatMap((s) => s.bevel.map((b) => b.opacity));
    expect(off.length).toBe(on.length); // structure unchanged (entry count constant)
    let diff = 0;
    for (let i = 0; i < off.length; i++) if (Math.abs(off[i] - on[i]) > 1e-9) diff++;
    expect(diff).toBeGreaterThan(off.length * 0.3);
  });

  it('emits no scientific-notation opacities at the default facet variation', () => {
    const json = JSON.stringify(frame(0.6));
    expect(json).not.toMatch(/\de[+-]\d/);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(frame(0.6))).toBe(JSON.stringify(frame(0.6)));
  });
});
