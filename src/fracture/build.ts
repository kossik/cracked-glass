import type { CrackPolyline, FractureOptions, Shard, Vec2 } from '../types';
import {
  cumulativeLengths,
  dedupePolygon,
  ensurePositiveWinding,
  flattenPts,
  offsetPolygon,
  polygonCentroid,
  signedArea,
} from '../core/geometry';
import { hashCombine, hashString, rngFor } from '../core/prng';
import { clamp } from '../core/math';

/** Fully-resolved generation options (internal). */
export interface ResolvedFracture {
  mode: 'title' | 'radial' | 'collapse' | 'hero' | 'web';
  width: number;
  height: number;
  seed: number;
  instanceId: string;
  edgeDetail: number;
  jaggedness: number;
  seamOutsetPx: number;
  deviation: number;
  microCount: number;
  microSizeRange: [number, number];
  stubs: { maxPerCrack: number; atJunctions: boolean } | false;
  bands: {
    count: number | [number, number];
    waviness: number;
    diagonalChance: number;
    tilt: number;
    splitters: number;
  };
  impact: Vec2;
  impactHole: number;
  rays: { count: number; angleJitter: number; waviness: number; doubling: boolean; doublingStartRing: number };
  rings: { count: number; spacing: 'uniform' | 'geometric'; jitter: number; partial: number; asymmetry: number };
  collapse: {
    angleA: number;
    angleB: number;
    countA: number | [number, number];
    countB: number | [number, number];
    waviness: number;
    merge: number;
  };
  hero: { count: number; sizeFrac: number; spread: number; overlap: number };
  web: { rays: number; rings: number; irregularity: number };
  corners: { relief: number } | false;
}

export function resolveFractureOptions(opts: FractureOptions): ResolvedFracture {
  if (!Number.isFinite(opts.width) || opts.width <= 0) throw new Error('cracked-glass: width must be > 0');
  if (!Number.isFinite(opts.height) || opts.height <= 0) throw new Error('cracked-glass: height must be > 0');
  if (!Number.isFinite(opts.seed)) throw new Error('cracked-glass: seed must be a finite number');
  const seed = opts.seed >>> 0;
  const micro = opts.micro;
  const defaultMicroCount =
    opts.mode === 'radial' ? 110 : opts.mode === 'collapse' ? 90 : opts.mode === 'hero' ? 0 : 36;
  // Family directions must stay transversal: the single-intersection guarantee needs >= 35 deg.
  const angleA = opts.collapse?.angleA ?? 14;
  let angleB = opts.collapse?.angleB ?? 76;
  const sep = Math.abs(((angleB - angleA + 90) % 180) - 90);
  if (sep < 35) angleB = angleA + (angleB >= angleA ? 35 : -35);
  return {
    mode: opts.mode,
    width: opts.width,
    height: opts.height,
    seed,
    instanceId: opts.instanceId ?? `cg${seed.toString(36)}`,
    edgeDetail: clamp(Math.round(opts.edgeDetail ?? 2), 0, 3),
    jaggedness: clamp(opts.jaggedness ?? 0.5, 0, 1),
    seamOutsetPx: opts.seamOutsetPx ?? 0.4,
    deviation: clamp(opts.deviation ?? 0.35, 0, 1),
    microCount: micro === false ? 0 : Math.max(0, Math.round(micro?.count ?? defaultMicroCount)),
    microSizeRange: micro === false ? [0, 0] : (micro?.sizeRange ?? [1.5, 5]),
    stubs:
      opts.stubs === false
        ? false
        : {
            maxPerCrack: Math.max(0, Math.round(opts.stubs?.maxPerCrack ?? 4)),
            atJunctions: opts.stubs?.atJunctions ?? true,
          },
    bands: {
      count: opts.bands?.count ?? [3, 5],
      waviness: clamp(opts.bands?.waviness ?? 0.5, 0, 1),
      diagonalChance: clamp(opts.bands?.diagonalChance ?? 0.6, 0, 1),
      tilt: clamp(opts.bands?.tilt ?? 0.6, 0, 1),
      splitters: clamp(Math.round(opts.bands?.splitters ?? 3), 1, 3),
    },
    impact: opts.impact
      ? [clamp(opts.impact.x, 0, opts.width), clamp(opts.impact.y, 0, opts.height)]
      : [opts.width / 2, opts.height / 2],
    impactHole: clamp(opts.impactHole ?? 1, 0.3, 3),
    rays: {
      // lower default ray count keeps the cell count (and thus per-shard DOM cost) sane;
      // the lab lets you crank it higher when you want a denser web.
      count: Math.max(3, Math.round(opts.rays?.count ?? 6)),
      angleJitter: clamp(opts.rays?.angleJitter ?? 0.6, 0, 1),
      waviness: clamp(opts.rays?.waviness ?? 0.5, 0, 1),
      doubling: opts.rays?.doubling ?? true,
      doublingStartRing: Math.max(1, Math.round(opts.rays?.doublingStartRing ?? 3)),
    },
    rings: {
      count: Math.max(1, Math.round(opts.rings?.count ?? 4)),
      spacing: opts.rings?.spacing ?? 'geometric',
      jitter: clamp(opts.rings?.jitter ?? 0.5, 0, 1),
      partial: clamp(opts.rings?.partial ?? 0.88, 0, 1),
      asymmetry: clamp(opts.rings?.asymmetry ?? 0.45, 0, 1),
    },
    collapse: {
      angleA,
      angleB,
      countA: opts.collapse?.countA ?? [3, 5],
      countB: opts.collapse?.countB ?? [4, 7],
      waviness: clamp(opts.collapse?.waviness ?? 0.5, 0, 1),
      merge: clamp(opts.collapse?.merge ?? 0.3, 0, 1),
    },
    hero: {
      count: clamp(Math.round(opts.hero?.count ?? 1), 1, 3),
      sizeFrac: clamp(opts.hero?.sizeFrac ?? 0.34, 0.05, 0.48),
      spread: clamp(opts.hero?.spread ?? 0.5, 0, 1),
      overlap: clamp(opts.hero?.overlap ?? 0, 0, 1),
    },
    web: {
      rays: Math.max(3, Math.round(opts.web?.rays ?? 7)),
      rings: Math.max(1, Math.round(opts.web?.rings ?? 4)),
      irregularity: clamp(opts.web?.irregularity ?? 0.6, 0, 1),
    },
    corners:
      opts.corners === false ? false : { relief: clamp(opts.corners?.relief ?? 0.55, 0, 1) },
  };
}

/** Build a CrackPolyline record: cumulative lengths + pre-stationed hackle ticks. */
export function makeCrack(
  seed: number,
  id: string,
  kind: CrackPolyline['kind'],
  pts: Vec2[],
  birth: number,
  growDuration: number,
  withTicks = true,
): CrackPolyline {
  const cum = cumulativeLengths(pts);
  const totalLen = cum[cum.length - 1];
  const ticks: number[] = [];
  // Stationed at max density; render-time hackleDensity picks a prefix-by-modulo subset.
  const rng = rngFor(seed, 'ticks', hashString(id));
  const spacing = 11;
  for (let s = withTicks ? spacing * (0.5 + rng()) : totalLen; s < totalLen - 4; s += spacing * (0.7 + rng() * 0.8)) {
    const p = pointAt(pts, cum, s);
    const q = pointAt(pts, cum, Math.min(totalLen, s + 1.5));
    let dx = q[0] - p[0];
    let dy = q[1] - p[1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    const side = rng() < 0.5 ? 1 : -1;
    const len = 1.6 + rng() * 3.2;
    // Tick leaves the crack at ~55-80 degrees, like hackle marks.
    const a = (55 + rng() * 25) * (Math.PI / 180) * side;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const tx = dx * cos - dy * sin;
    const ty = dx * sin + dy * cos;
    ticks.push(s, p[0], p[1], p[0] + tx * len, p[1] + ty * len);
  }
  return {
    id,
    kind,
    points: flattenPts(pts),
    cumLen: cum,
    totalLen,
    birth,
    growDuration,
    ticks,
  };
}

function pointAt(pts: Vec2[], cum: number[], len: number): Vec2 {
  // Local import-free copy of pointAtLength to avoid a cycle; small and hot.
  const total = cum[cum.length - 1];
  if (len <= 0) return pts[0];
  if (len >= total) return pts[pts.length - 1];
  let lo = 0;
  let hi = cum.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= len) lo = mid;
    else hi = mid;
  }
  const segLen = cum[hi] - cum[lo];
  const t = segLen > 1e-12 ? (len - cum[lo]) / segLen : 0;
  return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * t, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * t];
}

export function makeShard(
  seed: number,
  index: number,
  poly: Vec2[],
  ringIndex: number,
  z: number,
  seamOutsetPx: number,
): Shard | null {
  const cleaned = dedupePolygon(poly);
  if (cleaned.length < 3) return null;
  const wound = ensurePositiveWinding(cleaned);
  const area = signedArea(wound);
  if (area < 2) return null;
  const outset = seamOutsetPx > 0 ? offsetPolygon(wound, seamOutsetPx) : wound;
  return {
    id: `s${index}`,
    polygon: flattenPts(wound),
    outsetPolygon: flattenPts(outset),
    centroid: polygonCentroid(wound),
    area,
    ringIndex,
    z,
    hash: hashCombine(seed, hashString('shard'), index),
  };
}

/** Deterministic shuffle of 0..n-1 (Fisher-Yates over a seeded stream). */
export function shuffledRanks(seed: number, key: string, n: number): number[] {
  const rng = rngFor(seed, key);
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = idx[i];
    idx[i] = idx[j];
    idx[j] = tmp;
  }
  const ranks = new Array<number>(n);
  for (let rank = 0; rank < n; rank++) ranks[idx[rank]] = rank;
  return ranks;
}

/** Concatenate ordered edge polylines into a closed polygon, dropping duplicated junctions. */
export function stitchLoop(segments: Vec2[][]): Vec2[] {
  const out: Vec2[] = [];
  for (const seg of segments) {
    const start = out.length === 0 ? 0 : 1;
    for (let i = start; i < seg.length; i++) out.push(seg[i]);
  }
  return dedupePolygon(out);
}

export function reversePts(pts: Vec2[]): Vec2[] {
  return pts.slice().reverse();
}
