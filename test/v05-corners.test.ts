import { describe, expect, it } from 'vitest';
import { generateFracture } from '../src/index';
import { segmentIntersection, unflattenPts } from '../src/core/geometry';
import type { FracturePattern, Vec2 } from '../src/types';

const key = (x: number, y: number) => `${x.toFixed(6)}:${y.toFixed(6)}`;

/** No shard polygon self-intersects (non-adjacent edges don't cross). */
function noSelfIntersections(p: FracturePattern): void {
  for (const s of p.shards) {
    const pts = unflattenPts(s.polygon);
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const hit = segmentIntersection(pts[i], pts[(i + 1) % n] as Vec2, pts[j], pts[(j + 1) % n] as Vec2);
        if (hit && hit.ta > 1e-6 && hit.ta < 1 - 1e-6 && hit.tb > 1e-6 && hit.tb < 1 - 1e-6) {
          throw new Error(`shard ${s.id} self-intersects (edges ${i},${j})`);
        }
      }
    }
  }
}

/**
 * Each corner-relief 'split' chord's vertices must appear in exactly 2 shard polygons (the
 * ear and the remainder) - the watertight invariant for the cut. (Radial 'crush'/'ring'
 * arcs border more than two cells and are out of scope here; global integrity is covered by
 * area conservation.)
 */
function splitChordsWatertight(p: FracturePattern): void {
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
    expect(count, `crack ${crack.id} (${crack.kind})`).toBe(2);
  }
}

const areaSum = (p: FracturePattern) => p.shards.reduce((a, s) => a + s.area, 0);

describe('corner relief', () => {
  it('is deterministic with relief on', () => {
    for (const mode of ['title', 'radial', 'collapse'] as const) {
      const a = generateFracture({ mode, width: 960, height: 540, seed: 7 });
      const b = generateFracture({ mode, width: 960, height: 540, seed: 7 });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('adds split chords by default and none when corners:false', () => {
    const on = generateFracture({ mode: 'title', width: 960, height: 540, seed: 7 });
    const off = generateFracture({ mode: 'title', width: 960, height: 540, seed: 7, corners: false });
    expect(on.cracks.filter((c) => c.kind === 'split').length).toBeGreaterThan(0);
    expect(off.cracks.filter((c) => c.kind === 'split').length).toBe(0);
    expect(on.shards.length).toBeGreaterThan(off.shards.length);
  });

  it('stays watertight and area-conserving with relief on (all modes, many seeds)', () => {
    for (const mode of ['title', 'radial', 'collapse'] as const) {
      for (const seed of [1, 3, 7, 21, 42, 99, 777, 9001]) {
        const p = generateFracture({ mode, width: 960, height: 540, seed });
        splitChordsWatertight(p);
        expect(Math.abs(areaSum(p) - 960 * 540) / (960 * 540)).toBeLessThan(0.005);
      }
    }
  });

  it('keeps id->hash stable for every shard that existed without relief (index-stable)', () => {
    for (const mode of ['title', 'radial', 'collapse'] as const) {
      const off = generateFracture({ mode, width: 960, height: 540, seed: 7, corners: false });
      const on = generateFracture({ mode, width: 960, height: 540, seed: 7 });
      const onById = new Map(on.shards.map((s) => [s.id, s.hash]));
      for (const s of off.shards) {
        // every pre-relief shard id still exists and keeps its hash (relief never renumbers)
        expect(onById.get(s.id)).toBe(s.hash);
      }
    }
  });

  it('survives near-edge and on-corner radial impacts without tearing', () => {
    const impacts = [
      { x: 0, y: 270 },
      { x: 960, y: 540 },
      { x: 952, y: 534 },
      { x: 1, y: 270 },
      { x: 8, y: 6 },
    ];
    for (const seed of [3, 21, 42, 9001]) {
      for (const impact of impacts) {
        const p = generateFracture({ mode: 'radial', width: 960, height: 540, seed, impact });
        splitChordsWatertight(p);
        expect(Math.abs(areaSum(p) - 960 * 540) / (960 * 540)).toBeLessThan(0.005);
        // the crush plug is never split: exactly one ringIndex-0 shard remains
        expect(p.shards.filter((s) => s.ringIndex === 0).length).toBe(1);
      }
    }
  });

  it('never introduces relief-caused self-intersection on extreme aspect ratios', () => {
    // re-entrant owners (thin pane + heavy jagging + radial) were the one review finding;
    // the ear-emptiness guard must keep every relieved shard simple. Compare against the
    // self-intersections the base generator already has (corners off) - relief adds none.
    for (const [w, h] of [
      [300, 1200],
      [1200, 300],
      [200, 1000],
    ] as const) {
      for (const seed of [2, 24, 299, 7, 41]) {
        const opts = { mode: 'radial' as const, width: w, height: h, seed, jaggedness: 1, edgeDetail: 3 as const, deviation: 1 };
        const off = generateFracture({ ...opts, corners: false });
        let offBad = false;
        try {
          noSelfIntersections(off);
        } catch {
          offBad = true;
        }
        if (offBad) continue; // base generator already self-intersects here - out of scope
        const on = generateFracture({ ...opts, corners: { relief: 1 } });
        expect(() => noSelfIntersections(on)).not.toThrow();
      }
    }
  });

  it('hero mode ignores corner relief', () => {
    const p = generateFracture({ mode: 'hero', width: 960, height: 540, seed: 7, hero: { count: 2 } });
    expect(p.shards.length).toBe(2);
    expect(p.cracks.filter((c) => c.kind === 'split').length).toBe(0);
  });

  it('relief 0 matches corners:false (explicit zero anchor)', () => {
    const a = generateFracture({ mode: 'title', width: 880, height: 360, seed: 5, corners: { relief: 0 } });
    const b = generateFracture({ mode: 'title', width: 880, height: 360, seed: 5, corners: false });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
