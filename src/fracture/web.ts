import type { CrackPolyline, Shard, Vec2 } from '../types';
import { fbm1D, subdivideMidpoint } from '../core/noise';
import { hashCombine, hashString, rand01 } from '../core/prng';
import { TAU, lerp } from '../core/math';
import { clipPolygonToRect } from '../core/geometry';
import { makeCrack, makeShard, reversePts, shuffledRanks, stitchLoop, type ResolvedFracture } from './build';
import type { StubJunction } from './stubs';

/**
 * 'web' fracture: a thrown-object spider crack. Rays radiate from a center and are joined by
 * polygonal rings. Unlike 'radial' (an impact transition with a punched hub, ray-doubling and
 * smooth arc rings) the web has a plain hub, no doubling, and STRAIGHT-ISH ring edges.
 *
 * Watertightness, per adversarial review: ring edges must NOT be raw straight chords (a secant
 * dips radially inward of its endpoints and, once the bounding rays drift off-radial, crosses
 * the inner chord -> bow-tie cells). Instead each ring edge's CONTROL polyline is the radius-LERP
 * skeleton radial uses (radius-bounded between rA and rB) with the bulge term removed and a low
 * subdivision depth, so it reads as angular/polygonal while keeping cells simple - verified over
 * a wide rays x rings x irregularity x seed sweep. Every edge is generated once and shared by
 * its two adjacent cells. Radius increments stay positive (the jitter amplitude is held < 1).
 */
export function generateWebFracture(o: ResolvedFracture): {
  shards: Shard[];
  cracks: CrackPolyline[];
  maxRing: number;
  junctions: StubJunction[];
  stubScale: number;
} {
  const { width: w, height: h, seed } = o;
  const [ix, iy] = o.impact;
  const N = o.web.rays;
  const M = o.web.rings;
  const slot = TAU / N;
  const irr = o.web.irregularity;
  const ringDetail = Math.min(1, o.edgeDetail); // low depth keeps ring edges angular

  // Outer radius beyond the farthest corner so the outer band always covers the rect.
  const R =
    Math.max(
      Math.hypot(ix, iy),
      Math.hypot(w - ix, iy),
      Math.hypot(ix, h - iy),
      Math.hypot(w - ix, h - iy),
    ) * 1.08;
  const r0 = Math.max(5, 0.045 * Math.min(w, h));

  // Partial rings + directional asymmetry (shared keep map for cells AND ring cracks).
  const asym = o.rings.asymmetry;
  const strongDir = rand01(seed, 'web:strongDir') * TAU;
  const keepArc = (j: number, a: number): boolean => {
    if (j <= 0 || j >= M) return true;
    if (o.rings.partial <= 0) return true;
    const ramp = M >= 3 ? (j - 1) / (M - 2) : 1;
    let keepProb = 1 - o.rings.partial * (0.1 + 0.45 * ramp);
    if (asym > 0) {
      const side = 0.5 + 0.5 * Math.cos(angles[a] - strongDir);
      keepProb = Math.max(0.02, 1 - (1 - keepProb) * (1 + asym * 1.6 * (1 - side)));
    }
    return rand01(seed, 'web:arcKeep', j, a) < keepProb;
  };

  // --- ray angles (uniform slots + jitter) ---
  const angles: number[] = [];
  for (let a = 0; a < N; a++) {
    const r = rand01(seed, 'web:angle', a);
    angles.push(slot * a + (r - 0.5) * 2 * 0.2 * slot * o.rays.angleJitter);
  }

  // --- radius grid (heavier jitter than radial for uneven cells) ---
  const weights: number[] = [];
  {
    let sum = 0;
    for (let j = 1; j <= M; j++) {
      const wj = o.rings.spacing === 'uniform' ? 1 : Math.pow(1.5, j - 1);
      weights.push(wj);
      sum += wj;
    }
    for (let j = 0; j < M; j++) weights[j] /= sum;
  }
  const radii: number[][] = [];
  for (let a = 0; a < N; a++) {
    const row: number[] = [0];
    let cum = 0;
    for (let j = 1; j <= M; j++) {
      // amplitude held < 1 so increments stay positive (radii monotone -> cells simple)
      const jit = (rand01(seed, 'web:ring', a, j) - 0.5) * 2 * (0.25 + 0.5 * irr) * o.rings.jitter;
      cum += weights[j - 1] * (1 + jit);
      row.push(cum);
    }
    const total = row[M];
    for (let j = 0; j <= M; j++) row[j] = r0 + ((R - r0) * row[j]) / total;
    radii.push(row);
  }

  // --- anchors (bounded angular wobble; amplitude << slot so rays never cross) ---
  // irregularity adds angular unevenness on top of the waviness control.
  const wobAmp = (0.06 * o.rays.waviness + 0.05 * irr) * slot;
  const anchorAngle = (a: number, j: number): number =>
    angles[a] + fbm1D(hashCombine(seed, hashString('web:wob'), a), j * 0.8, 2) * wobAmp;
  const anchors: Vec2[][] = [];
  for (let a = 0; a < N; a++) {
    const row: Vec2[] = [];
    for (let j = 0; j <= M; j++) {
      const ang = anchorAngle(a, j);
      row.push([ix + Math.cos(ang) * radii[a][j], iy + Math.sin(ang) * radii[a][j]]);
    }
    anchors.push(row);
  }

  // --- ray edges (anchor j -> j+1, jagged, endpoints exact) ---
  const rayEdges = new Map<string, Vec2[]>();
  for (let a = 0; a < N; a++) {
    for (let j = 0; j < M; j++) {
      const A = anchors[a][j];
      const B = anchors[a][j + 1];
      const mid: Vec2 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      const lateralGap = ((radii[a][j] + radii[a][j + 1]) / 2) * slot;
      const pts = subdivideMidpoint(
        [A, mid, B],
        o.edgeDetail,
        o.jaggedness * 0.5,
        hashCombine(seed, hashString('web:rayjag'), a, j),
        0.25 * lateralGap,
      );
      rayEdges.set(`${a}:${j}`, pts);
    }
  }

  // --- ring edges: radius-LERP polyline (in-band -> simple cells), bulge removed, low depth ---
  const ringEdges = new Map<string, Vec2[]>();
  for (let j = 0; j <= M; j++) {
    for (let a = 0; a < N; a++) {
      const b = (a + 1) % N;
      const A = anchors[a][j];
      const B = anchors[b][j];
      const angA = anchorAngle(a, j);
      let angB = anchorAngle(b, j);
      if (angB <= angA) angB += TAU;
      const rA = radii[a][j];
      const rB = radii[b][j];
      const base: Vec2[] = [A];
      for (let s = 1; s <= 2; s++) {
        const f = s / 3;
        const ang = lerp(angA, angB, f);
        const r = lerp(rA, rB, f); // NO bulge: stays radius-bounded between rA and rB
        base.push([ix + Math.cos(ang) * r, iy + Math.sin(ang) * r]);
      }
      base.push(B);
      const minGap = Math.max(1, j > 0 ? Math.min(rA - radii[a][j - 1], rB - radii[b][j - 1]) : r0);
      const pts = subdivideMidpoint(
        base,
        ringDetail,
        o.jaggedness * 0.3,
        hashCombine(seed, hashString('web:ringjag'), j, a),
        0.18 * minGap,
      );
      ringEdges.set(`${j}:${a}`, pts);
    }
  }

  // --- cells (stepAtRing is always 1: no doubling) ---
  type RawCell = { poly: Vec2[]; ring: number };
  const raw: RawCell[] = [];

  // hub (innermost ring loop) - a plain shard, never punched
  {
    const segs: Vec2[][] = [];
    for (let a = 0; a < N; a++) segs.push(ringEdges.get(`0:${a}`)!);
    const clipped = clipPolygonToRect(stitchLoop(segs), w, h);
    if (clipped.length >= 3) raw.push({ poly: clipped, ring: 0 });
  }

  for (let j = 0; j < M; j++) {
    for (let aL = 0; aL < N; aL++) {
      if (!keepArc(j, aL)) continue;
      let j1 = j;
      while (j1 + 1 < M && !keepArc(j1 + 1, aL)) j1++;
      const aR = (aL + 1) % N;
      const segs: Vec2[][] = [];
      for (let jj = j; jj <= j1; jj++) segs.push(rayEdges.get(`${aL}:${jj}`)!);
      segs.push(ringEdges.get(`${j1 + 1}:${aL}`)!);
      for (let jj = j1; jj >= j; jj--) segs.push(reversePts(rayEdges.get(`${aR}:${jj}`)!));
      segs.push(reversePts(ringEdges.get(`${j}:${aL}`)!));
      const clipped = clipPolygonToRect(stitchLoop(segs), w, h);
      if (clipped.length >= 3) raw.push({ poly: clipped, ring: j + 1 });
    }
  }

  const ranks = shuffledRanks(seed, 'web:z', raw.length);
  const shards: Shard[] = [];
  for (let i = 0; i < raw.length; i++) {
    const s = makeShard(seed, i, raw[i].poly, raw[i].ring, ranks[i], o.seamOutsetPx);
    if (s) shards.push(s);
  }

  // --- cracks: rays (full) + kept ring runs ---
  const cracks: CrackPolyline[] = [];
  const junctions: StubJunction[] = [];
  let cid = 0;
  for (let a = 0; a < N; a++) {
    const pts: Vec2[] = [];
    for (let j = 0; j < M; j++) {
      const e = rayEdges.get(`${a}:${j}`)!;
      for (let k = j === 0 ? 0 : 1; k < e.length; k++) pts.push(e[k]);
    }
    const birth = 0.0 + rand01(seed, 'web:raybirth', a) * 0.06;
    cracks.push(makeCrack(seed, `wr${cid++}`, 'ray', pts, birth, 0.42 + rand01(seed, 'web:raygrow', a) * 0.12, true));
  }
  // ring cracks: maximal kept runs per ring, CIRCULAR (a run may wrap past angle 0).
  for (let j = 1; j < M; j++) {
    let allKept = true;
    for (let a = 0; a < N; a++) {
      if (!keepArc(j, a)) {
        allKept = false;
        break;
      }
    }
    const emit = (pts: Vec2[], runStart: number) => {
      if (pts.length < 2) return;
      const birth = 0.08 + (j / M) * 0.2 + rand01(seed, 'web:ringbirth', j, runStart) * 0.05;
      cracks.push(makeCrack(seed, `wg${cid++}`, 'ring', pts, Math.min(birth, 0.9), 0.28, false));
    };
    if (allKept) {
      // one closed loop
      const pts: Vec2[] = [];
      for (let a = 0; a < N; a++) {
        const e = ringEdges.get(`${j}:${a}`)!;
        for (let k = a === 0 ? 0 : 1; k < e.length; k++) pts.push(e[k]);
      }
      pts.push(ringEdges.get(`${j}:0`)![0]); // close
      emit(pts, 0);
      continue;
    }
    // a run STARTS at a kept arc whose predecessor is dropped
    for (let a0 = 0; a0 < N; a0++) {
      if (!keepArc(j, a0) || keepArc(j, (a0 - 1 + N) % N)) continue;
      const pts: Vec2[] = [];
      let a = a0;
      let first = true;
      while (keepArc(j, a)) {
        const e = ringEdges.get(`${j}:${a}`)!;
        for (let k = first ? 0 : 1; k < e.length; k++) pts.push(e[k]);
        first = false;
        a = (a + 1) % N;
        if (a === a0) break; // safety (cannot happen since not all kept)
      }
      emit(pts, a0);
    }
  }

  const stubScale = Math.sqrt((w * h) / Math.max(1, shards.length));
  return { shards, cracks, maxRing: M, junctions, stubScale };
}
