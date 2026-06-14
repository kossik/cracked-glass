import type { CrackPolyline, Shard, Vec2 } from '../types';
import { TAU } from '../core/math';
import { rngFor } from '../core/prng';
import { subdivideMidpoint } from '../core/noise';
import { makeShard, type ResolvedFracture } from './build';
import type { StubJunction } from './stubs';

export interface HeroFractureResult {
  shards: Shard[];
  cracks: CrackPolyline[];
  junctions: StubJunction[];
  stubScale: number;
}

/**
 * mode 'hero': 1..3 free-floating standalone shards. Unlike pane partitions, hero shards
 * do not tile anything - each is an independent closed polygon whose ENTIRE perimeter is
 * a jagged fracture face (no straight container edges). Built for close-up scenes where
 * a shard levitates over content; the regular per-shard pipeline (refraction, chroma,
 * facet, bevel, spectrum) applies unchanged.
 */
export function generateHeroFracture(o: ResolvedFracture): HeroFractureResult {
  const w = o.width;
  const h = o.height;
  const minDim = Math.min(w, h);
  const baseR = o.hero.sizeFrac * minDim;
  const centers = layoutCenters(o, baseR);

  const shards: Shard[] = [];
  for (let k = 0; k < centers.length; k++) {
    const rng = rngFor(o.seed, 'hero', k);
    // Base ring: stratified angular slots with bounded jitter (monotone angles -> the
    // ring stays a simple star-shaped polygon), radius jitter gives the silhouette.
    const nV = 11 + Math.floor(rng() * 5);
    const rotOff = rng() * TAU;
    const rScale = 0.88 + rng() * 0.24;
    const slot = TAU / nV;
    const ring: Vec2[] = [];
    for (let i = 0; i < nV; i++) {
      const ang = rotOff + i * slot + (rng() - 0.5) * slot * 0.55;
      const rad = baseR * rScale * (0.76 + 0.46 * rng());
      ring.push([centers[k][0] + Math.cos(ang) * rad, centers[k][1] + Math.sin(ang) * rad]);
    }
    // Conchoidal jagging of every edge; vertices never move, the closure point stays exact.
    ring.push(ring[0]);
    const jagged = subdivideMidpoint(
      ring,
      o.edgeDetail,
      o.jaggedness * 0.5,
      rngFor(o.seed, 'hero:jag', k)() * 0xffffffff,
      baseR * 0.12,
    );
    jagged.pop(); // drop the duplicated closure point
    const shard = makeShard(o.seed, k, jagged, 0, k, o.seamOutsetPx);
    if (shard) shards.push(shard);
  }

  return { shards, cracks: [], junctions: [], stubScale: baseR };
}

/** Deterministic shard centers: single = canvas center; 2 = vertical stack; 3 = triangle. */
function layoutCenters(o: ResolvedFracture, baseR: number): Vec2[] {
  const cx = o.width / 2;
  const cy = o.height / 2;
  const K = o.hero.count;
  if (K === 1) return [[cx, cy]];
  const rng = rngFor(o.seed, 'hero:layout');
  // Separation between neighbor centers; overlap pulls shards into each other (z-stack).
  const sep = baseR * (1.05 + 0.9 * o.hero.spread) * (1 - 0.72 * o.hero.overlap);
  if (K === 2) {
    const dx = baseR * 0.22 * (rng() * 2 - 1);
    return [
      [cx + dx, cy - sep / 2],
      [cx - dx, cy + sep / 2],
    ];
  }
  // K === 3: triangle with a deterministic rotation.
  const a0 = -Math.PI / 2 + (rng() - 0.5) * 0.5;
  const out: Vec2[] = [];
  for (let k = 0; k < 3; k++) {
    const a = a0 + (k * TAU) / 3;
    out.push([cx + Math.cos(a) * sep * 0.62, cy + Math.sin(a) * sep * 0.62]);
  }
  return out;
}
