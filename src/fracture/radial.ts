import type { CrackPolyline, Shard, Vec2 } from '../types';
import { fbm1D, subdivideMidpoint } from '../core/noise';
import { hashCombine, hashString, rand01, rngFor } from '../core/prng';
import { TAU, lerp } from '../core/math';
import { clipPolygonToRect } from '../core/geometry';
import { makeCrack, makeShard, reversePts, shuffledRanks, stitchLoop, type ResolvedFracture } from './build';
import type { StubJunction } from './stubs';

/**
 * 'radial' fracture: a polar crack grid around an impact point.
 *
 * - Radius grid r[a][j] is built from cumulative positive jittered increments normalized
 *   to end exactly at R (beyond the farthest corner) -> rings are monotone, never invert,
 *   and the outermost band always covers the rect (then gets clipped to it).
 * - "Ray doubling": secondary rays deterministically start at ring `dS`, so outer bands are
 *   split twice as fine without any planar-graph topology extraction.
 * - A small "crush zone" disc at the impact replaces degenerate wedge tips.
 * - Every edge polyline is generated once; cells reference shared points -> watertight.
 */
export function generateRadialFracture(o: ResolvedFracture): {
  shards: Shard[];
  cracks: CrackPolyline[];
  maxRing: number;
  junctions: StubJunction[];
  stubScale: number;
} {
  const { width: w, height: h, seed } = o;
  const [ix, iy] = o.impact;
  const N = o.rays.count;
  const M = o.rings.count;
  let doubling = o.rays.doubling && N >= 3;
  let dS = Math.min(Math.max(1, o.rays.doublingStartRing), M);
  if (dS >= M + 1) doubling = false;
  if (M < 2) doubling = false; // nothing to double into
  const count = doubling ? 2 * N : N;

  // Outer radius: beyond the farthest corner so the outer band always covers the rect.
  const R =
    Math.max(
      Math.hypot(ix, iy),
      Math.hypot(w - ix, iy),
      Math.hypot(ix, h - iy),
      Math.hypot(w - ix, h - iy),
    ) * 1.08;
  // Punched-out impact hole: the crush disc gets knocked clean through during cracking
  // (render-side fx.crush.punch). min(w,h)-based so the hole size does not depend on how
  // off-center the impact sits.
  const r0 = Math.max(6, 0.05 * Math.min(w, h)) * o.impactHole;
  const slot = TAU / N;

  const stepAtRing = (j: number): number => (!doubling ? 1 : j >= dS ? 1 : 2);
  const rayStartRing = (a: number): number => (!doubling || a % 2 === 0 ? 0 : dS);

  /**
   * Partial rings: real concentric cracks are arcs, never closed circles. A dropped arc
   * merges the two radially-adjacent cells. ONE source of truth consulted by both the
   * cell assembly and the crack rendering (they can never disagree). Never droppable:
   * ring 0 (crush boundary), ring dS when doubling (column-granularity change - merge
   * runs must not cross it), the virtual outer ring. Coverage falls with distance from
   * the impact (photo reference: dense near the hole, sparse outside).
   */
  const keepArc = (j: number, a: number): boolean => {
    if (j <= 0 || j >= M) return true;
    if (doubling && j === dS) return true;
    if (o.rings.partial <= 0) return true;
    const ramp = M >= 3 ? (j - 1) / (M - 2) : 1;
    const keepProb = 1 - o.rings.partial * (0.1 + 0.45 * ramp);
    return rand01(seed, 'radial:arcKeep', j, a) < keepProb;
  };

  // --- angles ---
  const baseAngles: number[] = [];
  for (let i = 0; i < N; i++) {
    const r = rand01(seed, 'radial:baseAngle', i);
    baseAngles.push(slot * i + (r - 0.5) * 2 * 0.18 * slot * o.rays.angleJitter);
  }
  const angles: number[] = [];
  if (doubling) {
    for (let i = 0; i < N; i++) {
      angles.push(baseAngles[i]);
      const next = i + 1 < N ? baseAngles[i + 1] : baseAngles[0] + TAU;
      const r = rand01(seed, 'radial:secAngle', i);
      angles.push((baseAngles[i] + next) / 2 + (r - 0.5) * 2 * 0.1 * slot);
    }
  } else {
    angles.push(...baseAngles);
  }

  // --- radius grid (normalized cumulative jittered increments) ---
  const weights: number[] = [];
  {
    let sum = 0;
    for (let j = 1; j <= M; j++) {
      const wj = o.rings.spacing === 'geometric' ? Math.pow(1.55, j - 1) : 1;
      weights.push(wj);
      sum += wj;
    }
    for (let j = 0; j < M; j++) weights[j] /= sum;
  }
  const radii: number[][] = []; // radii[a][j], j in 0..M
  for (let a = 0; a < count; a++) {
    const row: number[] = [0];
    let cum = 0;
    for (let j = 1; j <= M; j++) {
      const jit = (rand01(seed, 'radial:ring', a, j) - 0.5) * 2 * 0.35 * o.rings.jitter;
      cum += weights[j - 1] * (1 + jit);
      row.push(cum);
    }
    const total = row[M];
    for (let j = 0; j <= M; j++) row[j] = r0 + ((R - r0) * row[j]) / total;
    radii.push(row);
  }

  // --- anchors (with angular wobble; amplitude scales with the local slot so rays never cross) ---
  const wobAmp = (j: number): number => 0.1 * o.rays.waviness * slot * (stepAtRing(j) === 2 || !doubling ? 1 : 0.5);

  // Veering kinks (deviation): a minority of rays bends sideways from a given ring outward.
  // The kink SHARES an angular budget with the wobble - two neighbors closing on each other
  // consume at most 0.64 of their gap, so ordering (and thus watertightness) is preserved.
  const hasDeviation = o.deviation > 0;
  const budget: number[] = [];
  const kinkMag: number[] = [];
  const kinkRing: number[] = [];
  for (let a = 0; a < count; a++) {
    const prev = angles[(a - 1 + count) % count] - (a === 0 ? TAU : 0);
    const next = angles[(a + 1) % count] + (a === count - 1 ? TAU : 0);
    budget.push(0.32 * Math.min(angles[a] - prev, next - angles[a]));
    if (hasDeviation && rand01(seed, 'radial:kink', a) < o.deviation * 0.55 && M > 1) {
      const jk = 1 + Math.floor(rand01(seed, 'radial:kinkJ', a) * (M - 1));
      const sign = rand01(seed, 'radial:kinkS', a) < 0.5 ? -1 : 1;
      kinkMag.push(sign * (0.5 + 0.5 * rand01(seed, 'radial:kinkM', a)) * budget[a]);
      kinkRing.push(jk);
    } else {
      kinkMag.push(0);
      kinkRing.push(0);
    }
  }

  const anchorAngle = (a: number, j: number): number => {
    const wobble = fbm1D(hashCombine(seed, hashString('radial:wob'), a), j * 0.8, 2) * wobAmp(j);
    if (!hasDeviation) return angles[a] + wobble;
    const kink = kinkMag[a] * Math.min(1, Math.max(0, j - kinkRing[a]) / 1.5);
    const phi = Math.max(-budget[a], Math.min(budget[a], wobble + kink));
    return angles[a] + phi;
  };
  const anchors: Vec2[][] = []; // anchors[a][j]
  for (let a = 0; a < count; a++) {
    const row: Vec2[] = [];
    for (let j = 0; j <= M; j++) {
      const ang = anchorAngle(a, j);
      row.push([ix + Math.cos(ang) * radii[a][j], iy + Math.sin(ang) * radii[a][j]]);
    }
    anchors.push(row);
  }

  // --- ray edges (anchor j -> anchor j+1, jagged, endpoints exact) ---
  const rayEdges = new Map<string, Vec2[]>();
  for (let a = 0; a < count; a++) {
    for (let j = rayStartRing(a); j < M; j++) {
      const A = anchors[a][j];
      const B = anchors[a][j + 1];
      const rMid = (radii[a][j] + radii[a][j + 1]) / 2;
      const angMid =
        angles[a] +
        fbm1D(hashCombine(seed, hashString('radial:wob'), a), (j + 0.5) * 0.8, 2) *
          Math.min(wobAmp(j), wobAmp(j + 1));
      const mid: Vec2 = [ix + Math.cos(angMid) * rMid, iy + Math.sin(angMid) * rMid];
      // Local angular sector width of the band this edge borders.
      const lateralGap = rMid * slot * (doubling && stepAtRing(j) === 1 ? 0.5 : 1);
      const pts = subdivideMidpoint(
        [A, mid, B],
        o.edgeDetail,
        o.jaggedness * 0.5,
        hashCombine(seed, hashString('radial:rayjag'), a, j),
        0.25 * lateralGap,
      );
      // endpoints stay exact by construction (subdivide never moves endpoints)
      rayEdges.set(`${a}:${j}`, pts);
    }
  }

  // --- arc edges per ring (between consecutive existing anchors, endpoints exact) ---
  const arcEdges = new Map<string, Vec2[]>();
  for (let j = 0; j <= M; j++) {
    const step = stepAtRing(j);
    for (let a = 0; a < count; a += step) {
      const b = (a + step) % count;
      const A = anchors[a][j];
      const B = anchors[b][j];
      const angA = anchorAngle(a, j);
      let angB = anchorAngle(b, j);
      if (angB <= angA) angB += TAU;
      const rA = radii[a][j];
      const rB = radii[b][j];
      const gapDown = j > 0 ? Math.min(rA - radii[a][j - 1], rB - radii[b][j - 1]) : r0;
      const gapUp = j < M ? Math.min(radii[a][j + 1] - rA, radii[b][j + 1] - rB) : gapDown;
      const minGap = Math.max(1, Math.min(gapDown, gapUp));
      const bulgeSeed = hashCombine(seed, hashString('radial:bulge'), j, a);
      const base: Vec2[] = [A];
      const innerSamples = 2;
      for (let s = 1; s <= innerSamples; s++) {
        const f = s / (innerSamples + 1);
        const ang = lerp(angA, angB, f);
        const r = lerp(rA, rB, f) + fbm1D(bulgeSeed, f * 2.3, 2) * 0.14 * minGap * (0.4 + 0.6 * o.rings.jitter);
        base.push([ix + Math.cos(ang) * r, iy + Math.sin(ang) * r]);
      }
      base.push(B);
      const pts = subdivideMidpoint(
        base,
        o.edgeDetail,
        o.jaggedness * 0.4,
        hashCombine(seed, hashString('radial:arcjag'), j, a),
        0.22 * minGap,
      );
      arcEdges.set(`${j}:${a}`, pts);
    }
  }

  // --- cells ---
  type RawCell = { poly: Vec2[]; ring: number };
  const raw: RawCell[] = [];

  // crush disc (clipped like every other cell - near-edge impacts poke it outside the pane)
  {
    const segs: Vec2[][] = [];
    const step = stepAtRing(0);
    for (let a = 0; a < count; a += step) segs.push(arcEdges.get(`0:${a}`)!);
    const clipped = clipPolygonToRect(stitchLoop(segs), w, h);
    if (clipped.length >= 3) raw.push({ poly: clipped, ring: 0 });
  }

  for (let j = 0; j < M; j++) {
    const bandStep = stepAtRing(j); // rays spanning band j have the same step as ring j anchors
    for (let aL = 0; aL < count; aL += bandStep) {
      // emit only at the BOTTOM of a merge run (keepArc(0,*)===true) - at partial 0 every
      // band is a singleton run and the traversal is byte-identical to v0.3
      if (!keepArc(j, aL)) continue;
      let j1 = j;
      while (j1 + 1 < M && !keepArc(j1 + 1, aL)) j1++;
      const aR = (aL + bandStep) % count;
      const segs: Vec2[][] = [];
      for (let jj = j; jj <= j1; jj++) segs.push(rayEdges.get(`${aL}:${jj}`)!);
      // outer arcs from aL to aR (bandStep is always divisible by stepAtRing(j1+1))
      const outerStep = stepAtRing(j1 + 1);
      const nOuter = bandStep / outerStep;
      for (let s = 0; s < nOuter; s++) {
        segs.push(arcEdges.get(`${j1 + 1}:${(aL + s * outerStep) % count}`)!);
      }
      for (let jj = j1; jj >= j; jj--) segs.push(reversePts(rayEdges.get(`${aR}:${jj}`)!));
      segs.push(reversePts(arcEdges.get(`${j}:${aL}`)!));
      const poly = stitchLoop(segs);
      const clipped = clipPolygonToRect(poly, w, h);
      if (clipped.length >= 3) raw.push({ poly: clipped, ring: j + 1 });
    }
  }

  const ranks = shuffledRanks(seed, 'radial:z', raw.length);
  const shards: Shard[] = [];
  for (let i = 0; i < raw.length; i++) {
    const s = makeShard(seed, i, raw[i].poly, raw[i].ring, ranks[i], o.seamOutsetPx);
    if (s) shards.push(s);
  }

  // --- crack polylines for rendering ---
  const cracks: CrackPolyline[] = [];
  let ci = 0;
  // crush ring
  {
    const segs: Vec2[][] = [];
    const step = stepAtRing(0);
    for (let a = 0; a < count; a += step) segs.push(arcEdges.get(`0:${a}`)!);
    const loop = concatPolylines(segs);
    cracks.push(makeCrack(seed, `c${ci++}`, 'crush', loop, 0, 0.12));
  }
  // rays (center -> out)
  for (let a = 0; a < count; a++) {
    const start = rayStartRing(a);
    if (start >= M) continue;
    const segs: Vec2[][] = [];
    for (let j = start; j < M; j++) segs.push(rayEdges.get(`${a}:${j}`)!);
    const pts = concatPolylines(segs);
    const rngC = rngFor(seed, 'radial:raybirth', a);
    const secondary = doubling && a % 2 === 1;
    const birth = secondary ? 0.32 + rngC() * 0.08 : 0.02 + rngC() * 0.08;
    const grow = secondary ? 0.3 : 0.48 + rngC() * 0.14;
    cracks.push(makeCrack(seed, `c${ci++}`, 'ray', pts, birth, grow));
  }
  // rings 1..M-1 (ring M is virtual, far outside the rect): since v0.4 these are ARC RUNS -
  // maximal stretches of kept arcs. A fully-kept ring takes the verbatim v0.3 loop path.
  const junctions: StubJunction[] = [];
  for (let j = 1; j < M; j++) {
    const step = stepAtRing(j);
    const arcStarts: number[] = [];
    for (let a = 0; a < count; a += step) arcStarts.push(a);
    const kept = arcStarts.map((a) => keepArc(j, a));
    const rngC = rngFor(seed, 'radial:ringbirth', j); // v0.3 stream, drawn exactly once per ring
    const base = 0.34 + ((j - 1) / Math.max(1, M - 2)) * 0.38 + rngC() * 0.05;
    if (kept.every(Boolean)) {
      const segs: Vec2[][] = arcStarts.map((a) => arcEdges.get(`${j}:${a}`)!);
      const pts = concatPolylines(segs);
      cracks.push(makeCrack(seed, `c${ci++}`, 'ring', pts, Math.min(base, 0.97 - 0.26), 0.26));
      continue;
    }
    if (!kept.some(Boolean)) continue; // everything dropped: this ring has no visible crack
    const n = arcStarts.length;
    for (let i = 0; i < n; i++) {
      if (!kept[i] || kept[(i - 1 + n) % n]) continue; // run starts at kept-after-dropped
      const segs: Vec2[][] = [];
      for (let k = 0; k < n && kept[(i + k) % n]; k++) {
        segs.push(arcEdges.get(`${j}:${arcStarts[(i + k) % n]}`)!);
      }
      const pts = concatPolylines(segs);
      const birth = Math.min(base + 0.04 * rand01(seed, 'radial:ringrun', j, arcStarts[i]), 0.97 - 0.26);
      cracks.push(makeCrack(seed, `c${ci++}`, 'ring', pts, birth, 0.26));
      // a partial arc dies into a ray on both ends - the natural place for hairlines
      const ciRun = cracks.length - 1;
      junctions.push({ crackIndex: ciRun, s: 0 }, { crackIndex: ciRun, s: cracks[ciRun].totalLen });
    }
  }

  return {
    shards,
    cracks,
    maxRing: M,
    junctions,
    stubScale: Math.sqrt((w * h) / Math.max(1, shards.length)),
  };
}

function concatPolylines(segs: Vec2[][]): Vec2[] {
  const out: Vec2[] = [];
  for (const seg of segs) {
    const start = out.length === 0 ? 0 : 1;
    for (let i = start; i < seg.length; i++) out.push(seg[i]);
  }
  return out;
}
