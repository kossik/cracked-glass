import type { CrackPolyline, Shard, Vec2 } from '../types';
import { degToRad } from '../core/math';
import { hashCombine, hashString, rngFor } from '../core/prng';
import { cumulativeLengths, segmentIntersection } from '../core/geometry';
import { clipPolygonToRect } from '../core/geometry';
import { subdivideMidpoint } from '../core/noise';
import { baseLine } from './lines';
import { makeCrack, makeShard, reversePts, shuffledRanks, stitchLoop, type ResolvedFracture } from './build';
import { rand01 } from '../core/prng';
import type { StubJunction } from './stubs';

/**
 * 'collapse' fracture: two transversal families of wavy crack lines form an irregular
 * diagonal quad mesh; pieces then lose support and crumble out of the frame bottom-up.
 *
 * Watertightness strategy (same spirit as radial's anchors): intersections are computed
 * on SMOOTH base lines only (their tangent cones are disjoint by construction, so any
 * A-line crosses any B-line exactly once), each intersection is one shared Vec2, and the
 * conchoidal jag is applied per-slice afterwards with fixed endpoints.
 */
export function generateCollapseFracture(o: ResolvedFracture): {
  shards: Shard[];
  cracks: CrackPolyline[];
  rows: number;
  junctions: StubJunction[];
  stubScale: number;
} {
  const { width: w, height: h, seed } = o;
  const diag = Math.hypot(w, h);
  const pad = 0.6 * diag;

  const sep = Math.abs(((o.collapse.angleB - o.collapse.angleA + 90) % 180) - 90);
  const theta = Math.min(16, (Math.max(sep, 35) - 20) / 2);
  const slopeMax = Math.tan(degToRad(theta));

  const rngA = rngFor(seed, 'collapse:countA');
  const rngB = rngFor(seed, 'collapse:countB');
  const countA = resolveCount(o.collapse.countA, rngA);
  const countB = resolveCount(o.collapse.countB, rngB);

  const famA = buildFamily(o, 'A', o.collapse.angleA, countA, slopeMax, w, h, pad);
  const famB = buildFamily(o, 'B', o.collapse.angleB, countB, slopeMax, w, h, pad);
  const nA = famA.length;
  const nB = famB.length;

  // --- intersections on smooth base lines: exactly one per (i,j), one shared Vec2 each ---
  type Cross = { p: Vec2; sA: number; sB: number };
  const cross: Cross[][] = [];
  for (let i = 0; i < nA; i++) {
    const row: Cross[] = [];
    const A = famA[i];
    for (let j = 0; j < nB; j++) {
      const B = famB[j];
      let found: Cross | null = null;
      outer: for (let p = 0; p < A.pts.length - 1; p++) {
        for (let q = 0; q < B.pts.length - 1; q++) {
          const hit = segmentIntersection(A.pts[p], A.pts[p + 1], B.pts[q], B.pts[q + 1]);
          if (hit) {
            found = {
              p: hit.p,
              sA: A.cum[p] + hit.ta * (A.cum[p + 1] - A.cum[p]),
              sB: B.cum[q] + hit.tb * (B.cum[q + 1] - B.cum[q]),
            };
            break outer;
          }
        }
      }
      if (!found) {
        // Should be impossible by the tangent-cone construction; keep generation total anyway.
        const fallback: Vec2 = [w / 2, h / 2];
        found = { p: fallback, sA: A.cum[A.cum.length - 1] / 2, sB: B.cum[B.cum.length - 1] / 2 };
      }
      row.push(found);
    }
    cross.push(row);
  }

  // --- jagged slices between consecutive intersections (generated once, shared by cells) ---
  const gapA = approxGap(famA);
  const gapB = approxGap(famB);
  const maxOff = 0.2 * Math.min(gapA, gapB);
  const sliceA = new Map<string, Vec2[]>();
  const sliceB = new Map<string, Vec2[]>();
  for (let i = 0; i < nA; i++) {
    for (let j = 0; j < nB - 1; j++) {
      sliceA.set(
        `${i}:${j}`,
        jagSlice(famA[i], cross[i][j].sA, cross[i][j + 1].sA, cross[i][j].p, cross[i][j + 1].p, o, hashCombine(seed, hashString('collapse:Ajag'), i, j), maxOff),
      );
    }
  }
  for (let j = 0; j < nB; j++) {
    for (let i = 0; i < nA - 1; i++) {
      sliceB.set(
        `${j}:${i}`,
        jagSlice(famB[j], cross[i][j].sB, cross[i + 1][j].sB, cross[i][j].p, cross[i + 1][j].p, o, hashCombine(seed, hashString('collapse:Bjag'), j, i), maxOff),
      );
    }
  }

  // --- cells (with B-separator merging: a dropped separator joins two cells in the A
  //     direction; at merge 0 every run is a singleton and the loop is byte-identical) ---
  const keepB = (j: number, i: number): boolean => {
    if (j <= 0 || j >= nB - 1) return true; // virtual outer lines always "exist"
    if (o.collapse.merge <= 0) return true;
    return rand01(o.seed, 'collapse:mergeB', j, i) >= o.collapse.merge;
  };
  const rows = nA - 1;
  type RawCell = { poly: Vec2[]; row: number };
  const raw: RawCell[] = [];
  for (let i = 0; i < nA - 1; i++) {
    for (let j = 0; j < nB - 1; j++) {
      if (!keepB(j, i)) continue; // not the left edge of a run
      let j1 = j;
      while (j1 + 1 < nB - 1 && !keepB(j1 + 1, i)) j1++;
      const segs: Vec2[][] = [];
      for (let jj = j; jj <= j1; jj++) segs.push(sliceA.get(`${i}:${jj}`)!);
      segs.push(sliceB.get(`${j1 + 1}:${i}`)!);
      for (let jj = j1; jj >= j; jj--) segs.push(reversePts(sliceA.get(`${i + 1}:${jj}`)!));
      segs.push(reversePts(sliceB.get(`${j}:${i}`)!));
      const poly = stitchLoop(segs);
      const clipped = clipPolygonToRect(poly, w, h);
      if (clipped.length >= 3) raw.push({ poly: clipped, row: rows - 1 - i });
    }
  }

  const ranks = shuffledRanks(seed, 'collapse:z', raw.length);
  const shards: Shard[] = [];
  for (let i = 0; i < raw.length; i++) {
    const s = makeShard(seed, i, raw[i].poly, raw[i].row, ranks[i], o.seamOutsetPx);
    if (s) shards.push(s);
  }

  // --- crack polylines: interior lines only (outer lines are virtual, fully outside) ---
  const cracks: CrackPolyline[] = [];
  const junctions: StubJunction[] = [];
  let ci = 0;
  // A lines stay full-length cracks.
  for (let li = 1; li < famA.length - 1; li++) {
    const segs: Vec2[][] = [];
    for (let k = 0; k < nB - 1; k++) {
      const s = sliceA.get(`${li}:${k}`);
      if (s) segs.push(s);
    }
    if (segs.length === 0) continue;
    let pts = concatPolylines(segs);
    const rngC = rngFor(seed, 'collapse:A:birth', li);
    if (li % 2 === 0) pts = reversePts(pts);
    const grow = 0.3 + rngC() * 0.12;
    const birth = Math.min(rngC() * 0.45, 0.97 - grow);
    cracks.push(makeCrack(seed, `c${ci++}`, 'mesh', pts, birth, grow));
  }
  // B lines render only their KEPT stretches: a dropped separator means the crack never
  // ran there (the cells merged). All-kept lines take the verbatim v0.3 path.
  for (let li = 1; li < famB.length - 1; li++) {
    const rngC = rngFor(seed, 'collapse:B:birth', li); // v0.3 stream: grow first, then birth
    const grow = 0.3 + rngC() * 0.12;
    const birthBase = Math.min(rngC() * 0.45, 0.97 - grow);
    const spans = nA - 1;
    const kept: boolean[] = [];
    for (let i = 0; i < spans; i++) kept.push(keepB(li, i));
    if (kept.every(Boolean)) {
      const segs: Vec2[][] = [];
      for (let k = 0; k < spans; k++) {
        const s = sliceB.get(`${li}:${k}`);
        if (s) segs.push(s);
      }
      if (segs.length === 0) continue;
      let pts = concatPolylines(segs);
      if (li % 2 === 0) pts = reversePts(pts);
      cracks.push(makeCrack(seed, `c${ci++}`, 'mesh', pts, birthBase, grow));
      continue;
    }
    for (let i0 = 0; i0 < spans; i0++) {
      if (!kept[i0] || (i0 > 0 && kept[i0 - 1])) continue; // run start
      const segs: Vec2[][] = [];
      for (let k = i0; k < spans && kept[k]; k++) {
        const s = sliceB.get(`${li}:${k}`);
        if (s) segs.push(s);
      }
      if (segs.length === 0) continue;
      let pts = concatPolylines(segs);
      if (li % 2 === 0) pts = reversePts(pts);
      const birth = Math.min(birthBase + 0.05 * rand01(seed, 'collapse:Brun', li, i0), 0.985 - grow);
      cracks.push(makeCrack(seed, `c${ci++}`, 'mesh', pts, birth, grow));
      const ciRun = cracks.length - 1;
      // a B stretch dying into an A line = T-junction, the natural hairline spot
      junctions.push({ crackIndex: ciRun, s: 0 }, { crackIndex: ciRun, s: cracks[ciRun].totalLen });
    }
  }

  return { shards, cracks, rows, junctions, stubScale: Math.min(approxGap(famA), approxGap(famB)) };
}

interface BuiltLine {
  pts: Vec2[];
  cum: number[];
}

function resolveCount(spec: number | [number, number], rng: () => number): number {
  if (Array.isArray(spec)) {
    const lo = Math.min(spec[0], spec[1]);
    const hi = Math.max(spec[0], spec[1]);
    return Math.max(1, Math.round(lo + rng() * (hi - lo)));
  }
  return Math.max(1, Math.round(spec));
}

/** Interior lines + 2 virtual outer lines fully outside the rect, in offset order. */
function buildFamily(
  o: ResolvedFracture,
  famKey: 'A' | 'B',
  angleDeg: number,
  count: number,
  slopeMax: number,
  w: number,
  h: number,
  pad: number,
): BuiltLine[] {
  const a = degToRad(angleDeg);
  const dir: Vec2 = [Math.cos(a), Math.sin(a)];
  const nrm: Vec2 = [-Math.sin(a), Math.cos(a)];
  const corners: Vec2[] = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const c of corners) {
    const u = c[0] * dir[0] + c[1] * dir[1];
    const v = c[0] * nrm[0] + c[1] * nrm[1];
    uMin = Math.min(uMin, u);
    uMax = Math.max(uMax, u);
    vMin = Math.min(vMin, v);
    vMax = Math.max(vMax, v);
  }
  const gap = (vMax - vMin) / (count + 1);
  const offsets: number[] = [vMin - 0.75 * gap];
  const rngJ = rngFor(o.seed, `collapse:${famKey}:offsets`);
  for (let k = 0; k < count; k++) {
    offsets.push(vMin + gap * (k + 1) + (rngJ() - 0.5) * gap * 0.55);
  }
  offsets.push(vMax + 0.75 * gap);

  const u0 = uMin - pad;
  const u1 = uMax + pad;
  const segments = Math.max(8, Math.round((u1 - u0) / 120));

  const lines: BuiltLine[] = [];
  for (let li = 0; li < offsets.length; li++) {
    const gapPrev = li > 0 ? offsets[li] - offsets[li - 1] : gap;
    const gapNext = li < offsets.length - 1 ? offsets[li + 1] - offsets[li] : gap;
    const corridorHalf = 0.45 * Math.max(4, Math.min(gapPrev, gapNext));
    const { u, v } = baseLine({
      seed: o.seed,
      group: `collapse:${famKey}`,
      key: li,
      u0,
      u1,
      segments,
      offset: offsets[li],
      waveAmp: o.collapse.waviness * gap * 0.2,
      deviation: o.deviation,
      devAmpMax: gap,
      slopeMax,
      corridorHalf,
    });
    const pts: Vec2[] = u.map((uu, k) => [dir[0] * uu + nrm[0] * v[k], dir[1] * uu + nrm[1] * v[k]]);
    lines.push({ pts, cum: cumulativeLengths(pts) });
  }
  return lines;
}

/** Average perpendicular spacing of a family's interior lines (for jag amplitude clamps). */
function approxGap(fam: BuiltLine[]): number {
  if (fam.length < 2) return 40;
  const a = fam[0].pts[0];
  const b = fam[fam.length - 1].pts[0];
  return Math.max(8, Math.hypot(b[0] - a[0], b[1] - a[1]) / (fam.length - 1));
}

/** Extract the base sub-polyline between two stations (exact shared endpoints) and jag it. */
function jagSlice(
  line: BuiltLine,
  s0: number,
  s1: number,
  p0: Vec2,
  p1: Vec2,
  o: ResolvedFracture,
  jagSeed: number,
  maxOff: number,
): Vec2[] {
  const lo = Math.min(s0, s1);
  const hi = Math.max(s0, s1);
  const base: Vec2[] = [lo === s0 ? p0 : p1];
  for (let i = 0; i < line.pts.length; i++) {
    if (line.cum[i] > lo + 0.5 && line.cum[i] < hi - 0.5) base.push(line.pts[i]);
  }
  base.push(lo === s0 ? p1 : p0);
  let out = subdivideMidpoint(base, o.edgeDetail, o.jaggedness * 0.45, jagSeed, maxOff);
  if (lo !== s0) out = reversePts(out); // keep direction s0 -> s1
  return out;
}

function concatPolylines(segs: Vec2[][]): Vec2[] {
  const out: Vec2[] = [];
  for (const seg of segs) {
    const start = out.length === 0 ? 0 : 1;
    for (let i = start; i < seg.length; i++) out.push(seg[i]);
  }
  return out;
}
