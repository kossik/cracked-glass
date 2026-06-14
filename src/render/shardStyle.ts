import type { EffectParams, FracturePattern, QualitySettings, Shard, ShardFrame, Vec2 } from '../types';
import type { PhaseInfo } from '../motion/timeline';
import { TAU, clamp, clamp01, degToRad, easeOutCubic, fmt } from '../core/math';
import { hashCombine, hashString, hashTo01, rngFor } from '../core/prng';
import { insetPolygonTowardCentroid, ringPathD, toCssPolygon } from '../core/geometry';
import { flightOffset, flightSpeed, shardMotion, type OutlierKind } from '../motion/kinematics';
import { floatOffset, settleOffset } from '../motion/settle';

const BEVEL_SECTORS = 12;

interface StaticEntry {
  clip: string[];
  innerClip: string[];
  origin: string[];
  /**
   * Per shard, per non-empty normal-angle sector: the combined d (v0.3 anchor path) plus
   * a static specular/shaded split of the same edges (conchoidal light scatter). The split
   * threshold is an fx-INDEPENDENT constant - this cache is keyed by pattern only, so an
   * fx-driven split would silently serve stale sub-paths.
   */
  bevel: Array<Array<{ dFull: string; dSpec: string; dShaded: string; angle: number }>>;
}

/**
 * Static per-pattern strings (clip polygons, transform origins, bevel sector paths).
 * Pure memoization: identical pattern -> identical strings; the cache never changes output.
 */
const staticCache = new WeakMap<FracturePattern, StaticEntry>();

export function staticShardStrings(pattern: FracturePattern): StaticEntry {
  let entry = staticCache.get(pattern);
  if (!entry) {
    entry = {
      clip: pattern.shards.map((s) => toCssPolygon(s.outsetPolygon)),
      innerClip: pattern.shards.map((s) => toCssPolygon(s.polygon)),
      origin: pattern.shards.map((s) => `${fmt(s.centroid[0])}px ${fmt(s.centroid[1])}px`),
      bevel: pattern.shards.map((s) => bevelSectors(s, pattern.width, pattern.height)),
    };
    staticCache.set(pattern, entry);
  }
  return entry;
}

/**
 * Group shard polygon edges into BEVEL_SECTORS static sectors by outward-normal angle.
 * Sector membership is a pure function of the pattern, so the d strings never change with t -
 * only each sector's opacity does (no popping, and tumbling shards glint as sectors sweep
 * past the light). Container-border edges are excluded: they are pane edges, not fracture faces.
 */
const BEVEL_SCATTER_KEY = hashString('bevelScatter');
/** Fraction of edges classified "specular" (catching light regardless of orientation). */
const BEVEL_SPEC_FRACTION = 0.3;

function bevelSectors(
  shard: Shard,
  w: number,
  h: number,
): Array<{ dFull: string; dSpec: string; dShaded: string; angle: number }> {
  const poly = shard.polygon;
  const n = poly.length / 2;
  const full = new Array<string>(BEVEL_SECTORS).fill('');
  const spec = new Array<string>(BEVEL_SECTORS).fill('');
  const shaded = new Array<string>(BEVEL_SECTORS).fill('');
  const eps = 0.75;
  const onSameBorder = (x1: number, y1: number, x2: number, y2: number): boolean =>
    (x1 < eps && x2 < eps) ||
    (x1 > w - eps && x2 > w - eps) ||
    (y1 < eps && y2 < eps) ||
    (y1 > h - eps && y2 > h - eps);
  for (let i = 0; i < n; i++) {
    const x1 = poly[i * 2];
    const y1 = poly[i * 2 + 1];
    const j = (i + 1) % n;
    const x2 = poly[j * 2];
    const y2 = poly[j * 2 + 1];
    if (onSameBorder(x1, y1, x2, y2)) continue;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) continue;
    // outward normal for positively-wound (screen coords) polygons: (dy, -dx)/len
    let ang = Math.atan2(-dx, dy);
    if (ang < 0) ang += TAU;
    const sector = Math.min(BEVEL_SECTORS - 1, Math.floor((ang / TAU) * BEVEL_SECTORS));
    const seg = `M${fmt(x1)} ${fmt(y1)}L${fmt(x2)} ${fmt(y2)}`;
    full[sector] += seg;
    if (hashTo01(hashCombine(shard.hash, BEVEL_SCATTER_KEY, i)) < BEVEL_SPEC_FRACTION) {
      spec[sector] += seg;
    } else {
      shaded[sector] += seg;
    }
  }
  const out: Array<{ dFull: string; dSpec: string; dShaded: string; angle: number }> = [];
  for (let s = 0; s < BEVEL_SECTORS; s++) {
    if (full[s]) {
      out.push({ dFull: full[s], dSpec: spec[s], dShaded: shaded[s], angle: ((s + 0.5) / BEVEL_SECTORS) * TAU });
    }
  }
  return out;
}

/** Per-shard pose constants. The rng draw order is frozen - changing it changes every visual. */
export interface ShardPose {
  refrAngle: number;
  refrMag: number;
  rotZ: number;
  scaleDev: number;
  tiltAxis: number;
  tiltMag: number;
  facetAngle: number;
  facetMag: number;
  contrastSign: number;
  chromaMagF: number;
}

export function shardPose(hash: number, fx: EffectParams): ShardPose {
  const rng = rngFor(hash, 'pose');
  return {
    refrAngle: rng() * TAU,
    refrMag: fx.refraction.offsetPx * (0.4 + 0.6 * rng()),
    rotZ: fx.refraction.rotateDeg * (rng() * 2 - 1),
    scaleDev: fx.refraction.scaleAmp * (rng() * 2 - 1),
    tiltAxis: rng() * TAU,
    tiltMag: fx.refraction.tiltDeg * (0.35 + 0.65 * rng()),
    facetAngle: rng() * 360,
    facetMag: 0.6 + 0.4 * rng(),
    contrastSign: rng() < 0.5 ? -1 : 1,
    chromaMagF: 0.55 + 0.45 * rng(),
  };
}

/** Band placement (precomputed in computeFrame) for shards selected to carry the spectral flare. */
export interface SpectralBand {
  center01: number;
  width01: number;
}

function rotate2D(x: number, y: number, rad: number): Vec2 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [x * c - y * s, x * s + y * c];
}

function gravityDir(g: Vec2): Vec2 {
  const l = Math.hypot(g[0], g[1]);
  return l > 1e-6 ? [g[0] / l, g[1] / l] : [0, 1];
}

/** Build the full per-shard frame. Pure function of (t via info, pattern, fx, q, pose, kind). */
export function buildShardFrame(
  t: number,
  pattern: FracturePattern,
  shard: Shard,
  shardIndex: number,
  info: PhaseInfo,
  fx: EffectParams,
  q: QualitySettings,
  pose: ShardPose,
  kind: OutlierKind,
  spectral: SpectralBand | null,
): ShardFrame {
  const statics = staticShardStrings(pattern);
  const ease = easeOutCubic(info.crackProgress);
  const lightRad = degToRad(fx.optics.lightAngleDeg);

  // --- shatter rigid flight (computed early: speed feeds the content filter and smear) ---
  const motion = shardMotion(pattern, shard, fx, kind);
  const tau = Math.max(0, info.shatterTau - motion.birthDelay);
  const flying = info.phase === 'shattering' && tau > 0;
  const [fdx, fdy] = flightOffset(tau, motion.v0, fx.shatter.gravity, fx.shatter.drag);
  const spin = motion.omega * tau;
  const tumX = clamp(motion.tumbleX * tau, -78, 78);
  const tumY = clamp(motion.tumbleY * tau, -78, 78);
  const speed = flying ? flightSpeed(tau, motion.v0, fx.shatter.gravity, fx.shatter.drag) : 0;
  const speedStrength = clamp01((speed - fx.motionBlur.speedThreshold) / (fx.motionBlur.speedThreshold * 2));

  const st =
    info.phase === 'cracked'
      ? settleOffset(t, shard.hash, fx.settle.amplitudePx, fx.settle.frequency, 0)
      : { dx: 0, dy: 0, rot: 0 };

  // --- fade out late in the shatter ---
  let opacity = 1;
  if (info.phase === 'shattering') {
    const [f0, f1] = fx.shatter.fadeOut;
    opacity = 1 - clamp01((t - f0) / Math.max(1e-6, f1 - f0));
  }

  // --- punched impact plug & dropped outliers (pure functions of crackProgress) ---
  const isCrush = pattern.mode === 'radial' && shard.ringIndex === 0;
  const punch = isCrush && fx.crush.punch ? easeOutCubic(clamp01((info.crackProgress - 0.1) * 2.2)) : 0;
  let dropEase = 0;
  if (kind === 'dropped') {
    const dropStart = 0.45 + 0.3 * hashTo01(hashCombine(shard.hash, hashString('outlier:dropT')));
    dropEase = easeOutCubic(clamp01((info.crackProgress - dropStart) / 0.25));
  }
  const vanish = Math.max(punch, dropEase);
  opacity *= 1 - vanish;

  const gdir = gravityDir(fx.shatter.gravity);
  const sinkPx = clamp(0.12 * Math.sqrt(shard.area / Math.PI), 1.5, 5) * vanish;
  const rigidScale = (1 - (1 - fx.crush.scaleTo) * punch) * (1 - 0.05 * dropEase);

  // --- slipped outliers: the piece itself slid out of alignment (rigid, not refraction) ---
  let slipDx = 0;
  let slipDy = 0;
  let slipRot = 0;
  if (kind === 'slipped') {
    const slipMagF = hashTo01(hashCombine(shard.hash, hashString('outlier:slipMag')));
    const slipSign = hashTo01(hashCombine(shard.hash, hashString('outlier:slipRot'))) < 0.5 ? -1 : 1;
    const slipJit = hashTo01(hashCombine(shard.hash, hashString('outlier:slipDir')));
    let dir: Vec2;
    if (pattern.mode === 'radial') {
      // a piece sliding OUTWARD from the impact reads as fracture; downward would look wrong
      const dx = shard.centroid[0] - pattern.impact[0];
      const dy = shard.centroid[1] - pattern.impact[1];
      const l = Math.hypot(dx, dy) || 1;
      dir = [dx / l, dy / l];
    } else {
      dir = gdir;
    }
    const rotated = rotate2D(dir[0], dir[1], (slipJit - 0.5) * 0.9);
    const mag = fx.outliers.slipPx * (0.6 + 0.8 * slipMagF) * ease;
    slipDx = rotated[0] * mag;
    slipDy = rotated[1] * mag;
    slipRot = slipSign * fx.outliers.slipRotDeg * (0.5 + slipMagF) * ease;
  }

  // --- hero levitation (mode 'hero' only - other modes keep their byte-exact output) ---
  const fl =
    pattern.mode === 'hero' ? floatOffset(t, shard.hash, fx.float) : { dx: 0, dy: 0, rot: 0 };

  // --- rigid totals (mirrored into raw.rigid so both tiers stay in lockstep) ---
  const rigidDx = fdx + st.dx + slipDx + fl.dx + gdir[0] * sinkPx;
  const rigidDy = fdy + st.dy + slipDy + fl.dy + gdir[1] * sinkPx;
  const rigidRot = spin + st.rot + slipRot + fl.rot;

  // --- glass medium: the shard is a moving LENS over content anchored to the pane ---
  // The content clone gets the inverse rigid transform so the background stays put while
  // the silhouette flies. Constraints established by adversarial review:
  // - rigid 3D tumble is omitted (a clipped wrapper flattens transforms; no child can
  //   compensate perspective, and the residual error grows with flight distance);
  // - the wrapper is emitted from PRE-ROUNDED components and the inverse from the exact
  //   negatives of those - the pair cancels to the browser's own precision;
  // - the scale is clamped symmetrically (wrapper AND inverse) so 1/s stays bounded;
  // - refraction is re-anchored about the FLOWN centroid (the trailing translate(-d)),
  //   so lens distortion does not grow with flight distance.
  const glass = fx.medium === 'glass';
  const glassInv = glass
    ? {
        dx: Number(fmt(rigidDx)),
        dy: Number(fmt(rigidDy)),
        rot: Number(fmt(rigidRot, 3)),
        scale: Number(fmt(Math.max(rigidScale, 0.05), 4)),
      }
    : null;
  /** Wraps a refraction core list into inv(T_rigid) * core * translate(-flight). */
  const glassWrap = (core: string): string =>
    glassInv
      ? `scale(${fmt(1 / glassInv.scale, 6)}) rotate(${fmt(-glassInv.rot, 3)}deg) ${core} translate(${fmt(-glassInv.dx)}px, ${fmt(-glassInv.dy)}px)`
      : core;

  let shardTransform: string;
  if (glassInv) {
    shardTransform = `translate(${fmt(glassInv.dx)}px, ${fmt(glassInv.dy)}px) rotate(${fmt(glassInv.rot, 3)}deg) scale(${fmt(glassInv.scale, 4)})`;
  } else {
    shardTransform = `translate(${fmt(rigidDx)}px, ${fmt(rigidDy)}px)`;
    if (fx.shatter.tumbleDegMax > 0 && flying) {
      shardTransform += ` perspective(${fmt(fx.refraction.perspectivePx)}px) rotateX(${fmt(tumX, 3)}deg) rotateY(${fmt(tumY, 3)}deg)`;
    }
    shardTransform += ` rotate(${fmt(rigidRot, 3)}deg) scale(${fmt(rigidScale, 4)})`;
  }

  // --- refraction (content inside the stationary shape) ---
  const refDx = Math.cos(pose.refrAngle) * pose.refrMag * ease;
  const refDy = Math.sin(pose.refrAngle) * pose.refrMag * ease;
  const refRot = pose.rotZ * ease;
  const refScale = 1 + pose.scaleDev * ease;
  const tiltX = Math.sin(pose.tiltAxis) * pose.tiltMag * ease;
  const tiltY = Math.cos(pose.tiltAxis) * pose.tiltMag * ease;

  let refrCore = `translate(${fmt(refDx)}px, ${fmt(refDy)}px)`;
  if (fx.refraction.tiltDeg > 0) {
    refrCore += ` perspective(${fmt(fx.refraction.perspectivePx)}px) rotateX(${fmt(tiltX, 3)}deg) rotateY(${fmt(tiltY, 3)}deg)`;
  }
  refrCore += ` rotate(${fmt(refRot, 3)}deg) scale(${fmt(refScale, 4)})`;
  const contentTransform = glassWrap(refrCore);

  // --- facet lighting -> brightness/contrast ---
  // trackLight: the facet plane turns with the shard, so its alignment with the global
  // light changes as the shard spins. false takes the verbatim v0.4 expression (anchor).
  const live = fx.optics.trackLight;
  const lightDot = live
    ? Math.cos(pose.tiltAxis + degToRad(rigidRot) - lightRad) *
      (0.35 + 0.65 * (pose.tiltMag / Math.max(0.001, fx.refraction.tiltDeg || 1)))
    : Math.cos(pose.tiltAxis - lightRad) *
      (0.35 + 0.65 * (pose.tiltMag / Math.max(0.001, fx.refraction.tiltDeg || 1)));
  const brightness = 1 + fx.optics.brightnessAmp * lightDot * ease;
  const contrast = 1 + fx.optics.contrastAmp * pose.contrastSign * ease;
  // Content blur: optics blur + speed-scaled motion blur addition (the clip stays crisp).
  const smearBlurAdd = flying ? fx.motionBlur.smearBlurPx * speedStrength : 0;
  const blurPx = clamp(clamp(fx.optics.blurPx, 0, q.maxBlurPx) * ease + smearBlurAdd, 0, q.maxBlurPx);

  // --- chromatic aberration ---
  // trackLight: counter-rotate the dispersion axis by the shard spin. The filter layers
  // live in wrapper-local space in BOTH tiers (HTML hoists the filter onto a no-transform
  // div in glass mode), so one corrected pair serves drop-shadows, ghosts and feOffset.
  const chromaScale = (ease + (flying ? Math.min(1, tau * 2.2) : 0)) * pose.chromaMagF;
  let chDx: number;
  let chDy: number;
  if (live) {
    const chRadLive = degToRad(fx.chroma.angleDeg - rigidRot);
    chDx = Math.cos(chRadLive) * fx.chroma.offsetPx * chromaScale;
    chDy = Math.sin(chRadLive) * fx.chroma.offsetPx * chromaScale;
  } else {
    const chRad = degToRad(fx.chroma.angleDeg);
    chDx = Math.cos(chRad) * fx.chroma.offsetPx * chromaScale;
    chDy = Math.sin(chRad) * fx.chroma.offsetPx * chromaScale;
  }

  let contentFilter = `brightness(${fmt(brightness, 3)}) contrast(${fmt(contrast, 3)})`;
  const smearFilter = contentFilter;
  if (blurPx > 0.02) contentFilter += ` blur(${fmt(blurPx, 2)}px)`;
  if (fx.chroma.mode === 'shadow' && fx.chroma.offsetPx > 0) {
    contentFilter +=
      ` drop-shadow(${fmt(chDx)}px ${fmt(chDy)}px 0 ${fx.chroma.colorA})` +
      ` drop-shadow(${fmt(-chDx)}px ${fmt(-chDy)}px 0 ${fx.chroma.colorB})`;
  }

  const chroma: ShardFrame['chroma'] = [];
  if (fx.chroma.mode === 'ghost' && q.chromaGhosts > 0 && fx.chroma.offsetPx > 0) {
    // Glass: the inverse prefix anchors the ghost to the pane, so its translate lands in
    // SCREEN space verbatim - build the screen-target axis directly (lens-attached when
    // not tracking the light, light-fixed when tracking). chDx/chDy are wrapper-local
    // values and would counter-spin on screen if embedded as-is.
    let gChDx = chDx;
    let gChDy = chDy;
    if (glass) {
      const gRad = degToRad(live ? fx.chroma.angleDeg : fx.chroma.angleDeg + rigidRot);
      gChDx = Math.cos(gRad) * fx.chroma.offsetPx * chromaScale;
      gChDy = Math.sin(gRad) * fx.chroma.offsetPx * chromaScale;
    }
    const signs = q.chromaGhosts === 1 ? [1] : [1, -1];
    for (const sign of signs) {
      chroma.push({
        transform: glassWrap(
          `translate(${fmt(refDx + sign * gChDx)}px, ${fmt(refDy + sign * gChDy)}px) rotate(${fmt(refRot, 3)}deg) scale(${fmt(refScale, 4)})`,
        ),
        filter: `hue-rotate(${sign > 0 ? 115 : -115}deg) saturate(1.7)`,
        mixBlendMode: fx.chroma.blendMode,
        opacity: fx.chroma.opacity * ease * opacity,
      });
    }
  }

  // --- facet glass layer (highlights deliberately lighter than the dark side) ---
  // trackLight: the facet layer rides the rotating wrapper, so counter-rotate its
  // gradient to keep the highlight pointing at the global light.
  const facetAngleOut = live ? pose.facetAngle - rigidRot : pose.facetAngle;
  const facetWhite = fx.facet.strength * 0.65 * pose.facetMag;
  const facetBlack = fx.facet.strength * 0.5 * pose.facetMag;
  let facet: ShardFrame['facet'] = null;
  if (fx.facet.opacity > 0 && fx.facet.strength > 0) {
    let background = `linear-gradient(${fmt(facetAngleOut, 1)}deg, rgba(255,255,255,${fmt(facetWhite, 3)}) 0%, rgba(255,255,255,0) 38%, rgba(0,0,0,0) 62%, rgba(0,0,0,${fmt(facetBlack, 3)}) 100%)`;
    if (fx.facet.tint) background += `, linear-gradient(0deg, ${fx.facet.tint}, ${fx.facet.tint})`;
    facet = {
      background,
      mixBlendMode: fx.facet.blendMode,
      opacity: fx.facet.opacity * ease * opacity,
    };
  }

  // --- perimeter ring geometry (shared by the edge-refraction layer and edge spectrum) ---
  // The ring path = outer outline + REVERSED inner inset loop: the default nonzero fill
  // rule punches the hole, so it works as a CSS path() clip and an SVG clipPath alike.
  const wantEdge = q.edgeDistortion && fx.edgeDistortion.strength > 0 && fx.edgeDistortion.widthPx > 0.5;
  const wantSpectrumRing = spectral !== null && fx.spectrum.edgeOnly > 0;
  let ringD = '';
  let ringClipCss = '';
  if (wantEdge || wantSpectrumRing) {
    const inner = insetPolygonTowardCentroid(shard.polygon, shard.centroid, fx.edgeDistortion.widthPx);
    ringD = ringPathD(shard.polygon, inner);
    ringClipCss = `path("${ringD}")`;
  }

  // --- edge refraction ring: the fractured faces act as prisms on the content behind ---
  let edge: ShardFrame['edge'] = null;
  if (wantEdge) {
    const k = 1 + 1.6 * fx.edgeDistortion.strength;
    const eDx = refDx * k;
    const eDy = refDy * k;
    const eRot = refRot * (1 + 0.6 * fx.edgeDistortion.strength);
    const eScale = refScale * (1 + 0.045 * fx.edgeDistortion.strength * ease);
    let edgeCore = `translate(${fmt(eDx)}px, ${fmt(eDy)}px)`;
    if (fx.refraction.tiltDeg > 0) {
      edgeCore += ` perspective(${fmt(fx.refraction.perspectivePx)}px) rotateX(${fmt(tiltX, 3)}deg) rotateY(${fmt(tiltY, 3)}deg)`;
    }
    edgeCore += ` rotate(${fmt(eRot, 3)}deg) scale(${fmt(eScale, 4)})`;
    const eBlur = clamp(fx.edgeDistortion.blurPx, 0, q.maxBlurPx);
    let edgeFilter = contentFilter;
    if (eBlur > 0.02) edgeFilter += ` blur(${fmt(eBlur, 2)}px)`;
    edge = {
      clipPath: ringClipCss,
      d: ringD,
      transform: glassWrap(edgeCore),
      filter: edgeFilter,
      opacity: ease, // ramps in with the crack network; the wrapper already carries shard opacity
      dx: eDx,
      dy: eDy,
      rot: eRot,
      scale: eScale,
    };
  }

  // --- spectral dispersion flare (selection precomputed in computeFrame, light-aligned) ---
  let spectrum: ShardFrame['spectrum'] = null;
  if (spectral) {
    // trackLight: both tiers paint the flare inside the rotating wrapper, so the same
    // -rigidRot correction keeps it on the light axis (SVG recomputes endpoints from
    // the corrected angleDeg per frame - parity holds with no tier-specific terms).
    const specAngle = live ? fx.optics.lightAngleDeg - rigidRot : fx.optics.lightAngleDeg;
    const cssAngle = live ? specAngle + 90 : fx.optics.lightAngleDeg + 90; // CSS 0deg = up; our 0deg = +x
    const c = spectral.center01 * 100;
    const hw = (spectral.width01 * 100) / 2;
    const stops =
      `rgba(255,70,70,0) ${fmt(c - hw, 2)}%, rgba(255,70,70,0.85) ${fmt(c - hw * 0.6, 2)}%, ` +
      `rgba(255,210,70,0.85) ${fmt(c - hw * 0.25, 2)}%, rgba(110,255,150,0.85) ${fmt(c, 2)}%, ` +
      `rgba(80,200,255,0.85) ${fmt(c + hw * 0.35, 2)}%, rgba(170,100,255,0.85) ${fmt(c + hw * 0.65, 2)}%, ` +
      `rgba(170,100,255,0) ${fmt(c + hw, 2)}%`;
    // Full flare at rest; deterministic dimming/glinting while the shard turns.
    const glint = Math.max(0, Math.cos(degToRad(rigidRot)));
    spectrum = {
      background: `linear-gradient(${fmt(cssAngle, 1)}deg, ${stops})`,
      mixBlendMode: fx.spectrum.blendMode,
      opacity: fx.spectrum.opacity * ease * opacity * glint,
      angleDeg: specAngle,
      center01: spectral.center01,
      width01: spectral.width01,
    };
    if (wantSpectrumRing) {
      // Dispersion happens at the fractured faces: hug the rim instead of washing the body.
      spectrum.clipPath = ringClipCss;
      spectrum.d = ringD;
    }
  }

  // --- edge bevel: static sectors with a static specular/shaded edge split. With
  //     scatter > 0 a SINGLE fracture edge shows interleaved highlight and shadow
  //     segments (conchoidal micro-facets) and the global light only biases the mix;
  //     scatter === 0 executes the v0.3 single-light law verbatim (byte anchor).
  //     Structure is t-constant: entry existence depends on (pattern, fx) only. ---
  const bevel: ShardFrame['bevel'] = [];
  if (q.bevel && fx.bevel.intensity > 0) {
    const spinRad = degToRad(rigidRot);
    const glintBoost = flying ? 1 + fx.bevel.glintStrength * Math.min(1, tau * 3) : 1;
    const sigma = clamp01(fx.bevel.scatter);
    for (const sec of statics.bevel[shardIndex]) {
      const L = Math.cos(sec.angle + spinRad - lightRad);
      if (sigma <= 0) {
        const lit = L > 0;
        const mag = Math.min(1, Math.pow(Math.abs(L), 1.2) * fx.bevel.intensity * ease * opacity * glintBoost);
        bevel.push({ d: sec.dFull, stroke: fx.bevel.lightColor, mixBlendMode: fx.bevel.blendMode, opacity: lit ? mag : 0 });
        bevel.push({ d: sec.dFull, stroke: fx.bevel.darkColor, mixBlendMode: 'normal', opacity: lit ? 0 : Math.min(1, mag * 0.5) });
        continue;
      }
      // glintBoost rides only the orientation-proportional terms so tumble glints stay
      // directional; the scatter floors do not flash uniformly.
      const base = fx.bevel.intensity * ease * opacity;
      const gP = Math.pow(Math.max(0, L), 1.2) * glintBoost;
      const gM = Math.pow(Math.max(0, -L), 1.2) * glintBoost;
      const att = 1 - sigma;
      // dark BEFORE lit within each pair: at scatter > 0 both are visible on the same
      // pixels and the two tiers must composite in the same order.
      if (sec.dSpec) {
        const litOp = Math.min(1, base * (gP + sigma * (0.35 + 0.65 * gP - gP)));
        const darkOp = Math.min(1, 0.5 * base * att * att * gM);
        bevel.push({ d: sec.dSpec, stroke: fx.bevel.darkColor, mixBlendMode: 'normal', opacity: darkOp });
        bevel.push({ d: sec.dSpec, stroke: fx.bevel.lightColor, mixBlendMode: fx.bevel.blendMode, opacity: litOp });
      }
      if (sec.dShaded) {
        const cross = 1 - 0.88 * sigma; // lerp(1, 0.12, sigma)
        const litOp = Math.min(1, base * gP * cross * cross);
        const darkOp = Math.min(1, 0.5 * base * (gM + sigma * (0.75 + 0.25 * gM - gM)));
        bevel.push({ d: sec.dShaded, stroke: fx.bevel.darkColor, mixBlendMode: 'normal', opacity: darkOp });
        bevel.push({ d: sec.dShaded, stroke: fx.bevel.lightColor, mixBlendMode: fx.bevel.blendMode, opacity: litOp });
      }
    }
  }

  // --- content smear: motion blur of the content while the shard edge stays crisp ---
  // ALWAYS exactly q.smearGhosts entries (opacity 0 when idle) - constant DOM structure.
  // Glass medium: the content does NOT move with the lens, so a positional trail would
  // re-introduce exactly the motion anchoring removes - entries stay at opacity 0 and
  // motion reads through the speed-scaled blur already in contentFilter.
  const smear: ShardFrame['smear'] = [];
  if (q.smearGhosts > 0) {
    const active = !glass && flying && speedStrength > 0;
    let deltas: Vec2[] = [];
    if (active) {
      const raw: Vec2[] = [];
      for (let k = 1; k <= q.smearGhosts; k++) {
        const tk = Math.max(0, tau - k * fx.motionBlur.dt);
        const [gx, gy] = flightOffset(tk, motion.v0, fx.shatter.gravity, fx.shatter.drag);
        raw.push([gx - fdx, gy - fdy]); // behind the current position
      }
      const last = raw[raw.length - 1];
      const lastLen = Math.hypot(last[0], last[1]);
      const capScale = lastLen > 1e-6 ? Math.min(1, fx.motionBlur.smearPx / lastLen) : 0;
      // The copies live inside the rotated wrapper: express the screen-space delta locally.
      deltas = raw.map(([x, y]) => rotate2D(x * capScale, y * capScale, -degToRad(rigidRot)));
    }
    for (let k = 0; k < q.smearGhosts; k++) {
      const d = deltas[k];
      const op = active && d ? opacity * speedStrength * Math.pow(fx.motionBlur.opacityFalloff, k + 1) : 0;
      smear.push({
        transform: d ? `translate(${fmt(d[0])}px, ${fmt(d[1])}px) ${contentTransform}` : contentTransform,
        dx: d ? d[0] : 0,
        dy: d ? d[1] : 0,
        opacity: op,
      });
    }
  }

  // --- whole-shard motion ghosts (off by default since v0.2; kept as an explicit opt-in) ---
  // Disabled in glass medium: a ghost would show the content at a stale pose, which
  // anchoring makes meaningless (the lens trail idea fails the same way as smear).
  const ghosts: ShardFrame['ghosts'] = [];
  const ghostCount = glass ? 0 : Math.min(q.motionGhosts, fx.motionBlur.ghosts ?? q.motionGhosts);
  if (flying && ghostCount > 0 && speedStrength > 0) {
    for (let k = 1; k <= ghostCount; k++) {
      const tk = tau - k * fx.motionBlur.dt;
      if (tk <= 0) break;
      const [gx, gy] = flightOffset(tk, motion.v0, fx.shatter.gravity, fx.shatter.drag);
      let gt = `translate(${fmt(gx + st.dx)}px, ${fmt(gy + st.dy)}px)`;
      if (fx.shatter.tumbleDegMax > 0) {
        gt += ` perspective(${fmt(fx.refraction.perspectivePx)}px) rotateX(${fmt(clamp(motion.tumbleX * tk, -78, 78), 3)}deg) rotateY(${fmt(clamp(motion.tumbleY * tk, -78, 78), 3)}deg)`;
      }
      gt += ` rotate(${fmt(motion.omega * tk, 3)}deg)`;
      ghosts.push({
        shardTransform: gt,
        opacity: opacity * speedStrength * Math.pow(fx.motionBlur.opacityFalloff, k),
      });
    }
  }

  return {
    id: shard.id,
    clipPath: statics.clip[shardIndex],
    innerClipPath: statics.innerClip[shardIndex],
    transformOrigin: statics.origin[shardIndex],
    shardTransform,
    contentTransform,
    contentFilter,
    opacity,
    zIndex: (shard.z + 1) * 10,
    facet,
    spectrum,
    edge,
    chroma,
    ghosts,
    smear,
    smearFilter,
    bevel,
    raw: {
      // glass: tumble is hard-disabled and the scale is clamped (matches raw.glass and the
      // emitted strings, so a consumer composing from raw.rigid stays in lockstep)
      rigid: {
        dx: rigidDx,
        dy: rigidDy,
        rotZ: rigidRot,
        rotX: glass ? 0 : tumX,
        rotY: glass ? 0 : tumY,
        scale: glassInv ? glassInv.scale : rigidScale,
      },
      refraction: { dx: refDx, dy: refDy, rot: refRot, scale: refScale, tiltX, tiltY },
      glass: glassInv,
      brightness,
      contrast,
      blurPx,
      chromaDx: chDx,
      chromaDy: chDy,
      facetAngleDeg: facetAngleOut,
      facetWhite,
      facetBlack,
    },
  };
}
