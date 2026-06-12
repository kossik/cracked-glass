/**
 * Seeded, order-independent randomness.
 *
 * Every subsystem derives its own stream via rngFor(seed, key, ...indices), so consuming
 * randomness in one feature never shifts another feature's values. No Math.random anywhere.
 */

/** FNV-1a 32-bit string hash. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mix any number of u32-ish values into one u32 (murmur3-style avalanche per value). */
export function hashCombine(...vals: number[]): number {
  let h = 0x9e3779b9;
  for (let i = 0; i < vals.length; i++) {
    let x = vals[i] >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
    x ^= x >>> 16;
    h = (Math.imul(h, 0x01000193) ^ x) >>> 0;
  }
  return h >>> 0;
}

/** Map a u32 hash to [0,1). */
export function hashTo01(h: number): number {
  return (h >>> 0) / 4294967296;
}

/** mulberry32 PRNG. Stateful closure, but only ever local to a single pure computation. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Independent stream for (seed, subsystem, ...indices). */
export function rngFor(seed: number, subsystem: string, ...idx: number[]): () => number {
  return mulberry32(hashCombine(seed >>> 0, hashString(subsystem), ...idx));
}

/** One-shot value in [0,1) for (seed, subsystem, ...indices). */
export function rand01(seed: number, subsystem: string, ...idx: number[]): number {
  return hashTo01(hashCombine(seed >>> 0, hashString(subsystem), ...idx));
}
