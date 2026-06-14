import type { EffectParams, FracturePattern, FrameData, QualitySettings, Vec2 } from '../types';
import type { PhaseInfo } from '../motion/timeline';
import { clamp, clamp01, degToRad, easeOutCubic, easeOutQuart, fmt } from '../core/math';
import { hashCombine, hashString, hashTo01, rand01, rngFor } from '../core/prng';
import { unflattenPts } from '../core/geometry';
import { fbm1D } from '../core/noise';

/**
 * Crack-line layer. Cracks are VARIABLE-WIDTH FILLED RIBBONS with per-stretch BRIGHTNESS
 * MODULATION (real cracks are blinding-bright in some stretches and nearly invisible in
 * others): a full-length dim underlay plus a bright-ranges overlay built from the SAME
 * geometry (zero-width stretches collapse the ribbon - no seams). Dead-end hairline stubs
 * render as thin tapered ribbons of their own. All recomputed per frame from t.
 */
export function crackLayer(
  pattern: FracturePattern,
  info: PhaseInfo,
  fx: EffectParams,
  q: QualitySettings,
): FrameData['cracks'] {
  const style = fx.crackStyle;
  const shAng = degToRad(fx.optics.lightAngleDeg + 180);
  const sox = Math.cos(shAng) * style.shadowOffsetPx;
  const soy = Math.sin(shAng) * style.shadowOffsetPx;
  const shadowRatio = style.shadowWidth / Math.max(0.001, style.coreWidth);
  const bv = clamp01(style.brightnessVar);

  let core = '';
  let coreDim = '';
  let stubD = '';
  let shadow = '';
  let highlight = '';
  let hackle = '';
  let stubOrdinal = -1;

  for (let ci = 0; ci < pattern.cracks.length; ci++) {
    const crack = pattern.cracks[ci];

    if (crack.kind === 'stub') {
      // Dead-end hairlines: thin tapered ribbons; gated by a stable hash subset
      // (monotone under subCracks) and a stable prefix cap - no popping across t.
      stubOrdinal++;
      if (stubOrdinal >= q.stubCap || style.subCracks <= 0) continue;
      if (hashTo01(hashCombine(pattern.seed, hashString('stub:pick'), stubOrdinal)) >= style.subCracks) continue;
      const local = clamp01((info.crackProgress - crack.birth) / Math.max(1e-6, crack.growDuration));
      if (local <= 0) continue;
      const vis = easeOutQuart(local) * crack.totalLen;
      const part = partialPolylineWithS(unflattenPts(crack.points), crack.cumLen, vis);
      if (part.pts.length < 2) continue;
      const frame = miterFrame(part.pts);
      const wSeed = hashCombine(pattern.seed, hashString('stubribbon'), stubOrdinal);
      const halfs: number[] = [];
      for (let i = 0; i < part.pts.length; i++) {
        const profile = clamp(1 + style.widthVariance * 1.25 * fbm1D(wSeed, part.s[i] * 0.06), 0.35, 2.2);
        const taper = Math.min(1, (vis - part.s[i]) / 9);
        const base = 0.5 * style.coreWidth * 0.4 * profile * Math.max(0, taper);
        halfs.push(Math.min(base, frame.maxHalf[i]));
      }
      stubD += ribbonPath(part.pts, frame, halfs, 0, 0);
      continue;
    }

    const local = clamp01((info.crackProgress - crack.birth) / Math.max(1e-6, crack.growDuration));
    if (local <= 0) continue;
    const vis = easeOutQuart(local) * crack.totalLen;
    const all = unflattenPts(crack.points);
    const part = partialPolylineWithS(all, crack.cumLen, vis);
    if (part.pts.length < 2) continue;

    // Brightness ranges, static in ABSOLUTE arc length (they never crawl as the crack grows).
    // Draw order is part of the contract: count first, then boundary stations, then sort.
    // Parity: [0, b1) is bright; the first 15px stay bright so crack starts always read.
    let brightAt: ((s: number) => number) | null = null;
    if (bv > 0) {
      const rngD = rngFor(pattern.seed, 'coreDim', ci);
      const kB = 2 + Math.floor(3 * rngD());
      const bounds: number[] = [];
      for (let b = 0; b < kB; b++) bounds.push(rngD() * crack.totalLen);
      bounds.sort((a, b) => a - b);
      brightAt = (s: number): number => {
        if (s < 15) return 1;
        let idx = 0;
        while (idx < bounds.length && bounds[idx] <= s) idx++;
        const inBright = idx % 2 === 0;
        const dPrev = idx > 0 ? s - bounds[idx - 1] : Infinity;
        const dNext = idx < bounds.length ? bounds[idx] - s : Infinity;
        const d = Math.min(dPrev, dNext);
        if (d >= 3) return inBright ? 1 : 0;
        const f = 0.5 + (d / 3) * 0.5;
        return inBright ? f : 1 - f;
      };
      // Static feather stations: per-point sampling alone would quantize the 3px ramp to
      // the polyline spacing and lose short dim ranges entirely.
      const stations: number[] = [];
      for (const b of bounds) stations.push(b - 3, b, b + 3);
      insertStations(part, stations.sort((a, b) => a - b), vis);
    }

    const frame = miterFrame(part.pts);
    const wSeed = hashCombine(pattern.seed, hashString('ribbon'), ci);
    const halfCore: number[] = [];
    const halfDim: number[] = [];
    const halfShadow: number[] = [];
    for (let i = 0; i < part.pts.length; i++) {
      const profile = clamp(1 + style.widthVariance * 1.25 * fbm1D(wSeed, part.s[i] * 0.06), 0.35, 2.2);
      const taper = Math.min(1, (vis - part.s[i]) / 9);
      const base = 0.5 * style.coreWidth * profile * Math.max(0, taper);
      // bright factor multiplies BEFORE the maxHalf clamp; the bv===0 path is the literal
      // v0.3 expression (factor 1 is exact in IEEE)
      const bright = brightAt ? brightAt(part.s[i]) : 1;
      halfCore.push(Math.min(base * bright, frame.maxHalf[i]));
      if (brightAt) halfDim.push(Math.min(base, frame.maxHalf[i]));
      halfShadow.push(Math.min(base * shadowRatio, frame.maxHalf[i] * 1.6));
    }
    core += ribbonPath(part.pts, frame, halfCore, 0, 0);
    if (brightAt) coreDim += ribbonPath(part.pts, frame, halfDim, 0, 0);
    shadow += ribbonPath(part.pts, frame, halfShadow, sox, soy);

    // Double-edge filaments: the second fracture face running parallel for a stretch.
    if (style.doubleEdge > 0) {
      const nF = rand01(pattern.seed, 'fil', ci) < style.doubleEdge ? (rand01(pattern.seed, 'fil2', ci) < 0.4 ? 2 : 1) : 0;
      for (let k = 0; k < nF; k++) {
        const r1 = rand01(pattern.seed, 'filA', ci, k);
        const r2 = rand01(pattern.seed, 'filB', ci, k);
        const r3 = rand01(pattern.seed, 'filC', ci, k);
        const r4 = rand01(pattern.seed, 'filD', ci, k);
        const s0 = r1 * crack.totalLen * 0.7;
        const sEnd = Math.min(s0 + (0.12 + 0.18 * r2) * crack.totalLen, crack.totalLen, vis);
        if (sEnd - s0 < 6) continue;
        const side = r3 < 0.5 ? 1 : -1;
        const dist = 1.5 + 1.5 * r4;
        let d = '';
        let started = false;
        for (let i = 0; i < part.pts.length; i++) {
          if (part.s[i] < s0 || part.s[i] > sEnd) {
            started = false;
            continue;
          }
          const x = part.pts[i][0] + frame.mx[i] * frame.scale[i] * side * dist;
          const y = part.pts[i][1] + frame.my[i] * frame.scale[i] * side * dist;
          d += `${started ? 'L' : 'M'}${fmt(x)} ${fmt(y)}`;
          started = true;
        }
        if (d.indexOf('L') >= 0) highlight += d;
      }
    }

    if (style.hackleDensity > 0) {
      const ticks = crack.ticks;
      for (let ti = 0, j = 0; ti + 4 < ticks.length; ti += 5, j++) {
        if (ticks[ti] > vis) continue;
        if (hashTo01(hashCombine(ci, j)) >= style.hackleDensity) continue;
        hackle += `M${fmt(ticks[ti + 1])} ${fmt(ticks[ti + 2])}L${fmt(ticks[ti + 3])} ${fmt(ticks[ti + 4])}`;
      }
    }
  }

  // The crack web fades as shards depart. In glass mode the stationary content is seamless
  // with the base layer, so a fixed 0.07 window lets the pane look fully HEALED while
  // staggered outer rings are still in place; stretch the window across the stagger
  // envelope so the cracks linger until the pieces they border actually leave. Content
  // mode keeps the verbatim v0.4 constant (byte anchor).
  let fadeWindow = 0.07;
  if (fx.medium === 'glass') {
    let maxRing = 0;
    for (const s of pattern.shards) if (s.ringIndex > maxRing) maxRing = s.ringIndex;
    fadeWindow = maxRing * fx.shatter.staggerPerRing * 1.4 + 0.07;
  }
  const opacity = info.phase === 'shattering' ? clamp01(1 - info.shatterTau / fadeWindow) : 1;

  let sparkle: FrameData['cracks']['sparkle'] = null;
  if (style.sparkle && pattern.mode === 'radial') {
    const [ix, iy] = pattern.impact;
    const rMax = Math.max(
      Math.hypot(ix, iy),
      Math.hypot(pattern.width - ix, iy),
      Math.hypot(ix, pattern.height - iy),
      Math.hypot(pattern.width - ix, pattern.height - iy),
    );
    // The sparkle dies as the center plug is punched through - otherwise its glow
    // (bigger than the hole) would sit exactly on top of the punched-out backdrop.
    const punch = fx.crush.punch ? easeOutCubic(clamp01((info.crackProgress - 0.1) * 2.2)) : 0;
    sparkle = {
      cx: ix,
      cy: iy,
      r: rMax * 0.045 * (0.5 + 0.5 * easeOutCubic(info.crackProgress)),
      opacity: easeOutCubic(info.crackProgress) * 0.9 * (1 - punch),
    };
  }

  return {
    corePath: core,
    coreDimPath: coreDim,
    stubPath: stubD,
    shadowPath: shadow,
    highlightPath: highlight,
    hacklePath: hackle,
    coreDimOpacity: Math.max(0.35, 1 - 0.65 * bv),
    coreOpacity: bv > 0 ? Math.min(1, bv / 0.25) : 1,
    opacity,
    style,
    sparkle,
  };
}

export interface PartialPolyline {
  pts: Vec2[];
  /** Absolute arc-length station of each point. */
  s: number[];
}

export function partialPolylineWithS(pts: Vec2[], cum: number[], vis: number): PartialPolyline {
  const total = cum[cum.length - 1];
  if (vis <= 0) return { pts: [], s: [] };
  if (vis >= total) return { pts: pts.slice(), s: cum.slice() };
  const outP: Vec2[] = [pts[0]];
  const outS: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    if (cum[i] <= vis) {
      outP.push(pts[i]);
      outS.push(cum[i]);
    } else {
      const segLen = cum[i] - cum[i - 1];
      const t = segLen > 1e-12 ? (vis - cum[i - 1]) / segLen : 0;
      outP.push([
        pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
        pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t,
      ]);
      outS.push(vis);
      break;
    }
  }
  return { pts: outP, s: outS };
}

/** Insert interpolated points at the given ascending stations (used for feathered dim boundaries). */
export function insertStations(part: PartialPolyline, stations: number[], vis: number): void {
  for (const st of stations) {
    if (st <= 0.05 || st >= Math.min(vis, part.s[part.s.length - 1]) - 0.05) continue;
    let i = 0;
    while (i < part.s.length && part.s[i] <= st) i++;
    if (i === 0 || i >= part.s.length) continue;
    if (st - part.s[i - 1] < 0.05 || part.s[i] - st < 0.05) continue;
    const t = (st - part.s[i - 1]) / (part.s[i] - part.s[i - 1]);
    part.pts.splice(i, 0, [
      part.pts[i - 1][0] + (part.pts[i][0] - part.pts[i - 1][0]) * t,
      part.pts[i - 1][1] + (part.pts[i][1] - part.pts[i - 1][1]) * t,
    ]);
    part.s.splice(i, 0, st);
  }
}

export interface MiterFrame {
  /** Per-point miter direction (unit). */
  mx: number[];
  my: number[];
  /** Miter length scale, clamped to <= 2 (sharp jags pinch slightly - physically plausible). */
  scale: number[];
  /** Per-point half-width clamp: 0.4 * min(adjacent segment lengths). */
  maxHalf: number[];
}

export function miterFrame(pts: Vec2[]): MiterFrame {
  const n = pts.length;
  const segNx: number[] = [];
  const segNy: number[] = [];
  const segL: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const l = Math.hypot(dx, dy) || 1e-9;
    segNx.push(-dy / l);
    segNy.push(dx / l);
    segL.push(l);
  }
  const mx: number[] = [];
  const my: number[] = [];
  const scale: number[] = [];
  const maxHalf: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = i === 0 ? 0 : i - 1;
    const b = i === n - 1 ? n - 2 : i;
    let x = segNx[a] + segNx[b];
    let y = segNy[a] + segNy[b];
    const l = Math.hypot(x, y);
    if (l < 1e-9) {
      x = segNx[b];
      y = segNy[b];
    } else {
      x /= l;
      y /= l;
    }
    const dot = x * segNx[b] + y * segNy[b];
    mx.push(x);
    my.push(y);
    scale.push(Math.min(2, 1 / Math.max(0.35, dot)));
    maxHalf.push(0.4 * Math.min(segL[a], segL[b]));
  }
  return { mx, my, scale, maxHalf };
}

/** Closed variable-width ribbon fill path around a polyline (nonzero fill swallows micro-folds). */
export function ribbonPath(
  pts: Vec2[],
  frame: MiterFrame,
  halfWs: number[],
  ox: number,
  oy: number,
): string {
  const n = pts.length;
  if (n < 2) return '';
  let left = '';
  let right = '';
  for (let i = 0; i < n; i++) {
    const w = halfWs[i] * frame.scale[i];
    const lx = pts[i][0] + frame.mx[i] * w + ox;
    const ly = pts[i][1] + frame.my[i] * w + oy;
    left += `${i === 0 ? 'M' : 'L'}${fmt(lx)} ${fmt(ly)}`;
    const rx = pts[i][0] - frame.mx[i] * w + ox;
    const ry = pts[i][1] - frame.my[i] * w + oy;
    // right chain is appended in reverse below
    right = `L${fmt(rx)} ${fmt(ry)}` + right;
  }
  return left + right + 'Z';
}
