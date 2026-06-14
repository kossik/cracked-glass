/**
 * cracked-glass - deterministic cracked/shattered glass effect for the web.
 *
 * Pure pipeline:
 *   generateFracture(opts)       -> FracturePattern  (t-independent, frozen, cacheable)
 *   computeFrame(t, pattern, fx) -> FrameData        (plain data; render however you like)
 *
 * React renderers live in 'cracked-glass/react'.
 *
 * Contract: no clocks, no Math.random, no network/storage, no CSS/SMIL/WAAPI animations,
 * no mutable state between calls. Same inputs -> byte-identical output.
 */

export { generateFracture } from './fracture/index';
export { computeFrame } from './render/frame';
export { normalizeEffectParams, defaultEffectParams } from './render/params';
export { resolveQuality, qualityPresets } from './render/quality';
export { staticCrackedTimeline, resolvePhase } from './motion/timeline';
export { flightOffset, flightSpeed } from './motion/kinematics';
export {
  impactTimeline,
  suspenseTimeline,
  hardBlastShatter,
  gentleCrumbleShatter,
  motionPresets,
  type MotionPreset,
} from './motion/presets';

import type { EffectParams } from './types';

/**
 * Recommended shatter overrides for mode 'collapse': pieces barely get a push -
 * gravity does the work, the pane crumbles out of its frame bottom-up.
 */
export const collapseShatterPreset: Partial<EffectParams['shatter']> = {
  speed: 300,
  gravity: [0, 2200],
  drag: 0.6,
  spinDegMax: 80,
  tumbleDegMax: 30,
  staggerPerRing: 0.05,
};

export type {
  BlendMode,
  CrackPolyline,
  DeepPartial,
  EffectParams,
  FractureMode,
  FractureOptions,
  FracturePattern,
  FrameData,
  MicroShardSeed,
  Phase,
  QualityPreset,
  QualitySettings,
  Shard,
  ShardFrame,
  TimelineParams,
  Vec2,
} from './types';
