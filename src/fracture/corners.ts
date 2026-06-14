import type { CrackPolyline, Shard, Vec2 } from '../types';
import { pointInPolygon, segmentIntersection, unflattenPts } from '../core/geometry';
import { rand01 } from '../core/prng';
import { makeCrack, makeShard, type ResolvedFracture } from './build';

/**
 * A chord from corner vertex `ci` to vertex `vi` is an INTERNAL diagonal of the polygon iff
 * its midpoint is inside and it crosses no non-incident edge. Both endpoints are existing
 * polygon vertices, so the split introduces NO new vertex on any edge - neighbors that share
 * the owner's edges are untouched (no T-vertex tear).
 */
function chordIsInterior(pts: Vec2[], ci: number, vi: number): boolean {
  const n = pts.length;
  const A = pts[ci];
  const B = pts[vi];
  const mid: Vec2 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  if (!pointInPolygon(mid, pts)) return false;
  for (let j = 0; j < n; j++) {
    const k = (j + 1) % n;
    if (j === ci || k === ci || j === vi || k === vi) continue; // incident edges
    const hit = segmentIntersection(pts[j], pts[k], A, B);
    if (hit && hit.ta > 1e-6 && hit.ta < 1 - 1e-6 && hit.tb > 1e-6 && hit.tb < 1 - 1e-6) return false;
  }
  return true;
}

/**
 * Corner relief: cracks RADIATE from each canvas corner vertex into the shard, splitting the
 * corner piece into wedges (a real pane breaks AT the corner, it does not slice a clean
 * triangle off it). Watertight AND index-stable, per adversarial review:
 * - the owner is the SINGLE shard with the corner as an exact vertex (skip if 0 or 2 own it);
 * - both corner-adjacent edges must be on the pane border (a true exposed right angle);
 * - 1-2 chords run from the corner C to EXISTING non-adjacent vertices of the owner - never a
 *   new mid-edge point, so no neighbour sharing a far edge gets a hanging T-vertex;
 * - each chord is validated as an internal diagonal (interior midpoint, crosses no edge);
 * - the owner is REPLACED IN PLACE (keeps id/hash/z), extra wedges are APPENDED, so no other
 *   shard is renumbered; all-or-nothing (any degenerate wedge -> the corner is left intact).
 *
 * Mutates `shards`/`cracks` in place. No-op when corners is false/relief 0 (byte anchor) or
 * hero mode. Call BEFORE addStubCracks / micro seeding.
 */
export function applyCornerRelief(o: ResolvedFracture, shards: Shard[], cracks: CrackPolyline[]): void {
  if (o.corners === false || o.corners.relief <= 0 || o.mode === 'hero') return;
  const { width: w, height: h, seed } = o;
  const relief = o.corners.relief;
  const eps = 1e-3;
  const onBorder = (a: Vec2, b: Vec2): boolean =>
    (a[0] < eps && b[0] < eps) ||
    (a[0] > w - eps && b[0] > w - eps) ||
    (a[1] < eps && b[1] < eps) ||
    (a[1] > h - eps && b[1] > h - eps);

  const baseN = shards.length;
  let maxZ = 0;
  for (const s of shards) if (s.z > maxZ) maxZ = s.z;
  let appended = 0;
  let crackId = 0;

  const corners: Vec2[] = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];

  for (let c = 0; c < corners.length; c++) {
    const C = corners[c];
    let ownerIdx = -1;
    let owners = 0;
    for (let si = 0; si < baseN; si++) {
      const poly = shards[si].polygon;
      for (let p = 0; p + 1 < poly.length; p += 2) {
        if (Math.abs(poly[p] - C[0]) < eps && Math.abs(poly[p + 1] - C[1]) < eps) {
          owners++;
          ownerIdx = si;
          break;
        }
      }
      if (owners > 1) break;
    }
    if (owners !== 1) continue;
    const owner = shards[ownerIdx];
    // radial crush plug / web hub stay whole
    if ((o.mode === 'radial' || o.mode === 'web') && owner.ringIndex === 0) continue;

    const raw = unflattenPts(owner.polygon);
    const n = raw.length;
    if (n < 5) continue; // too few vertices to split into wedges
    let ci0 = -1;
    for (let i = 0; i < n; i++) {
      if (Math.abs(raw[i][0] - C[0]) < eps && Math.abs(raw[i][1] - C[1]) < eps) {
        ci0 = i;
        break;
      }
    }
    if (ci0 < 0) continue;
    // both corner-adjacent edges on the border (a true exposed right angle)
    if (!onBorder(raw[(ci0 - 1 + n) % n], C) || !onBorder(C, raw[(ci0 + 1) % n])) continue;

    // rotate so the corner is index 0 -> targets are plain forward offsets
    const pts: Vec2[] = [...raw.slice(ci0), ...raw.slice(0, ci0)];

    // wedge reach from the corner (like the old ear size, but landing on real vertices)
    const jit = 0.8 + 0.4 * rand01(seed, 'corner', c);
    const reach = relief * Math.min(0.55 * Math.sqrt(owner.area), 95) * jit;
    const distC = (i: number) => Math.hypot(pts[i][0] - C[0], pts[i][1] - C[1]);

    // pick the interior vertex nearest the reach distance, scanning forward (2..mid) and
    // backward (n-2..mid); both must be valid internal diagonals.
    const mid = Math.floor(n / 2);
    const pick = (lo: number, hi: number, step: number): number => {
      let best = -1;
      let bestErr = Infinity;
      for (let i = lo; step > 0 ? i <= hi : i >= hi; i += step) {
        if (i <= 1 || i >= n - 1) continue;
        if (distC(i) < 8) continue;
        if (!chordIsInterior(pts, 0, i)) continue;
        const err = Math.abs(distC(i) - reach);
        if (err < bestErr) {
          bestErr = err;
          best = i;
        }
      }
      return best;
    };
    const vF = pick(2, mid, 1);
    const vB = pick(n - 2, mid + 1, -1);

    // assemble wedge pieces sharing C and the chord vertices
    const targets: number[] = [];
    if (vF > 0) targets.push(vF);
    if (vB > 0 && vB !== vF) targets.push(vB);
    targets.sort((a, b) => a - b);
    if (targets.length === 0) continue;

    const pieces: Vec2[][] = [];
    pieces.push(pts.slice(0, targets[0] + 1)); // [C .. V1]
    for (let k = 0; k + 1 < targets.length; k++) {
      pieces.push([pts[0], ...pts.slice(targets[k], targets[k + 1] + 1)]); // [C, Vk .. Vk+1]
    }
    pieces.push([pts[0], ...pts.slice(targets[targets.length - 1])]); // [C, Vlast .. last]

    // all-or-nothing: build every wedge, keep the corner intact if any is degenerate
    const built: Shard[] = [];
    let ok = true;
    for (let k = 0; k < pieces.length; k++) {
      const idx = k === 0 ? ownerIdx : baseN + appended + (k - 1);
      const z = k === 0 ? owner.z : maxZ + 1 + appended + (k - 1);
      const sh = makeShard(seed, idx, pieces[k], owner.ringIndex, z, o.seamOutsetPx);
      if (!sh) {
        ok = false;
        break;
      }
      built.push(sh);
    }
    if (!ok) continue;

    shards[ownerIdx] = built[0];
    for (let k = 1; k < built.length; k++) shards.push(built[k]);
    appended += built.length - 1;
    // chords radiating from the corner; each is shared by its two flanking wedges
    const birth = 0.0 + 0.06 * rand01(seed, 'corner:birth', c);
    for (const v of targets) {
      cracks.push(makeCrack(seed, `cr${crackId++}`, 'split', [C, pts[v]], birth, 0.32, false));
    }
  }
}
