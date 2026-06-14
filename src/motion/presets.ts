import type { EffectParams, TimelineParams } from '../types';
import { staticCrackedTimeline } from './timeline';

/**
 * Named motion presets - the dramaturgy recipes from the creative guide as reusable
 * constants. Spread a timeline/shatter preset into your `fx`; they only set timing and
 * flight, never geometry or look, so they compose with any mode and palette.
 *
 *   computeFrame(t, pattern, { timeline: impactTimeline, shatter: hardBlastShatter })
 */

/** Hard, fast impact: a short crack phase then an immediate blast. Pair with near-linear t. */
export const impactTimeline: TimelineParams = { crackStart: 0, crackEnd: 0.2, shatterStart: 0.25 };

/** Suspense: a long crack phase that makes the viewer wait, then a late shatter. */
export const suspenseTimeline: TimelineParams = { crackStart: 0, crackEnd: 0.55, shatterStart: 0.72 };

/** Re-export so every timing preset is reachable from one place (poster / static state). */
export { staticCrackedTimeline };

/** Aggressive outward blast - fast, low gravity, lots of spin and tumble. */
export const hardBlastShatter: Partial<EffectParams['shatter']> = {
  speed: 1600,
  gravity: [0, 420],
  drag: 1.0,
  spinDegMax: 200,
  tumbleDegMax: 80,
  staggerPerRing: 0.03,
};

/**
 * Pieces lose support and drop under heavy gravity, tearing off one by one (mode 'collapse').
 * A slightly more reluctant variant of collapseShatterPreset for melancholy pacing.
 */
export const gentleCrumbleShatter: Partial<EffectParams['shatter']> = {
  speed: 280,
  gravity: [0, 2200],
  drag: 0.6,
  spinDegMax: 70,
  tumbleDegMax: 28,
  staggerPerRing: 0.07,
};

/** One mood -> one {timeline, shatter} bundle. Used by the lab's motion-preset selector. */
export interface MotionPreset {
  label: string;
  timeline?: TimelineParams;
  shatter?: Partial<EffectParams['shatter']>;
}

export const motionPresets: Record<string, MotionPreset> = {
  impact: { label: 'Impact - hard blast', timeline: impactTimeline, shatter: hardBlastShatter },
  suspense: { label: 'Suspense - long crack, late shatter', timeline: suspenseTimeline },
  crumble: { label: 'Crumble - reluctant gravity fall', shatter: gentleCrumbleShatter },
  poster: { label: 'Poster - static cracked, no shatter', timeline: staticCrackedTimeline },
};
