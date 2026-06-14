import { TAU } from '../core/math';
import { hashTo01, hashCombine } from '../core/prng';

export interface SettleOffset {
  dx: number;
  dy: number;
  rot: number;
}

/**
 * Damped wobble of the cracked-but-not-shattered state, e.g. shards "breathing" after impact.
 * Pure function of t; amplitude 0 (the default) keeps the cracked state perfectly frozen.
 */
/**
 * Levitation of a free shard (mode 'hero'): undamped sinusoids of t with hash-derived
 * phases. Integer `cycles` loop seamlessly over t in [0, 1]. Pure function of t.
 */
export function floatOffset(
  t: number,
  shardHash: number,
  f: { bobPx: number; swayPx: number; rotDeg: number; cycles: number },
): SettleOffset {
  if (f.bobPx <= 0 && f.swayPx <= 0 && f.rotDeg <= 0) return { dx: 0, dy: 0, rot: 0 };
  const phaseA = hashTo01(hashCombine(shardHash, 41)) * TAU;
  const phaseB = hashTo01(hashCombine(shardHash, 53)) * TAU;
  const phaseC = hashTo01(hashCombine(shardHash, 67)) * TAU;
  const w = TAU * f.cycles;
  return {
    dx: Math.sin(w * t + phaseA) * f.swayPx,
    dy: Math.sin(w * t + phaseB) * f.bobPx,
    rot: Math.sin(w * t + phaseC) * f.rotDeg,
  };
}

export function settleOffset(
  t: number,
  shardHash: number,
  amplitudePx: number,
  frequency: number,
  sinceT: number,
): SettleOffset {
  if (amplitudePx <= 0) return { dx: 0, dy: 0, rot: 0 };
  const tau = Math.max(0, t - sinceT);
  const damp = Math.exp(-3.2 * tau);
  const phaseA = hashTo01(hashCombine(shardHash, 11)) * TAU;
  const phaseB = hashTo01(hashCombine(shardHash, 23)) * TAU;
  const w = TAU * frequency;
  return {
    dx: Math.sin(w * tau + phaseA) * amplitudePx * damp,
    dy: Math.cos(w * tau * 0.9 + phaseB) * amplitudePx * 0.7 * damp,
    rot: Math.sin(w * tau * 0.75 + phaseA + phaseB) * amplitudePx * 0.12 * damp,
  };
}
