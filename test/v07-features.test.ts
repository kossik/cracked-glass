import { describe, expect, it } from 'vitest';
import { computeFrame, generateFracture } from '../src/index';
import { segmentIntersection, unflattenPts } from '../src/core/geometry';
import { webOrigin } from '../src/fracture/web';
import type { DeepPartial, EffectParams, FracturePattern, Vec2 } from '../src/types';

const titlePattern = generateFracture({ mode: 'title', width: 880, height: 360, seed: 7 });

const key = (x: number, y: number) => `${x.toFixed(6)}:${y.toFixed(6)}`;

function splitChordsIn2Shards(p: FracturePattern): void {
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
    expect(count, `crack ${crack.id}`).toBe(2);
  }
}

function assertSimple(p: FracturePattern): void {
  for (const s of p.shards) {
    const pts = unflattenPts(s.polygon);
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const hit = segmentIntersection(pts[i], pts[(i + 1) % n] as Vec2, pts[j], pts[(j + 1) % n] as Vec2);
        if (hit && hit.ta > 1e-6 && hit.ta < 1 - 1e-6 && hit.tb > 1e-6 && hit.tb < 1 - 1e-6) {
          throw new Error(`shard ${s.id} self-intersects (seed ${p.seed})`);
        }
      }
    }
  }
}

describe('corner split-from-corner (T2)', () => {
  it('cracks radiate FROM the canvas corner (one endpoint is a corner)', () => {
    const p = generateFracture({ mode: 'title', width: 880, height: 360, seed: 7 });
    const corners = [
      [0, 0],
      [880, 0],
      [880, 360],
      [0, 360],
    ];
    const splits = p.cracks.filter((c) => c.kind === 'split' && c.id.startsWith('cr'));
    expect(splits.length).toBeGreaterThan(0);
    for (const cr of splits) {
      const x0 = cr.points[0];
      const y0 = cr.points[1];
      const atCorner = corners.some((k) => Math.abs(k[0] - x0) < 1e-3 && Math.abs(k[1] - y0) < 1e-3);
      expect(atCorner, `crack ${cr.id} starts at a corner`).toBe(true);
    }
  });

  it('is watertight, area-conserving and simple across modes and seeds', () => {
    for (const mode of ['title', 'radial', 'web', 'collapse'] as const) {
      for (const seed of [1, 3, 7, 21, 42, 99]) {
        const p = generateFracture({ mode, width: 960, height: 540, seed });
        splitChordsIn2Shards(p);
        assertSimple(p);
        expect(Math.abs(p.shards.reduce((a, s) => a + s.area, 0) - 960 * 540) / (960 * 540)).toBeLessThan(0.01);
      }
    }
  });

  it('corners:false leaves the corner whole (fewer shards, no corner cracks)', () => {
    const on = generateFracture({ mode: 'title', width: 880, height: 360, seed: 7 });
    const off = generateFracture({ mode: 'title', width: 880, height: 360, seed: 7, corners: false });
    expect(on.shards.length).toBeGreaterThan(off.shards.length);
    expect(off.cracks.filter((c) => c.id.startsWith('cr')).length).toBe(0);
  });
});

describe('web diverging fan (W1)', () => {
  it('covers the whole canvas (no corner holes) across dir x distance x rings x rays', () => {
    const W = 960;
    const H = 540;
    const A = W * H;
    // rings:1 + a far origin used to collapse coverage to ~18% (the outer ring boundary was
    // per-ray perturbed below the canvas); the boundary rings are now pinned. Keep rings:1 here.
    for (const dir of [0, 45, 90, 135, 200, 270, 315]) {
      for (const distance of [0.2, 1.2, 6]) {
        for (const rings of [1, 2, 4]) {
          for (const rays of [3, 9]) {
            for (const seed of [1, 42, 808]) {
              const p = generateFracture({
                mode: 'web',
                width: W,
                height: H,
                seed,
                web: { rays, rings, irregularity: 0.6, dir, distance },
              });
              const sum = p.shards.reduce((a, s) => a + s.area, 0);
              expect(Math.abs(sum - A) / A, `dir ${dir} dist ${distance} rings ${rings} rays ${rays} seed ${seed}`).toBeLessThan(0.012);
            }
          }
        }
      }
    }
  });

  it('places the fan origin OFF the canvas even for a tiny requested distance', () => {
    // a small distance must not drop the origin inside the frame (which would leave holes)
    const W = 960;
    const H = 540;
    for (const dir of [0, 45, 90, 200, 315]) {
      const o = webOrigin(W, H, dir, 0.2);
      const inside = o[0] > 0 && o[0] < W && o[1] > 0 && o[1] < H;
      expect(inside, `dir ${dir} origin ${o}`).toBe(false);
    }
  });
});

describe('title diagonal splitters (T1)', () => {
  it('keeps title shards SIMPLE and watertight across diagonal x jaggedness x seeds', () => {
    for (const diagonal of [0, 0.4, 0.7, 1]) {
      for (const jaggedness of [0.3, 0.7, 1]) {
        for (const seed of [1, 7, 21, 42, 99, 288, 808]) {
          const p = generateFracture({
            mode: 'title',
            width: 880,
            height: 360,
            seed,
            jaggedness,
            edgeDetail: 3,
            deviation: 0.9,
            bands: { count: [3, 5], splitters: 3, tilt: 0.8, diagonal },
          });
          assertSimple(p);
          splitChordsIn2Shards(p);
        }
      }
    }
  });

  it('diagonal>0 makes band splitters more diagonal (larger dx/dy) than diagonal:0', () => {
    const slope = (diagonal: number): number => {
      let sum = 0;
      let nn = 0;
      for (const seed of [1, 7, 21, 42, 99]) {
        const p = generateFracture({
          mode: 'title',
          width: 880,
          height: 360,
          seed,
          bands: { count: [3, 5], splitters: 3, tilt: 0.8, diagonal },
        });
        for (const c of p.cracks.filter((cc) => cc.kind === 'split' && !cc.id.startsWith('cr'))) {
          const n = c.points.length;
          const dx = Math.abs(c.points[0] - c.points[n - 2]);
          const dy = Math.abs(c.points[1] - c.points[n - 1]) || 1;
          sum += dx / dy;
          nn++;
        }
      }
      return nn ? sum / nn : 0;
    };
    expect(slope(0.8)).toBeGreaterThan(slope(0) + 0.1);
  });
});

describe('title shatter spread (T3)', () => {
  const tl = { crackStart: 0.05, crackEnd: 0.3, shatterStart: 0.4 } as const;
  const frame = (extra: DeepPartial<EffectParams>) =>
    computeFrame(0.7, titlePattern, { timeline: tl, ...extra } as DeepPartial<EffectParams>);

  it("spread:'fall' + preSpreadPx:0 is byte-identical to the v0.6 default", () => {
    for (const t of [0.2, 0.5, 0.7, 0.9]) {
      const base = computeFrame(t, titlePattern, { timeline: tl });
      const explicit = computeFrame(t, titlePattern, {
        timeline: tl,
        shatter: { spread: 'fall', preSpreadPx: 0 },
      } as DeepPartial<EffectParams>);
      expect(JSON.stringify(explicit)).toBe(JSON.stringify(base));
    }
  });

  it("spread:'apart' sends each half to its own side during shatter", () => {
    const f = frame({ shatter: { spread: 'apart', gravity: [0, 200] as const } });
    let checked = 0;
    for (let i = 0; i < f.shards.length; i++) {
      const cx = titlePattern.shards[i].centroid[0];
      const dx = f.shards[i].raw.rigid.dx;
      if (Math.abs(cx - 440) < 60) continue; // near the centerline, sign is ambiguous
      checked++;
      if (cx < 440) expect(dx).toBeLessThan(5);
      else expect(dx).toBeGreaterThan(-5);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("preSpreadPx drifts the cracked pane sideways before shatter", () => {
    const cracked = { crackStart: 0.05, crackEnd: 0.3, shatterStart: 0.95 } as const;
    const f = computeFrame(0.6, titlePattern, {
      timeline: cracked,
      shatter: { preSpreadPx: 12 },
    } as DeepPartial<EffectParams>);
    // left half drifts left (negative dx), right half right
    const left = f.shards.filter((_, i) => titlePattern.shards[i].centroid[0] < 380);
    const right = f.shards.filter((_, i) => titlePattern.shards[i].centroid[0] > 500);
    expect(left.every((s) => s.raw.rigid.dx < 0)).toBe(true);
    expect(right.every((s) => s.raw.rigid.dx > 0)).toBe(true);
  });
});
