import { hashCombine, hashTo01 } from './prng';
import { lerp, smoothstep } from './math';
import type { Vec2 } from '../types';

/** Deterministic 1D value noise in [-1, 1] on an integer lattice. */
export function valueNoise1D(seed: number, x: number): number {
  const xi = Math.floor(x);
  const xf = x - xi;
  const r0 = hashTo01(hashCombine(seed, xi | 0));
  const r1 = hashTo01(hashCombine(seed, (xi + 1) | 0));
  return lerp(r0, r1, smoothstep(xf)) * 2 - 1;
}

/** Fractal Brownian motion over valueNoise1D, in [-1, 1]-ish. */
export function fbm1D(seed: number, x: number, octaves = 3, lacunarity = 2, gain = 0.5): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise1D(hashCombine(seed, o), x * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

/**
 * Midpoint-displacement subdivision of a polyline - the conchoidal jagging of crack edges.
 * Endpoints never move. Displacements are seeded per (level, segment index), so a given
 * polyline always jags identically no matter who asks for it.
 *
 * @param roughness 0..1 - displacement amplitude relative to segment length.
 * @param maxOffset optional hard clamp (px) for any single displacement.
 */
export function subdivideMidpoint(
  pts: Vec2[],
  depth: number,
  roughness: number,
  seed: number,
  maxOffset = Infinity,
): Vec2[] {
  let cur = pts;
  for (let level = 0; level < depth; level++) {
    const next: Vec2[] = [cur[0]];
    const levelAmp = roughness * 0.5 * Math.pow(0.55, level);
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i];
      const b = cur[i + 1];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const segLen = Math.hypot(dx, dy);
      if (segLen > 1e-9) {
        const nx = -dy / segLen;
        const ny = dx / segLen;
        const r = hashTo01(hashCombine(seed, level, i)) * 2 - 1;
        let off = r * levelAmp * segLen;
        if (off > maxOffset) off = maxOffset;
        if (off < -maxOffset) off = -maxOffset;
        next.push([(a[0] + b[0]) / 2 + nx * off, (a[1] + b[1]) / 2 + ny * off]);
      }
      next.push(b);
    }
    cur = next;
  }
  return cur;
}
