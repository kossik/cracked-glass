import type { CrackPolyline, Shard, Vec2 } from '../types';
import { fbm1D, subdivideMidpoint } from '../core/noise';
import { hashCombine, hashString, rand01 } from '../core/prng';
import { TAU, degToRad, lerp } from '../core/math';
import { clipPolygonToRect } from '../core/geometry';
import { makeCrack, makeShard, reversePts, shuffledRanks, stitchLoop, type ResolvedFracture } from './build';
import type { StubJunction } from './stubs';

/** Shortest signed angular difference a-b in (-pi, pi]. */
function wrapAngle(d: number): number {
  return ((d + Math.PI) % TAU + TAU) % TAU - Math.PI;
}

/**
 * Fan origin P, GUARANTEED off-canvas. P sits behind the central direction, at the requested
 * web.distance - but never closer than the canvas boundary along -dir plus a margin, so a small
 * distance can never drop P inside the frame (which would collapse the cone and leave corner
 * holes). The distance knob therefore only ever pushes the origin further out.
 */
export function webOrigin(w: number, h: number, dirDeg: number, distance: number): Vec2 {
  const dirRad = degToRad(dirDeg);
  const maxDim = Math.max(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const ux = -Math.cos(dirRad); // P = center + u * dist  (u points away from the fan)
  const uy = -Math.sin(dirRad);
  // ray-box exit distance from the centre along u (px to the canvas boundary)
  let tBound = Infinity;
  if (ux > 1e-9) tBound = Math.min(tBound, (w - cx) / ux);
  else if (ux < -1e-9) tBound = Math.min(tBound, -cx / ux);
  if (uy > 1e-9) tBound = Math.min(tBound, (h - cy) / uy);
  else if (uy < -1e-9) tBound = Math.min(tBound, -cy / uy);
  if (!Number.isFinite(tBound)) tBound = maxDim;
  const dist = Math.max(distance * maxDim, tBound + 0.2 * maxDim);
  return [cx + ux * dist, cy + uy * dist];
}

/**
 * 'web' fracture: a thrown-object spider crack as a DIVERGING FAN. Rays radiate from a point
 * placed OFF the canvas (behind the frame) and fan ACROSS it - not parallel, diverging.
 *
 * Watertight + full coverage, per adversarial review:
 * - the origin P is off-canvas (web.dir + web.distance); it bypasses the in-rect impact clamp.
 * - the angular spread is DERIVED so the cone covers all four canvas corners from P (free
 *   spread knobs leave corner wedges uncovered -> holes); plus one extra slot each side so the
 *   boundary rays start strictly outside the canvas and the unowned strip beyond them clips away.
 * - the outer radius R reaches the far corner with margin for the radius-LERP edge dip.
 * - OPEN arc: ring edges and cells run a in 0..N-2 (no wraparound), so there is no spurious
 *   back-gap cell and no angB+=TAU spiral.
 * - ring edges are radius-LERP polylines (radius-bounded) so cells stay simple.
 */
export function generateWebFracture(o: ResolvedFracture): {
  shards: Shard[];
  cracks: CrackPolyline[];
  maxRing: number;
  junctions: StubJunction[];
  stubScale: number;
} {
  const { width: w, height: h, seed } = o;
  const N = o.web.rays;
  const M = o.web.rings;
  const irr = o.web.irregularity;
  const ringDetail = Math.min(1, o.edgeDetail);

  // --- off-canvas origin P (behind the central direction; clamped off-canvas) ---
  const dirRad = degToRad(o.web.dir);
  const maxDim = Math.max(w, h);
  const P = webOrigin(w, h, o.web.dir, o.web.distance);
  const [px, py] = P;

  // --- coverage: cone covering all 4 corners from P, R reaching the far corner ---
  const corners: Vec2[] = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  let maxDev = 0;
  let maxCornerDist = 0;
  for (const c of corners) {
    const dev = Math.abs(wrapAngle(Math.atan2(c[1] - py, c[0] - px) - dirRad));
    if (dev > maxDev) maxDev = dev;
    const d = Math.hypot(c[0] - px, c[1] - py);
    if (d > maxCornerDist) maxCornerDist = d;
  }
  const slot0 = (2 * maxDev) / Math.max(1, N - 1);
  const spread = Math.min(TAU * 0.95, 2 * maxDev + 2 * slot0); // +1 slot each side
  const slot = spread / Math.max(1, N - 1);
  // The rings must subdivide the ON-CANVAS radial band, NOT the [0.04*maxDim, far-corner] span
  // measured from a possibly-distant P (that span is mostly off-canvas, so a coarse ring count
  // would leave the visible strip untiled). dNear is the true nearest rect point (an EDGE, not
  // necessarily a corner) so the inner ring sits at/above the near canvas edge.
  const nearX = Math.max(0, Math.min(w, px));
  const nearY = Math.max(0, Math.min(h, py));
  const dNear = Math.hypot(px - nearX, py - nearY);
  const margin = 0.05 * maxDim;
  const r0 = Math.max(5, dNear - margin);
  // outer radius reaches the far corner with room for the radius-LERP angular dip (cos(slot/2)).
  const R = (maxCornerDist / Math.max(0.2, Math.cos(slot / 2))) * 1.06 + margin;

  // --- partial rings + directional asymmetry (shared by cells and ring cracks) ---
  const asym = o.rings.asymmetry;
  const strongDir = dirRad + (rand01(seed, 'web:strongDir') - 0.5) * spread;
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

  // --- ray bearings across the cone (jitter bounded by the slot so rays never cross) ---
  const angles: number[] = [];
  for (let a = 0; a < N; a++) {
    const base = dirRad - spread / 2 + (N > 1 ? (a / (N - 1)) * spread : 0);
    const jit = (rand01(seed, 'web:angle', a) - 0.5) * 2 * 0.15 * slot * o.rays.angleJitter;
    angles.push(base + jit);
  }

  // --- radius grid: a SHARED ring baseline (per-ring jitter) + a per-ray perturbation
  //     bounded to < 0.4 of the adjacent ring gaps, so adjacent rays' radius bands never
  //     overlap -> the cell quads never twist into a bow-tie (the fan failure mode). ---
  const weights: number[] = [];
  {
    let sum = 0;
    for (let j = 1; j <= M; j++) {
      const wj = o.rings.spacing === 'uniform' ? 1 : Math.pow(1.35, j - 1);
      weights.push(wj);
      sum += wj;
    }
    for (let j = 0; j < M; j++) weights[j] /= sum;
  }
  const ringR: number[] = [0];
  {
    let cum = 0;
    for (let j = 1; j <= M; j++) {
      const jit = (rand01(seed, 'web:ringbase', j) - 0.5) * 2 * 0.3 * o.rings.jitter;
      cum += weights[j - 1] * (1 + jit);
      ringR.push(cum);
    }
    for (let j = 0; j <= M; j++) ringR[j] = r0 + ((R - r0) * ringR[j]) / cum;
  }
  const radii: number[][] = [];
  for (let a = 0; a < N; a++) {
    const row: number[] = [r0];
    for (let j = 1; j <= M; j++) {
      // pin the OUTER boundary (j===M) like the inner one (j===0): perturbing it would let a ray
      // end short of the far canvas edge -> an uncovered wedge (the rings=1 coverage hole).
      if (j === M) {
        row.push(ringR[M]);
        continue;
      }
      const gUp = ringR[j + 1] - ringR[j];
      const gDn = ringR[j] - ringR[j - 1];
      const bound = 0.4 * Math.max(1, Math.min(gUp, gDn));
      const pert = (rand01(seed, 'web:ringpert', a, j) - 0.5) * 2 * (0.3 + 0.7 * irr) * bound;
      row.push(ringR[j] + pert);
    }
    radii.push(row);
  }

  // --- anchors (bounded angular wobble << slot) ---
  const wobAmp = (0.05 * o.rays.waviness + 0.04 * irr) * slot;
  const anchorAngle = (a: number, j: number): number =>
    angles[a] + fbm1D(hashCombine(seed, hashString('web:wob'), a), j * 0.8, 2) * wobAmp;
  const anchors: Vec2[][] = [];
  for (let a = 0; a < N; a++) {
    const row: Vec2[] = [];
    for (let j = 0; j <= M; j++) {
      const ang = anchorAngle(a, j);
      row.push([px + Math.cos(ang) * radii[a][j], py + Math.sin(ang) * radii[a][j]]);
    }
    anchors.push(row);
  }

  // --- ray edges (jagged) ---
  const rayEdges = new Map<string, Vec2[]>();
  for (let a = 0; a < N; a++) {
    for (let j = 0; j < M; j++) {
      const A = anchors[a][j];
      const B = anchors[a][j + 1];
      const mid: Vec2 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      // radius is measured from the (far, off-canvas) origin, so radius*slot overstates the
      // on-canvas cell width; cap the jag to a canvas-relative bound so it cannot self-fold.
      const lateralGap = Math.min(((radii[a][j] + radii[a][j + 1]) / 2) * slot, 0.12 * maxDim);
      rayEdges.set(
        `${a}:${j}`,
        subdivideMidpoint([A, mid, B], o.edgeDetail, o.jaggedness * 0.5, hashCombine(seed, hashString('web:rayjag'), a, j), 0.18 * lateralGap),
      );
    }
  }

  // --- ring edges: OPEN arc (a in 0..N-2, no wraparound), radius-LERP (simple cells) ---
  const ringEdges = new Map<string, Vec2[]>();
  for (let j = 0; j <= M; j++) {
    for (let a = 0; a + 1 < N; a++) {
      const b = a + 1;
      const A = anchors[a][j];
      const B = anchors[b][j];
      const angA = anchorAngle(a, j);
      const angB = anchorAngle(b, j); // monotone within the open cone, no +TAU
      const rA = radii[a][j];
      const rB = radii[b][j];
      const base: Vec2[] = [A];
      for (let s = 1; s <= 2; s++) {
        const f = s / 3;
        const ang = lerp(angA, angB, f);
        const r = lerp(rA, rB, f);
        base.push([px + Math.cos(ang) * r, py + Math.sin(ang) * r]);
      }
      base.push(B);
      // clamp the jag by the SMALLER of the down- and up-gaps so a tooth can never poke
      // across the neighbouring ring (poking up was the fan self-intersection cause)
      const gapDown = j > 0 ? Math.min(rA - radii[a][j - 1], rB - radii[b][j - 1]) : r0;
      const gapUp = j < M ? Math.min(radii[a][j + 1] - rA, radii[b][j + 1] - rB) : gapDown;
      const minGap = Math.max(1, Math.min(gapDown, gapUp, 0.1 * maxDim));
      ringEdges.set(
        `${j}:${a}`,
        subdivideMidpoint(base, ringDetail, o.jaggedness * 0.22, hashCombine(seed, hashString('web:ringjag'), j, a), 0.18 * minGap),
      );
    }
  }

  // --- cells (open fan: columns a in 0..N-2; stepAtRing always 1) ---
  type RawCell = { poly: Vec2[]; ring: number };
  const raw: RawCell[] = [];
  for (let j = 0; j < M; j++) {
    for (let aL = 0; aL + 1 < N; aL++) {
      if (!keepArc(j, aL)) continue;
      let j1 = j;
      while (j1 + 1 < M && !keepArc(j1 + 1, aL)) j1++;
      const aR = aL + 1;
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

  // --- cracks: rays (full) + kept ring runs (open, no wrap) ---
  const cracks: CrackPolyline[] = [];
  const junctions: StubJunction[] = [];
  let cid = 0;
  for (let a = 0; a < N; a++) {
    const pts: Vec2[] = [];
    for (let j = 0; j < M; j++) {
      const e = rayEdges.get(`${a}:${j}`)!;
      for (let k = j === 0 ? 0 : 1; k < e.length; k++) pts.push(e[k]);
    }
    const birth = rand01(seed, 'web:raybirth', a) * 0.06;
    cracks.push(makeCrack(seed, `wr${cid++}`, 'ray', pts, birth, 0.42 + rand01(seed, 'web:raygrow', a) * 0.12, true));
  }
  for (let j = 1; j < M; j++) {
    let a = 0;
    while (a + 1 < N) {
      if (!keepArc(j, a)) {
        a++;
        continue;
      }
      const runStart = a;
      const pts: Vec2[] = [];
      while (a + 1 < N && keepArc(j, a)) {
        const e = ringEdges.get(`${j}:${a}`)!;
        for (let k = a === runStart ? 0 : 1; k < e.length; k++) pts.push(e[k]);
        a++;
      }
      if (pts.length >= 2) {
        const birth = 0.08 + (j / M) * 0.2 + rand01(seed, 'web:ringbirth', j, runStart) * 0.05;
        cracks.push(makeCrack(seed, `wg${cid++}`, 'ring', pts, Math.min(birth, 0.9), 0.28, false));
      }
    }
  }

  const stubScale = Math.sqrt((w * h) / Math.max(1, shards.length));
  return { shards, cracks, maxRing: M, junctions, stubScale };
}
