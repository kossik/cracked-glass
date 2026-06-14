import { describe, expect, it } from 'vitest';
import { generateFracture } from '../src/index';

const finite = (arr: ArrayLike<number>) => {
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) return false;
  }
  return true;
};

describe('generateFracture determinism', () => {
  it('same options -> bit-identical pattern (all modes)', () => {
    for (const mode of ['title', 'radial', 'collapse'] as const) {
      const a = generateFracture({ mode, width: 800, height: 450, seed: 42 });
      const b = generateFracture({ mode, width: 800, height: 450, seed: 42 });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('different seeds -> different patterns', () => {
    const a = generateFracture({ mode: 'radial', width: 800, height: 450, seed: 1 });
    const b = generateFracture({ mode: 'radial', width: 800, height: 450, seed: 2 });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('pattern is frozen', () => {
    const p = generateFracture({ mode: 'title', width: 400, height: 300, seed: 5 });
    expect(Object.isFrozen(p)).toBe(true);
    expect(Object.isFrozen(p.shards)).toBe(true);
    expect(Object.isFrozen(p.shards[0])).toBe(true);
    expect(Object.isFrozen(p.shards[0].polygon)).toBe(true);
  });
});

describe('title fracture invariants', () => {
  it('shards exactly tile the rect (area conservation)', () => {
    for (const seed of [1, 7, 99, 12345]) {
      const p = generateFracture({ mode: 'title', width: 880, height: 360, seed });
      const sum = p.shards.reduce((acc, s) => acc + s.area, 0);
      expect(Math.abs(sum - 880 * 360) / (880 * 360)).toBeLessThan(0.005);
    }
  });

  it('without splitters, every boundary vertex appears in both adjacent shards (watertight)', () => {
    const p = generateFracture({
      mode: 'title',
      width: 600,
      height: 400,
      seed: 11,
      bands: { count: 4, diagonalChance: 0 },
    });
    const key = (x: number, y: number) => `${x.toFixed(6)}:${y.toFixed(6)}`;
    const shardPointSets = p.shards.map((s) => {
      const set = new Set<string>();
      for (let i = 0; i + 1 < s.polygon.length; i += 2) set.add(key(s.polygon[i], s.polygon[i + 1]));
      return set;
    });
    // stubs are render-only hairlines and never touch shard geometry
    for (const crack of p.cracks.filter((c) => c.kind !== 'stub')) {
      let count = 0;
      for (const set of shardPointSets) {
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
  });

  it('coordinates are finite, areas positive', () => {
    const p = generateFracture({ mode: 'title', width: 880, height: 360, seed: 3 });
    for (const s of p.shards) {
      expect(finite(s.polygon)).toBe(true);
      expect(finite(s.outsetPolygon)).toBe(true);
      expect(s.area).toBeGreaterThan(0);
    }
  });
});

describe('radial fracture invariants', () => {
  it('shards tile the rect for centered and offset impacts', () => {
    const cases = [
      { x: 480, y: 270 },
      { x: 100, y: 80 },
      { x: 940, y: 520 },
    ];
    for (const impact of cases) {
      const p = generateFracture({ mode: 'radial', width: 960, height: 540, seed: 21, impact });
      const sum = p.shards.reduce((acc, s) => acc + s.area, 0);
      expect(Math.abs(sum - 960 * 540) / (960 * 540)).toBeLessThan(0.01);
      for (const s of p.shards) expect(finite(s.polygon)).toBe(true);
    }
  });

  it('works for degenerate configs (1 ring, no doubling, few rays)', () => {
    const p = generateFracture({
      mode: 'radial',
      width: 300,
      height: 200,
      seed: 8,
      rays: { count: 3, doubling: false },
      rings: { count: 1 },
    });
    expect(p.shards.length).toBeGreaterThan(1);
    const sum = p.shards.reduce((acc, s) => acc + s.area, 0);
    expect(Math.abs(sum - 300 * 200) / (300 * 200)).toBeLessThan(0.02);
  });

  it('micro shards have valid births and finite origins', () => {
    const p = generateFracture({ mode: 'radial', width: 960, height: 540, seed: 4 });
    expect(p.micro.length).toBeGreaterThan(0);
    for (const m of p.micro) {
      expect(m.birth).toBeGreaterThanOrEqual(0);
      expect(m.birth).toBeLessThanOrEqual(1);
      expect(Number.isFinite(m.origin[0])).toBe(true);
      expect(Number.isFinite(m.origin[1])).toBe(true);
      expect(finite(m.polygon)).toBe(true);
    }
  });

  it('crack polylines grow outward (rays start near the impact)', () => {
    const p = generateFracture({ mode: 'radial', width: 960, height: 540, seed: 4 });
    const rays = p.cracks.filter((c) => c.kind === 'ray');
    expect(rays.length).toBeGreaterThan(0);
    for (const r of rays) {
      const d0 = Math.hypot(r.points[0] - p.impact[0], r.points[1] - p.impact[1]);
      const dn = Math.hypot(
        r.points[r.points.length - 2] - p.impact[0],
        r.points[r.points.length - 1] - p.impact[1],
      );
      expect(dn).toBeGreaterThan(d0);
    }
  });
});

describe('collapse fracture invariants', () => {
  it('mesh cells tile the rect across seeds and family angles', () => {
    for (const seed of [1, 7, 42, 9001]) {
      for (const angles of [undefined, { angleA: 30, angleB: 100 }, { angleA: -10, angleB: 55 }]) {
        const p = generateFracture({ mode: 'collapse', width: 960, height: 540, seed, collapse: angles });
        const sum = p.shards.reduce((acc, s) => acc + s.area, 0);
        expect(Math.abs(sum - 960 * 540) / (960 * 540), `seed ${seed} angles ${JSON.stringify(angles)}`).toBeLessThan(0.01);
        for (const s of p.shards) expect(finite(s.polygon)).toBe(true);
      }
    }
  });

  it('has mesh cracks and bottom-up ringIndex rows', () => {
    const p = generateFracture({ mode: 'collapse', width: 960, height: 540, seed: 7 });
    // 'split' = corner-relief chords (default on); 'stub' = hairlines
    expect(p.cracks.every((c) => c.kind === 'mesh' || c.kind === 'stub' || c.kind === 'split')).toBe(true);
    expect(p.cracks.filter((c) => c.kind === 'mesh').length).toBeGreaterThan(3);
    const rows = p.shards.map((s) => s.ringIndex);
    expect(Math.min(...rows)).toBe(0);
    expect(Math.max(...rows)).toBeGreaterThan(0);
    // lower shards (bigger y) get smaller ringIndex (released first)
    const low = p.shards.filter((s) => s.centroid[1] > 440);
    const high = p.shards.filter((s) => s.centroid[1] < 100);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    expect(avg(low.map((s) => s.ringIndex))).toBeLessThan(avg(high.map((s) => s.ringIndex)));
  });
});

describe('deviation (veering cracks)', () => {
  it('area conservation holds even at deviation 1 (non-crossing guarantee)', () => {
    for (const seed of [3, 11, 77, 1234]) {
      for (const mode of ['title', 'radial', 'collapse'] as const) {
        const p = generateFracture({ mode, width: 880, height: 440, seed, deviation: 1 });
        const sum = p.shards.reduce((acc, s) => acc + s.area, 0);
        expect(Math.abs(sum - 880 * 440) / (880 * 440), `${mode} seed ${seed}`).toBeLessThan(0.012);
      }
    }
  });

  it('deviation actually changes the geometry', () => {
    const a = generateFracture({ mode: 'title', width: 800, height: 400, seed: 5, deviation: 0 });
    const b = generateFracture({ mode: 'title', width: 800, height: 400, seed: 5, deviation: 0.9 });
    expect(JSON.stringify(a.shards)).not.toBe(JSON.stringify(b.shards));
  });
});

describe('crack timing', () => {
  it('every crack completes within the crack phase (birth + grow <= ~1)', () => {
    for (const mode of ['title', 'radial', 'collapse'] as const) {
      for (const seed of [1, 7, 99]) {
        const p = generateFracture({ mode, width: 960, height: 540, seed });
        for (const c of p.cracks) {
          expect(c.birth + c.growDuration, `${mode} ${c.id}`).toBeLessThanOrEqual(0.985);
        }
      }
    }
  });
});
