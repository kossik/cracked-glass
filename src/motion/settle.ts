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
