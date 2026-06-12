import { rand01 } from '../core/prng';
import { clamp } from '../core/math';
import { fbm1D } from '../core/noise';
import { hashCombine, hashString } from '../core/prng';

/**
 * Shared machinery for "veering" crack lines: excursion events (a minority of cracks
 * deviating strongly from the main flow) and clamped wavy base lines in an axis frame.
 */

export interface Excursion {
  /** Normalized center along the line, 0..1. */
  c: number;
  /** Normalized half-length. */
  half: number;
  /** Signed amplitude in v units. */
  amp: number;
  /** true = sharp tent kink, false = smooth raised cosine. */
  kink: boolean;
}

/**
 * Seeded excursion set for one line. ampMax is the local flow scale (e.g. band gap);
 * amplitudes intentionally exceed the safety corridor - the caller's corridor clamp
 * shapes saturated excursions into "sheared along the flow" runs.
 */
export function makeExcursions(seed: number, group: string, lineKey: number, deviation: number, ampMax: number): Excursion[] {
  if (deviation <= 0) return [];
  const out: Excursion[] = [];
  for (let idx = 0; idx < 2; idx++) {
    const p = idx === 0 ? deviation * 0.75 : deviation * 0.35;
    if (rand01(seed, `${group}:dev`, lineKey, idx) >= p) continue;
    const r1 = rand01(seed, `${group}:devA`, lineKey, idx);
    const r2 = rand01(seed, `${group}:devB`, lineKey, idx);
    const r3 = rand01(seed, `${group}:devC`, lineKey, idx);
    const r4 = rand01(seed, `${group}:devD`, lineKey, idx);
    const r5 = rand01(seed, `${group}:devE`, lineKey, idx);
    out.push({
      c: 0.15 + 0.7 * r1,
      half: 0.08 + 0.1 * r2,
      amp: (0.25 + 0.45 * r3) * ampMax * (r4 < 0.5 ? -1 : 1),
      kink: r5 < 0.5,
    });
  }
  return out;
}

/** Total excursion offset at normalized position u in [0,1]. */
export function excursionOffset(evts: Excursion[], u: number): number {
  let v = 0;
  for (const e of evts) {
    const d = Math.abs(u - e.c);
    if (d >= e.half) continue;
    const x = 1 - d / e.half; // 1 at center -> 0 at edges
    v += e.amp * (e.kink ? x : 0.5 * (1 - Math.cos(Math.PI * x)));
  }
  return v;
}

export interface BaseLineOpts {
  seed: number;
  group: string;
  key: number;
  /** Axis range (extended beyond the rect projection by the caller). */
  u0: number;
  u1: number;
  segments: number;
  /** Perpendicular center offset of the line. */
  offset: number;
  waveAmp: number;
  deviation: number;
  /** Local flow scale for excursion amplitudes. */
  devAmpMax: number;
  /** Max |dv/du| (= tan of the family's tangent-cone half-angle). */
  slopeMax: number;
  /** |v - offset| clamp (same-family corridor). */
  corridorHalf: number;
}

/**
 * Smooth monotone-in-u base line in an axis frame: waves + excursions, then a forward
 * slope clamp (keeps the line inside its family's tangent cone -> guarantees a single
 * intersection with any line of a transversal family) and a corridor clamp (keeps
 * same-family lines from crossing each other). Returns parallel arrays u[], v[].
 */
export function baseLine(o: BaseLineOpts): { u: number[]; v: number[] } {
  const waveSeed = hashCombine(o.seed, hashString(`${o.group}:wave`), o.key);
  const evts = makeExcursions(o.seed, o.group, o.key, o.deviation, o.devAmpMax);
  const u: number[] = [];
  const v: number[] = [];
  for (let i = 0; i <= o.segments; i++) {
    const f = i / o.segments;
    u.push(o.u0 + (o.u1 - o.u0) * f);
    v.push(o.offset + fbm1D(waveSeed, i * 0.85, 3) * o.waveAmp + excursionOffset(evts, f));
  }
  // slope clamp -> corridor clamp -> slope clamp (the corridor never widens a clamped slope
  // beyond the budget, the second pass is a cheap belt for edge cases)
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < v.length; i++) {
      const du = u[i] - u[i - 1];
      v[i] = clamp(v[i], v[i - 1] - o.slopeMax * du, v[i - 1] + o.slopeMax * du);
    }
    for (let i = 0; i < v.length; i++) {
      v[i] = clamp(v[i], o.offset - o.corridorHalf, o.offset + o.corridorHalf);
    }
  }
  return { u, v };
}
