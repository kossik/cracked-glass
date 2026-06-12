import type { CrackPolyline, MicroShardSeed, Vec2 } from '../types';
import { hashCombine, hashString, rngFor } from '../core/prng';
import { pointAtLength, unflattenPts } from '../core/geometry';
import { TAU, clamp01, lerp } from '../core/math';
import type { ResolvedFracture } from './build';

/**
 * Micro debris: tiny polygons seeded along crack polylines (weighted by length).
 * They become visible as the crack passes their station and later follow the global
 * shatter motion law (handled in render/frame).
 */
export function seedMicroShards(
  o: ResolvedFracture,
  allCracks: CrackPolyline[],
  ringIndexAt: (origin: Vec2) => number,
): MicroShardSeed[] {
  // Stubs are render-only hairlines: excluding them keeps micro byte-identical to a
  // stubs-off pattern (and debris belongs on the real fracture network anyway).
  const cracks = allCracks.filter((c) => c.kind !== 'stub');
  if (o.microCount <= 0 || cracks.length === 0) return [];
  const cumTotals: number[] = [];
  let total = 0;
  for (const c of cracks) {
    total += c.totalLen;
    cumTotals.push(total);
  }
  if (total <= 0) return [];

  const out: MicroShardSeed[] = [];
  for (let i = 0; i < o.microCount; i++) {
    const rng = rngFor(o.seed, 'micro', i);
    const pickLen = rng() * total;
    let ci = 0;
    while (ci < cumTotals.length - 1 && cumTotals[ci] <= pickLen) ci++;
    const crack = cracks[ci];
    const pts = unflattenPts(crack.points);
    const s = rng() * crack.totalLen;
    const p = pointAtLength(pts, crack.cumLen, s);
    const offAng = rng() * TAU;
    const offDist = 1 + rng() * 4;
    const origin: Vec2 = [p[0] + Math.cos(offAng) * offDist, p[1] + Math.sin(offAng) * offDist];

    // Tiny 3-4 point splinter around (0,0), elongated like glass dust.
    const sizeT = Math.pow(rng(), 1.6);
    const size = lerp(o.microSizeRange[0], o.microSizeRange[1], sizeT);
    const nPts = rng() < 0.6 ? 3 : 4;
    const baseAng = rng() * TAU;
    const elong = 0.45 + rng() * 0.55;
    const poly: number[] = [];
    for (let k = 0; k < nPts; k++) {
      const a = baseAng + (k / nPts) * TAU + (rng() - 0.5) * 0.9;
      const r = size * (0.5 + rng() * 0.6);
      poly.push(Math.cos(a) * r, Math.sin(a) * r * elong);
    }

    const birth = clamp01(crack.birth + (s / Math.max(1e-6, crack.totalLen)) * crack.growDuration);
    out.push({
      id: `m${i}`,
      polygon: poly,
      origin,
      hash: hashCombine(o.seed, hashString('micro'), i),
      birth,
      ringIndex: ringIndexAt(origin),
    });
  }
  return out;
}
