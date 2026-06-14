import type { CrackPolyline, Shard, Vec2 } from '../types';
import { segmentIntersection, unflattenPts } from '../core/geometry';
import { rand01 } from '../core/prng';
import { makeCrack, makeShard, type ResolvedFracture } from './build';

/** Strict point-in-triangle via consistent cross-product signs. */
function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
  const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
  const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * The ear triangle [cutA, C, cutB] must be empty: no other owner vertex inside it and no
 * non-adjacent owner edge crossing the chord cutA->cutB. A re-entrant owner (extreme aspect
 * ratios + high jaggedness) can fold an edge back into the corner, where a blind cut would
 * self-intersect the remainder. When not clear, the corner is left intact (skip).
 */
function earIsClear(pts: Vec2[], ci: number, cutA: Vec2, C: Vec2, cutB: Vec2): boolean {
  const n = pts.length;
  for (let j = 0; j < n; j++) {
    if (j === ci || j === (ci - 1 + n) % n || j === (ci + 1) % n) continue;
    if (pointInTriangle(pts[j], cutA, C, cutB)) return false;
  }
  for (let j = 0; j < n; j++) {
    if (j === ci || j === (ci - 1 + n) % n) continue; // edges containing cutA/cutB are adjacent
    const a = pts[j];
    const b = pts[(j + 1) % n];
    const hit = segmentIntersection(a, b, cutA, cutB);
    if (hit && hit.ta > 1e-6 && hit.ta < 1 - 1e-6 && hit.tb > 1e-6 && hit.tb < 1 - 1e-6) return false;
  }
  return true;
}

/**
 * Corner relief: lop the perfect 90-degree shard off each canvas corner with a short
 * diagonal chord (real panes never break to a clean right angle).
 *
 * Watertight by construction AND index-stable, per adversarial review:
 * - the owner is selected by EXACT corner-vertex match; if 0 or 2 shards own the corner
 *   (near-edge radial impacts) the corner is SKIPPED (no tear, no crash);
 * - both corner-adjacent edges must lie on the rect border, and both must be long enough
 *   that the ear has real area (else makeShard would drop an area<2 sliver -> a hole);
 * - the radial crush plug (ringIndex 0) is skipped (its punch-through must stay a disc);
 * - an index-local EAR-CUT (not a generic chord split): the corner vertex is replaced by
 *   two cut points on its adjacent edges, giving exactly two simple polygons;
 * - the cut points are shared Vec2s spliced into both pieces, so the chord crack appears
 *   in exactly 2 shards (the watertight invariant);
 * - the owner is REPLACED IN PLACE (keeps its id/hash/z), the corner ear is APPENDED with a
 *   fresh index, so turning relief on never renumbers - thus never reshuffles the hash/pose
 *   of any other shard.
 *
 * Mutates `shards` and `cracks` in place. No-op when corners is false/relief 0 (byte anchor)
 * or for hero mode. Call BEFORE addStubCracks / micro seeding.
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

  const corners: Vec2[] = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];

  for (let c = 0; c < corners.length; c++) {
    const C = corners[c];
    // Owner = shards with C as an exact polygon vertex. Exactly one, or skip.
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
    if (o.mode === 'radial' && owner.ringIndex === 0) continue; // crush plug stays a disc

    const pts = unflattenPts(owner.polygon);
    const n = pts.length;
    let ci = -1;
    for (let i = 0; i < n; i++) {
      if (Math.abs(pts[i][0] - C[0]) < eps && Math.abs(pts[i][1] - C[1]) < eps) {
        ci = i;
        break;
      }
    }
    if (ci < 0) continue;
    const prev = pts[(ci - 1 + n) % n];
    const next = pts[(ci + 1) % n];
    // Both adjacent edges must lie on the pane border (so no neighbor shares them).
    if (!onBorder(prev, C) || !onBorder(C, next)) continue;

    const lenPrev = Math.hypot(prev[0] - C[0], prev[1] - C[1]);
    const lenNext = Math.hypot(next[0] - C[0], next[1] - C[1]);
    // Cut size: scaled by relief, capped to the adjacent edges and the shard's own extent.
    const cap = Math.min(0.4 * Math.sqrt(owner.area), 70);
    const jit = 0.8 + 0.4 * rand01(seed, 'corner', c);
    const target = relief * cap * jit;
    const dA = Math.min(target, 0.85 * lenPrev);
    const dB = Math.min(target, 0.85 * lenNext);
    if (dA < 8 || dB < 8) continue; // too small -> would drop as a sliver

    const cutA: Vec2 = [
      C[0] + ((prev[0] - C[0]) / lenPrev) * dA,
      C[1] + ((prev[1] - C[1]) / lenPrev) * dA,
    ];
    const cutB: Vec2 = [
      C[0] + ((next[0] - C[0]) / lenNext) * dB,
      C[1] + ((next[1] - C[1]) / lenNext) * dB,
    ];

    // Re-entrant owners can fold an edge into the corner: only cut if the ear is empty.
    if (!earIsClear(pts, ci, cutA, C, cutB)) continue;

    // Ear-cut: triangle [cutA, C, cutB]; remainder = loop with C replaced by cutA, cutB.
    const triangle: Vec2[] = [cutA, C, cutB];
    const remainder: Vec2[] = [];
    for (let i = 0; i < n; i++) {
      if (i === ci) {
        remainder.push(cutA, cutB);
      } else {
        remainder.push(pts[i]);
      }
    }

    // Owner keeps its identity (id/hash/z) so no other shard is disturbed; ear is appended.
    const rem = makeShard(seed, ownerIdx, remainder, owner.ringIndex, owner.z, o.seamOutsetPx);
    const ear = makeShard(seed, baseN + c, triangle, owner.ringIndex, maxZ + 1 + c, o.seamOutsetPx);
    if (!rem || !ear) continue; // degenerate -> leave this corner intact, never half-applied

    shards[ownerIdx] = rem;
    shards.push(ear);
    // The diagonal chord, shared by both pieces (cutA/cutB are the same floats in both).
    const birth = 0.02 + 0.08 * rand01(seed, 'corner:birth', c);
    cracks.push(makeCrack(seed, `cr${c}`, 'split', [cutA, cutB], birth, 0.35, false));
  }
}
