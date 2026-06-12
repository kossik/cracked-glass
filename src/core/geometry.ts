import { fmt } from './math';
import type { Vec2 } from '../types';

/**
 * Polygon convention: screen coordinates (y down), winding normalized so the shoelace
 * sum is positive (visually clockwise). For such polygons the outward normal of an
 * edge direction (dx, dy) is (dy, -dx) normalized.
 */

export function signedArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function ensurePositiveWinding(poly: Vec2[]): Vec2[] {
  return signedArea(poly) >= 0 ? poly : poly.slice().reverse();
}

export function polygonCentroid(poly: Vec2[]): Vec2 {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const cross = p[0] * q[1] - q[0] * p[1];
    a += cross;
    cx += (p[0] + q[0]) * cross;
    cy += (p[1] + q[1]) * cross;
  }
  a /= 2;
  if (Math.abs(a) < 1e-9) {
    // Degenerate: average the points.
    let sx = 0;
    let sy = 0;
    for (const p of poly) {
      sx += p[0];
      sy += p[1];
    }
    return [sx / poly.length, sy / poly.length];
  }
  return [cx / (6 * a), cy / (6 * a)];
}

/** Remove consecutive (near-)duplicate points; also drops a duplicated closing point. */
export function dedupePolygon(poly: Vec2[], eps = 1e-7): Vec2[] {
  const out: Vec2[] = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > eps || Math.abs(last[1] - p[1]) > eps) {
      out.push(p);
    }
  }
  if (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.abs(first[0] - last[0]) <= eps && Math.abs(first[1] - last[1]) <= eps) {
      out.pop();
    }
  }
  return out;
}

/** Sutherland-Hodgman clip of a polygon against the rect [0,0]-[w,h]. */
export function clipPolygonToRect(poly: Vec2[], w: number, h: number): Vec2[] {
  type Edge = { inside: (p: Vec2) => boolean; cut: (a: Vec2, b: Vec2) => Vec2 };
  const edges: Edge[] = [
    { inside: (p) => p[0] >= 0, cut: (a, b) => cutX(a, b, 0) },
    { inside: (p) => p[0] <= w, cut: (a, b) => cutX(a, b, w) },
    { inside: (p) => p[1] >= 0, cut: (a, b) => cutY(a, b, 0) },
    { inside: (p) => p[1] <= h, cut: (a, b) => cutY(a, b, h) },
  ];
  let cur = poly;
  for (const e of edges) {
    if (cur.length === 0) return [];
    const next: Vec2[] = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i];
      const b = cur[(i + 1) % cur.length];
      const ain = e.inside(a);
      const bin = e.inside(b);
      if (ain) {
        next.push(a);
        if (!bin) next.push(e.cut(a, b));
      } else if (bin) {
        next.push(e.cut(a, b));
      }
    }
    cur = next;
  }
  return dedupePolygon(cur);
}

function cutX(a: Vec2, b: Vec2, x: number): Vec2 {
  const t = (x - a[0]) / (b[0] - a[0]);
  return [x, a[1] + (b[1] - a[1]) * t];
}

function cutY(a: Vec2, b: Vec2, y: number): Vec2 {
  const t = (y - a[1]) / (b[1] - a[1]);
  return [a[0] + (b[0] - a[0]) * t, y];
}

/**
 * Offset a positively-wound polygon outward by `dist` px using per-vertex angle bisectors
 * with a miter clamp. Tiny distances only (seam hiding) - self-intersection at extreme
 * concave jags is bounded by the clamp and invisible at <1px.
 */
export function offsetPolygon(poly: Vec2[], dist: number, miterLimit = 3): Vec2[] {
  const n = poly.length;
  if (n < 3 || dist === 0) return poly.slice();
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n];
    const v = poly[i];
    const next = poly[(i + 1) % n];
    const n1 = edgeOutwardNormal(prev, v);
    const n2 = edgeOutwardNormal(v, next);
    let mx = n1[0] + n2[0];
    let my = n1[1] + n2[1];
    const ml = Math.hypot(mx, my);
    if (ml < 1e-9) {
      // 180-degree spike: fall back to one normal.
      mx = n1[0];
      my = n1[1];
    } else {
      mx /= ml;
      my /= ml;
    }
    const dot = mx * n1[0] + my * n1[1];
    let scale = dot > 1e-6 ? 1 / dot : miterLimit;
    if (scale > miterLimit) scale = miterLimit;
    out.push([v[0] + mx * dist * scale, v[1] + my * dist * scale]);
  }
  return out;
}

function edgeOutwardNormal(a: Vec2, b: Vec2): Vec2 {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy);
  if (l < 1e-9) return [0, 0];
  return [dy / l, -dx / l];
}

/** Proper segment-segment intersection; returns the point and both segment parameters. */
export function segmentIntersection(
  a1: Vec2,
  a2: Vec2,
  b1: Vec2,
  b2: Vec2,
): { p: Vec2; ta: number; tb: number } | null {
  const dax = a2[0] - a1[0];
  const day = a2[1] - a1[1];
  const dbx = b2[0] - b1[0];
  const dby = b2[1] - b1[1];
  const den = dax * dby - day * dbx;
  if (Math.abs(den) < 1e-12) return null;
  const ex = b1[0] - a1[0];
  const ey = b1[1] - a1[1];
  const ta = (ex * dby - ey * dbx) / den;
  const tb = (ex * day - ey * dax) / den;
  if (ta < -1e-9 || ta > 1 + 1e-9 || tb < -1e-9 || tb > 1 + 1e-9) return null;
  return { p: [a1[0] + dax * ta, a1[1] + day * ta], ta, tb };
}

/** Prefix arc lengths for a polyline (same length as pts). */
export function cumulativeLengths(pts: Vec2[]): number[] {
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return cum;
}

/** Point at arc length `len` along the polyline (binary search + lerp). */
export function pointAtLength(pts: Vec2[], cum: number[], len: number): Vec2 {
  const total = cum[cum.length - 1];
  if (len <= 0) return pts[0];
  if (len >= total) return pts[pts.length - 1];
  let lo = 0;
  let hi = cum.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= len) lo = mid;
    else hi = mid;
  }
  const segLen = cum[hi] - cum[lo];
  const t = segLen > 1e-12 ? (len - cum[lo]) / segLen : 0;
  return [
    pts[lo][0] + (pts[hi][0] - pts[lo][0]) * t,
    pts[lo][1] + (pts[hi][1] - pts[lo][1]) * t,
  ];
}

/** Unit tangent of the segment containing arc length `len` (same binary search as pointAtLength). */
export function tangentAtLength(pts: Vec2[], cum: number[], len: number): Vec2 {
  let lo = 0;
  let hi = cum.length - 1;
  if (len <= 0) hi = 1;
  else if (len >= cum[cum.length - 1]) lo = cum.length - 2;
  else {
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= len) lo = mid;
      else hi = mid;
    }
  }
  const dx = pts[hi][0] - pts[lo][0];
  const dy = pts[hi][1] - pts[lo][1];
  const l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}

// --- string emission (the only place geometry becomes CSS/SVG text) ---

export function toCssPolygon(poly: ArrayLike<number>, precision = 2): string {
  const parts: string[] = [];
  for (let i = 0; i + 1 < poly.length; i += 2) {
    parts.push(`${fmt(poly[i], precision)}px ${fmt(poly[i + 1], precision)}px`);
  }
  return `polygon(${parts.join(', ')})`;
}

export function toSvgPathD(poly: ArrayLike<number>, closed: boolean, precision = 2): string {
  if (poly.length < 2) return '';
  let d = `M${fmt(poly[0], precision)} ${fmt(poly[1], precision)}`;
  for (let i = 2; i + 1 < poly.length; i += 2) {
    d += `L${fmt(poly[i], precision)} ${fmt(poly[i + 1], precision)}`;
  }
  return closed ? d + 'Z' : d;
}

export function toSvgPoints(poly: ArrayLike<number>, precision = 2): string {
  const parts: string[] = [];
  for (let i = 0; i + 1 < poly.length; i += 2) {
    parts.push(`${fmt(poly[i], precision)},${fmt(poly[i + 1], precision)}`);
  }
  return parts.join(' ');
}

export function flattenPts(pts: Vec2[]): number[] {
  const out: number[] = [];
  for (const p of pts) {
    out.push(p[0], p[1]);
  }
  return out;
}

export function unflattenPts(flat: ArrayLike<number>): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    out.push([flat[i], flat[i + 1]]);
  }
  return out;
}
