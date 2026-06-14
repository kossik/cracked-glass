import type { DeepPartial, EffectParams, FracturePattern, FrameData, Vec2 } from '../types';
import { clamp, clamp01, degToRad, fmt } from '../core/math';
import { toSvgPoints } from '../core/geometry';
import { hashTo01, hashCombine, rngFor } from '../core/prng';
import { resolvePhase } from '../motion/timeline';
import { assignOutliers, flightOffset, microMotion } from '../motion/kinematics';
import { normalizeEffectParams } from './params';
import { resolveQuality } from './quality';
import { crackLayer } from './cracks';
import { buildShardFrame, shardPose, type SpectralBand } from './shardStyle';

/**
 * The heart of the library: a referentially-transparent (t, pattern, fx) -> FrameData.
 * Identical inputs produce byte-identical output strings, in any call order, any number of times.
 */
export function computeFrame(
  t: number,
  pattern: FracturePattern,
  fxPartial?: DeepPartial<EffectParams>,
): FrameData {
  const tc = clamp01(t);
  const fx = normalizeEffectParams(fxPartial);
  const q = resolveQuality(fx.quality);
  const info = resolvePhase(tc, fx.timeline);

  // Whole-pattern passes shared by the style and motion layers (always agree by construction).
  const poses = pattern.shards.map((s) => shardPose(s.hash, fx));
  const kinds = assignOutliers(pattern, fx.outliers);
  const spectral = selectSpectral(pattern, poses, fx, q.spectrum);

  const shards = pattern.shards.map((s, i) =>
    buildShardFrame(tc, pattern, s, i, info, fx, q, poses[i], kinds[i], spectral[i]),
  );

  const cracks = crackLayer(pattern, info, fx, q);

  // --- micro debris ---
  const microCount = Math.min(pattern.micro.length, q.microShardCap);
  const micro: FrameData['micro'] = [];
  for (let i = 0; i < microCount; i++) {
    const m = pattern.micro[i];
    const visible = clamp01((info.crackProgress - m.birth) / 0.05);
    const mm = microMotion(pattern, m.origin, m.hash, m.ringIndex, fx);
    const tau = info.phase === 'shattering' ? Math.max(0, info.shatterTau - mm.birthDelay) : 0;
    const [fdx, fdy] = flightOffset(tau, mm.v0, fx.shatter.gravity, fx.shatter.drag);
    // Subtle deterministic twinkle while the glass holds.
    const twinklePhase = hashTo01(hashCombine(m.hash, 77)) * 6.283;
    const twinkle = 0.8 + 0.2 * Math.sin(tc * 21 + twinklePhase);
    let opacity = visible * fx.micro.opacity * twinkle;
    if (info.phase === 'shattering') {
      const [f0, f1] = fx.shatter.fadeOut;
      // Debris fades slightly earlier than the big shards.
      opacity *= 1 - clamp01((tc - (f0 - 0.04)) / Math.max(1e-6, f1 - f0));
    }
    micro.push({
      id: m.id,
      points: toSvgPoints(m.polygon),
      transform: `translate(${fmt(m.origin[0] + fdx)} ${fmt(m.origin[1] + fdy)}) rotate(${fmt(mm.omega * tau, 2)})`,
      opacity: Math.max(0, Math.min(1, opacity)),
      fill: hashTo01(hashCombine(m.hash, 5)) < 0.72 ? fx.micro.fill : fx.micro.fillAlt,
    });
  }

  return {
    t: tc,
    phase: info.phase,
    shards,
    cracks,
    micro,
    grain: q.grain ? { opacity: fx.optics.grainOpacity } : null,
  };
}

/**
 * Pick the 1-2 shards best aligned with the light source to carry the spectral flare,
 * and compute each band's placement along the light axis. Everything here is t-independent:
 * the selected set and the band geometry never change between frames.
 */
function selectSpectral(
  pattern: FracturePattern,
  poses: ReturnType<typeof shardPose>[],
  fx: EffectParams,
  enabled: boolean,
): Array<SpectralBand | null> {
  const out: Array<SpectralBand | null> = pattern.shards.map(() => null);
  if (!enabled || fx.spectrum.count <= 0 || fx.spectrum.opacity <= 0) return out;
  const lightRad = degToRad(fx.optics.lightAngleDeg);
  const dirX = Math.cos(lightRad);
  const dirY = Math.sin(lightRad);

  // Pane projection bounds onto the light axis.
  const w = pattern.width;
  const h = pattern.height;
  const corners: Vec2[] = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  let tMin = Infinity;
  let tMax = -Infinity;
  for (const c of corners) {
    const p = c[0] * dirX + c[1] * dirY;
    if (p < tMin) tMin = p;
    if (p > tMax) tMax = p;
  }
  const span = Math.max(1e-6, tMax - tMin);

  // Candidates: meaningful area only (excludes the crush disc and clipped slivers).
  const minArea = 0.02 * w * h;
  let candidates: number[] = [];
  for (let i = 0; i < pattern.shards.length; i++) {
    if (pattern.shards[i].area >= minArea) candidates.push(i);
  }
  if (candidates.length === 0) candidates = pattern.shards.map((_, i) => i);

  // edgeOnly weights the pick toward SMALL shards (dispersion reads on slivers, not slabs);
  // at 0 this is the verbatim alignment-only v0.3 ordering (byte anchor).
  const edgeOnly = clamp(fx.spectrum.edgeOnly, 0, 1);
  let maxArea = 1;
  if (edgeOnly > 0) {
    for (const i of candidates) maxArea = Math.max(maxArea, pattern.shards[i].area);
  }
  const score = (i: number): number => {
    const align = Math.cos(poses[i].tiltAxis - lightRad);
    return edgeOnly > 0 ? align + 1.2 * edgeOnly * (1 - pattern.shards[i].area / maxArea) : align;
  };
  candidates.sort((a, b) => score(b) - score(a) || a - b);

  const picked = candidates.slice(0, Math.min(fx.spectrum.count, candidates.length));
  for (const i of picked) {
    const s = pattern.shards[i];
    const rng = rngFor(s.hash, 'spectrum');
    const centroidT = (s.centroid[0] * dirX + s.centroid[1] * dirY - tMin) / span;
    // Shard extent along the light axis -> the band is sized to the shard, not the pane.
    let eMin = Infinity;
    let eMax = -Infinity;
    for (let p = 0; p + 1 < s.polygon.length; p += 2) {
      const pr = s.polygon[p] * dirX + s.polygon[p + 1] * dirY;
      if (pr < eMin) eMin = pr;
      if (pr > eMax) eMax = pr;
    }
    const extent01 = (eMax - eMin) / span;
    const baseCenter = clamp(centroidT + (rng() - 0.5) * 0.12, 0.05, 0.95);
    const baseWidth = clamp(extent01 * fx.spectrum.bandWidth, 0.02, 0.5);
    // edgeOnly slides the band onto the light-facing rim (max projection side) and
    // narrows it - the rainbow hugs the fractured face instead of washing the body.
    const rimCenter = clamp((eMax - tMin) / span - baseWidth * 0.3, 0.05, 0.95);
    out[i] = {
      center01: baseCenter + (rimCenter - baseCenter) * edgeOnly,
      width01: baseWidth * (1 - 0.55 * edgeOnly),
    };
  }
  return out;
}
