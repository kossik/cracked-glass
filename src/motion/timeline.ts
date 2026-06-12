import type { Phase, TimelineParams } from '../types';
import { clamp01 } from '../core/math';

export interface PhaseInfo {
  phase: Phase;
  /** 0..1 progress of the crack network growth. */
  crackProgress: number;
  /** Time elapsed since shatterStart (0 before it; never negative). */
  shatterTau: number;
}

export function resolvePhase(t: number, tl: TimelineParams): PhaseInfo {
  const crackProgress =
    tl.crackEnd <= tl.crackStart ? (t >= tl.crackEnd ? 1 : 0) : clamp01((t - tl.crackStart) / (tl.crackEnd - tl.crackStart));
  const shattering = Number.isFinite(tl.shatterStart) && t >= tl.shatterStart;
  const shatterTau = shattering ? t - tl.shatterStart : 0;
  let phase: Phase;
  if (shattering) phase = 'shattering';
  else if (crackProgress <= 0) phase = 'intact';
  else if (crackProgress < 1) phase = 'cracking';
  else phase = 'cracked';
  return { phase, crackProgress, shatterTau };
}

/** Timeline for a permanently-cracked (never shattering) state - e.g. a broken title. */
export const staticCrackedTimeline: TimelineParams = {
  crackStart: -1,
  crackEnd: 0,
  shatterStart: Infinity,
};
