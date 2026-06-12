import type { EffectParams, FracturePattern, Shard, Vec2 } from '../types';
import { TAU, degToRad } from '../core/math';
import { hashCombine, hashString, hashTo01, rngFor } from '../core/prng';

export type OutlierKind = 'none' | 'dropped' | 'slipped' | 'rebel';

/**
 * The glitch principle: a system plus exceptions. A pure function of shard.hash - threshold
 * based, so tweaking one fraction never reshuffles unrelated shards.
 */
export function classifyOutlier(hash: number, outliers: EffectParams['outliers']): OutlierKind {
  const r = hashTo01(hashCombine(hash, hashString('outlier')));
  if (r < outliers.dropFraction) return 'dropped';
  if (r < outliers.dropFraction + outliers.slipFraction) return 'slipped';
  if (r < outliers.dropFraction + outliers.slipFraction + outliers.rebelFraction) return 'rebel';
  return 'none';
}

/**
 * One whole-pattern outlier assignment, computed once per frame and threaded into BOTH the
 * style layer and the motion layer (so they always agree). The radial crush disc is excluded
 * (the punch owns it). Small patterns (titles have 4-7 shards) get a deterministic guarantee:
 * if fractions are on but the dice produced no exception at all, the non-dropped shard with
 * the smallest classification roll is promoted to 'slipped' - there is always an exception.
 */
export function assignOutliers(pattern: FracturePattern, outliers: EffectParams['outliers']): OutlierKind[] {
  const kinds: OutlierKind[] = [];
  let hasException = false;
  for (const s of pattern.shards) {
    if (pattern.mode === 'radial' && s.ringIndex === 0) {
      kinds.push('none');
      continue;
    }
    const k = classifyOutlier(s.hash, outliers);
    if (k !== 'none') hasException = true;
    kinds.push(k);
  }
  // Cap the dropped count at the expected value (rounded up): per-shard dice can cluster
  // on small patterns and delete half a headline. Excess drops (largest classification
  // rolls first) are demoted to 'slipped' - deterministic, threshold-stable.
  if (outliers.dropFraction > 0) {
    const maxDrop = Math.max(1, Math.ceil(pattern.shards.length * outliers.dropFraction));
    const dropped: Array<{ i: number; r: number }> = [];
    for (let i = 0; i < kinds.length; i++) {
      if (kinds[i] === 'dropped') {
        dropped.push({ i, r: hashTo01(hashCombine(pattern.shards[i].hash, hashString('outlier'))) });
      }
    }
    if (dropped.length > maxDrop) {
      dropped.sort((a, b) => b.r - a.r || a.i - b.i);
      for (let k = 0; k < dropped.length - maxDrop; k++) kinds[dropped[k].i] = 'slipped';
    }
  }
  if (
    !hasException &&
    pattern.shards.length <= 12 &&
    outliers.slipFraction + outliers.rebelFraction > 0
  ) {
    let best = -1;
    let bestR = Infinity;
    for (let i = 0; i < pattern.shards.length; i++) {
      if (kinds[i] !== 'none') continue;
      if (pattern.mode === 'radial' && pattern.shards[i].ringIndex === 0) continue;
      const r = hashTo01(hashCombine(pattern.shards[i].hash, hashString('outlier')));
      if (r < bestR) {
        bestR = r;
        best = i;
      }
    }
    if (best >= 0) kinds[best] = 'slipped';
  }
  return kinds;
}

/**
 * Closed-form ballistic flight with linear drag - scrub-safe by construction:
 *   p(tau) = v0 * (1 - e^(-d*tau)) / d  +  g * (d*tau - 1 + e^(-d*tau)) / d^2
 */
export function flightOffset(tau: number, v0: Vec2, g: Vec2, drag: number): Vec2 {
  if (tau <= 0) return [0, 0];
  if (drag <= 1e-6) {
    return [v0[0] * tau + 0.5 * g[0] * tau * tau, v0[1] * tau + 0.5 * g[1] * tau * tau];
  }
  const e = Math.exp(-drag * tau);
  const a = (1 - e) / drag;
  const b = (drag * tau - 1 + e) / (drag * drag);
  return [v0[0] * a + g[0] * b, v0[1] * a + g[1] * b];
}

/** Analytic speed at tau (for the motion-blur ghost threshold). */
export function flightSpeed(tau: number, v0: Vec2, g: Vec2, drag: number): number {
  if (tau < 0) tau = 0;
  let vx: number;
  let vy: number;
  if (drag <= 1e-6) {
    vx = v0[0] + g[0] * tau;
    vy = v0[1] + g[1] * tau;
  } else {
    const e = Math.exp(-drag * tau);
    vx = v0[0] * e + (g[0] * (1 - e)) / drag;
    vy = v0[1] * e + (g[1] * (1 - e)) / drag;
  }
  return Math.hypot(vx, vy);
}

export interface ShardMotion {
  v0: Vec2;
  /** In-plane spin, deg per t. */
  omega: number;
  /** 3D tumble rates, deg per t. */
  tumbleX: number;
  tumbleY: number;
  /** Delay after shatterStart before this shard departs. */
  birthDelay: number;
}

/**
 * Per-shard motion constants - a pure function of (pattern, shard, fx, outlier kind).
 * radial: shards blast outward from the impact; title: slabs drop with a slight drift;
 * collapse: pieces barely get a push, gravity does the work. 'rebel' outliers disobey.
 */
export function shardMotion(
  pattern: FracturePattern,
  shard: Shard,
  fx: EffectParams,
  kind: OutlierKind = 'none',
): ShardMotion {
  const rng = rngFor(shard.hash, 'motion');
  const sh = fx.shatter;
  const jitter = (amount: number) => 1 + (rng() * 2 - 1) * sh.jitter * amount;

  let dirX: number;
  let dirY: number;
  let speed: number;
  if (typeof sh.direction === 'number') {
    const a = degToRad(sh.direction);
    dirX = Math.cos(a);
    dirY = Math.sin(a);
    speed = sh.speed * jitter(0.5);
  } else if (pattern.mode === 'radial') {
    const dx = shard.centroid[0] - pattern.impact[0];
    const dy = shard.centroid[1] - pattern.impact[1];
    const d = Math.hypot(dx, dy) || 1;
    // Slight deterministic angular scatter so the blast does not look like spokes.
    const scatter = (rng() * 2 - 1) * 0.22;
    const cos = Math.cos(scatter);
    const sin = Math.sin(scatter);
    dirX = (dx / d) * cos - (dy / d) * sin;
    dirY = (dx / d) * sin + (dy / d) * cos;
    // Inner rings fly faster (energy near the impact).
    speed = (sh.speed * jitter(0.6)) / (1 + 0.35 * shard.ringIndex);
  } else if (pattern.mode === 'collapse') {
    // pieces lose support and drop: tiny initial velocity, gravity does the work
    dirX = (rng() * 2 - 1) * 0.18;
    dirY = 0.15 + rng() * 0.25;
    const n = Math.hypot(dirX, dirY) || 1;
    dirX /= n;
    dirY /= n;
    speed = sh.speed * 0.18 * jitter(0.6);
  } else {
    // title: slabs fall, drifting apart horizontally a bit.
    const drift = (rng() * 2 - 1) * 0.35;
    dirX = drift;
    dirY = 0.45 + rng() * 0.4;
    const n = Math.hypot(dirX, dirY) || 1;
    dirX /= n;
    dirY /= n;
    speed = sh.speed * 0.55 * jitter(0.6);
  }

  // Small shards spin faster (moment of inertia).
  const sizeFactor = 1 / Math.max(0.45, Math.pow(shard.area / 12000, 0.25));
  const omega = (rng() * 2 - 1) * sh.spinDegMax * sizeFactor;
  const tumbleX = (rng() * 2 - 1) * sh.tumbleDegMax * sizeFactor;
  const tumbleY = (rng() * 2 - 1) * sh.tumbleDegMax * sizeFactor;
  let birthDelay = shard.ringIndex * sh.staggerPerRing * jitter(1);
  if (pattern.mode === 'collapse') {
    // bottom-up cascade with a strong random admixture - pieces tear off around their row
    birthDelay += rng() * sh.staggerPerRing * 1.5;
  }

  let vx = dirX * speed;
  let vy = dirY * speed;
  let omegaOut = omega;
  if (kind === 'rebel') {
    // rebels disobey the choreography: off-axis, faster, badly timed
    const rr = rngFor(shard.hash, 'rebel');
    const ang = (rr() * 2 - 1) * 0.6;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const rvx = (vx * cos - vy * sin) * 1.35;
    const rvy = (vx * sin + vy * cos) * 1.35;
    vx = rvx;
    vy = rvy;
    omegaOut = omega * 1.6;
    birthDelay = rr() < 0.5 ? birthDelay * 0.15 : birthDelay * 1.8 + 0.05;
  }

  return { v0: [vx, vy], omega: omegaOut, tumbleX, tumbleY, birthDelay };
}

/** Motion constants for a micro-debris splinter (same law, more violent). */
export function microMotion(
  pattern: FracturePattern,
  origin: Vec2,
  hash: number,
  ringIndex: number,
  fx: EffectParams,
): ShardMotion {
  const rng = rngFor(hash, 'micromotion');
  const sh = fx.shatter;
  let dirX: number;
  let dirY: number;
  if (pattern.mode === 'radial') {
    const dx = origin[0] - pattern.impact[0];
    const dy = origin[1] - pattern.impact[1];
    const d = Math.hypot(dx, dy) || 1;
    const scatter = (rng() * 2 - 1) * 0.5;
    const cos = Math.cos(scatter);
    const sin = Math.sin(scatter);
    dirX = (dx / d) * cos - (dy / d) * sin;
    dirY = (dx / d) * sin + (dy / d) * cos;
  } else if (pattern.mode === 'collapse') {
    // dust falls in a narrow downward cone
    dirX = (rng() * 2 - 1) * 0.3;
    dirY = 0.5 + rng() * 0.5;
    const n = Math.hypot(dirX, dirY) || 1;
    dirX /= n;
    dirY /= n;
  } else {
    const a = rng() * TAU;
    dirX = Math.cos(a) * 0.4;
    dirY = 0.6 + rng() * 0.5;
    const n = Math.hypot(dirX, dirY) || 1;
    dirX /= n;
    dirY /= n;
  }
  const speed = sh.speed * fx.micro.speedScale * (0.35 + rng() * 0.75) / (1 + 0.25 * ringIndex);
  const omega = (rng() * 2 - 1) * sh.spinDegMax * 3;
  const birthDelay = ringIndex * sh.staggerPerRing * (0.6 + rng() * 0.8);
  return { v0: [dirX * speed, dirY * speed], omega, tumbleX: 0, tumbleY: 0, birthDelay };
}
