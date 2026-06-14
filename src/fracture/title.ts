import type { CrackPolyline, Shard, Vec2 } from '../types';
import { fbm1D, subdivideMidpoint } from '../core/noise';
import { hashCombine, hashString, rand01, rngFor } from '../core/prng';
import { clamp } from '../core/math';
import { makeCrack, makeShard, reversePts, shuffledRanks, type ResolvedFracture } from './build';
import { excursionOffset, makeExcursions } from './lines';
import type { StubJunction } from './stubs';

/**
 * 'title' fracture: a stack of wavy near-horizontal crack boundaries splitting the rect
 * into large shards, with diagonal splitters breaking bands into 2-4 uneven pieces.
 *
 * Since v0.4 boundaries TILT (bands wedge instead of running parallel - real pane cracks
 * never do) and bands may carry up to 3 splitters. Non-crossing of tilted boundaries is
 * guaranteed by DISJOINT MIDLINE ENVELOPES: each boundary's final points are clamped
 * between the midlines toward its neighbors (evaluated at the point's own final x), so no
 * two boundaries can ever touch regardless of excursions/jag. bands.tilt=0 and
 * bands.splitters=1 reproduce the v0.3 code paths verbatim.
 */
export function generateTitleFracture(o: ResolvedFracture): {
  shards: Shard[];
  cracks: CrackPolyline[];
  junctions: StubJunction[];
  stubScale: number;
} {
  const { width: w, height: h, seed } = o;
  const rngCount = rngFor(seed, 'title:count');
  const bandCount = Array.isArray(o.bands.count)
    ? Math.round(
        clamp(
          o.bands.count[0] + rngCount() * (o.bands.count[1] - o.bands.count[0]),
          Math.min(o.bands.count[0], o.bands.count[1]),
          Math.max(o.bands.count[0], o.bands.count[1]),
        ),
      )
    : Math.max(2, Math.round(o.bands.count));
  const gap = h / bandCount;
  const tiltOn = o.bands.tilt > 0;

  // Base line of boundary k: y_k(x) = gap*k + off_k + tilt_k*(x - w/2).
  // Sign-alternating tilts maximize visible wander while keeping neighbor deltas bounded.
  const offs = new Array<number>(bandCount + 1).fill(0);
  const tilts = new Array<number>(bandCount + 1).fill(0);
  for (let k = 1; k < bandCount; k++) {
    const rngB = rngFor(seed, 'title:boundary', k);
    offs[k] = (rngB() - 0.5) * gap * 0.36; // identical first draw in both paths (v0.3 anchor)
    if (tiltOn) {
      const sign = k % 2 === 0 ? 1 : -1;
      tilts[k] = sign * (0.3 + 0.7 * rand01(seed, 'title:tilt', k)) * 0.225 * o.bands.tilt * (gap / (w / 2));
    }
  }
  const yLine = (k: number, x: number): number => {
    if (k <= 0) return 0;
    if (k >= bandCount) return h;
    return gap * k + offs[k] + tilts[k] * (x - w / 2);
  };

  // Boundaries 0..bandCount: index 0 = container top edge, bandCount = bottom edge.
  const boundaries: Vec2[][] = [];
  const segments = Math.max(4, Math.round(w / 160));
  for (let k = 0; k <= bandCount; k++) {
    if (k === 0 || k === bandCount) {
      boundaries.push([
        [0, k === 0 ? 0 : h],
        [w, k === 0 ? 0 : h],
      ]);
      continue;
    }
    const waveAmp = o.bands.waviness * gap * 0.22;
    const waveSeed = hashCombine(seed, hashString('title:wave'), k);
    const excursions = o.deviation > 0 ? makeExcursions(seed, 'title', k, o.deviation, gap) : [];
    const base: Vec2[] = [];
    for (let i = 0; i <= segments; i++) {
      const x = (w * i) / segments;
      let y = yLine(k, x) + fbm1D(waveSeed, i * 0.85, 3) * waveAmp;
      if (excursions.length > 0) y += excursionOffset(excursions, i / segments);
      base.push([x, y]);
    }
    let jagged = subdivideMidpoint(
      base,
      o.edgeDetail,
      o.jaggedness * 0.5,
      hashCombine(seed, hashString('title:jag'), k),
      gap * 0.17,
    );
    if (tiltOn) {
      // Hard non-crossing guarantee: clamp every final point between the midlines toward
      // its neighbors, evaluated at the point's OWN final x (jag shifts x, so a fixed-x
      // clamp would void the half-plane separation argument).
      jagged = jagged.map(([x, y]) => {
        const lo = (yLine(k - 1, x) + yLine(k, x)) / 2 + 0.06 * gap;
        const hi = (yLine(k, x) + yLine(k + 1, x)) / 2 - 0.06 * gap;
        return [x, y < lo ? lo : y > hi ? hi : y] as Vec2;
      });
    } else if (o.deviation > 0) {
      // verbatim v0.3 corridor
      const lo = gap * k - gap * 0.45;
      const hi = gap * k + gap * 0.45;
      jagged = jagged.map(([x, y]) => [x, y < lo ? lo : y > hi ? hi : y] as Vec2);
    }
    boundaries.push(jagged);
  }

  // Bands -> shards, with diagonal splitters.
  type RawShard = { poly: Vec2[]; band: number };
  const raw: RawShard[] = [];
  const cracks: CrackPolyline[] = [];
  const junctions: StubJunction[] = [];
  let crackIdx = 0;

  // Boundary cracks (growth direction alternates sides; first cracks appear near the middle).
  const order = boundaryBirthOrder(bandCount);
  for (let k = 1; k < bandCount; k++) {
    const rngC = rngFor(seed, 'title:crack', k);
    const pts = k % 2 === 0 ? reversePts(boundaries[k]) : boundaries[k].slice();
    const rank = order.indexOf(k);
    const grow = 0.38 + rngC() * 0.14;
    const birth = Math.min(0.04 + (rank / Math.max(1, bandCount - 2)) * 0.38 + rngC() * 0.06, 0.97 - grow);
    cracks.push(makeCrack(seed, `c${crackIdx++}`, 'band', pts, birth, grow));
  }

  for (let band = 0; band < bandCount; band++) {
    const top = boundaries[band];
    const bot = boundaries[band + 1];

    if (o.bands.splitters === 1) {
      // ----- verbatim v0.3 single-splitter branch (byte anchor) -----
      const rngS = rngFor(seed, 'title:split', band);
      const wantSplit = rngS() < o.bands.diagonalChance && top.length > 6 && bot.length > 6;
      if (!wantSplit) {
        raw.push({ poly: [...top, ...reversePts(bot)], band });
        continue;
      }
      const targetX = (0.3 + rngS() * 0.4) * w;
      const iT = nearestIndexByX(top, targetX, 2);
      const diag = o.bands.diagonal;
      const lean = (rngS() * 2 - 1) * (diag > 0 ? diag * 0.6 * gap : (0.35 + 0.9 * o.deviation) * gap);
      const iB = nearestIndexByX(bot, top[iT][0] + lean, 2);
      const a = top[iT];
      const b = bot[iB];
      const splitBase: Vec2[] = [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], b];
      let splitter = subdivideMidpoint(
        splitBase,
        o.edgeDetail,
        o.jaggedness * 0.45,
        hashCombine(seed, hashString('title:splitjag'), band),
        gap * 0.16,
      );
      if (diag > 0) splitter = clampSplitterToBand(splitter, top, bot, gap);
      const left: Vec2[] = [...top.slice(0, iT + 1), ...splitter.slice(1), ...reversePts(bot.slice(0, iB))];
      const right: Vec2[] = [
        ...top.slice(iT),
        ...reversePts(bot.slice(iB)),
        ...reversePts(splitter.slice(1, -1)),
      ];
      raw.push({ poly: left, band });
      raw.push({ poly: right, band });
      const rngC = rngFor(seed, 'title:splitcrack', band);
      const sGrow = 0.22 + rngC() * 0.1;
      cracks.push(
        makeCrack(seed, `c${crackIdx++}`, 'split', splitter, Math.min(0.5 + rngC() * 0.18, 0.97 - sGrow), sGrow),
      );
      const ci1 = cracks.length - 1;
      junctions.push({ crackIndex: ci1, s: 0 }, { crackIndex: ci1, s: cracks[ci1].totalLen });
      continue;
    }

    // ----- multi-splitter branch: stratified slots, one-shot rng keys -----
    if (top.length <= 6 || bot.length <= 6) {
      raw.push({ poly: [...top, ...reversePts(bot)], band });
      continue;
    }
    const m = o.bands.splitters;
    const q = o.bands.diagonalChance;
    const probs = [q, 0.45 * q, 0.2 * q].slice(0, m);
    const slotLo = 0.15 * w;
    const slotW = (0.7 * w) / m;
    const diag = o.bands.diagonal;
    // all splitters in a band lean the SAME way -> iB advances with iT -> they never cross
    const bandSign = rand01(seed, 'title:diagSign', band) < 0.5 ? -1 : 1;
    type Cand = { iT: number; iB: number; pts: Vec2[] };
    const cands: Cand[] = [];
    for (let j = 0; j < m; j++) {
      if (rand01(seed, 'title:msplitG', band, j) >= probs[j]) continue;
      const r1 = rand01(seed, 'title:msplitX', band, j);
      const r2 = rand01(seed, 'title:msplitL', band, j);
      const targetX = slotLo + slotW * j + (0.25 + 0.5 * r1) * slotW;
      const iT = nearestIndexByX(top, targetX, 2);
      const lean =
        diag > 0
          ? bandSign * Math.min((0.35 + 0.65 * r2) * diag, 0.6) * gap
          : (r2 * 2 - 1) * Math.min((0.35 + 0.9 * o.deviation) * gap, 0.2 * slotW);
      const iB = nearestIndexByX(bot, top[iT][0] + lean, 2);
      const a = top[iT];
      const b = bot[iB];
      const splitBase: Vec2[] = [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], b];
      let pts = subdivideMidpoint(
        splitBase,
        o.edgeDetail,
        o.jaggedness * 0.45,
        hashCombine(seed, hashString('title:msplitjag'), band, j),
        Math.min(gap * 0.16, 0.1 * slotW),
      );
      if (diag > 0) pts = clampSplitterToBand(pts, top, bot, gap);
      cands.push({ iT, iB, pts });
    }
    // SIGNED index-gap enforcement on the RESOLVED stations (targets can snap): both
    // chains must advance by >= 4 indices or pieces degenerate into bowties.
    cands.sort((a, b) => a.iT - b.iT);
    const acc: Cand[] = [];
    for (const c of cands) {
      const prev = acc[acc.length - 1];
      if (c.iT < 2 || c.iT > top.length - 3 || c.iB < 2 || c.iB > bot.length - 3) continue;
      if (prev && (c.iT - prev.iT < 4 || c.iB - prev.iB < 4)) continue;
      acc.push(c);
    }
    if (acc.length === 0) {
      raw.push({ poly: [...top, ...reversePts(bot)], band });
      continue;
    }
    // pieces: 0 | 1..m-1 | last (shared polylines -> watertight)
    raw.push({
      poly: [...top.slice(0, acc[0].iT + 1), ...acc[0].pts.slice(1), ...reversePts(bot.slice(0, acc[0].iB))],
      band,
    });
    for (let j = 0; j + 1 < acc.length; j++) {
      raw.push({
        poly: [
          ...top.slice(acc[j].iT, acc[j + 1].iT + 1),
          ...acc[j + 1].pts.slice(1),
          ...reversePts(bot.slice(acc[j].iB, acc[j + 1].iB)),
          ...reversePts(acc[j].pts.slice(1, -1)),
        ],
        band,
      });
    }
    const last = acc[acc.length - 1];
    raw.push({
      poly: [...top.slice(last.iT), ...reversePts(bot.slice(last.iB)), ...reversePts(last.pts.slice(1, -1))],
      band,
    });
    for (let j = 0; j < acc.length; j++) {
      const rB1 = rand01(seed, 'title:msplitGrow', band, j);
      const rB2 = rand01(seed, 'title:msplitBirth', band, j);
      const sGrow = 0.22 + rB1 * 0.1;
      cracks.push(
        makeCrack(seed, `c${crackIdx++}`, 'split', acc[j].pts, Math.min(0.5 + rB2 * 0.18, 0.97 - sGrow), sGrow),
      );
      const ciM = cracks.length - 1;
      junctions.push({ crackIndex: ciM, s: 0 }, { crackIndex: ciM, s: cracks[ciM].totalLen });
    }
  }

  const ranks = shuffledRanks(seed, 'title:z', raw.length);
  const shards: Shard[] = [];
  for (let i = 0; i < raw.length; i++) {
    const s = makeShard(seed, i, raw[i].poly, raw[i].band, ranks[i], o.seamOutsetPx);
    if (s) shards.push(s);
  }
  return { shards, cracks, junctions, stubScale: gap };
}

/** Cracks appear middle-out: visually the pane "gives way" from the center. */
function boundaryBirthOrder(bandCount: number): number[] {
  const ks = Array.from({ length: bandCount - 1 }, (_, i) => i + 1);
  const mid = bandCount / 2;
  return ks.sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid) || p - q);
}

/** Interpolated y of an x-sorted boundary polyline at x (clamped to its range). */
function interpY(poly: Vec2[], x: number): number {
  if (x <= poly[0][0]) return poly[0][1];
  const last = poly[poly.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 0; i + 1 < poly.length; i++) {
    if (x >= poly[i][0] && x <= poly[i + 1][0]) {
      const t = (x - poly[i][0]) / Math.max(1e-9, poly[i + 1][0] - poly[i][0]);
      return poly[i][1] + (poly[i + 1][1] - poly[i][1]) * t;
    }
  }
  return last[1];
}

/**
 * Keep a diagonal splitter strictly inside its band: clamp every INTERIOR point's y between
 * the top and bottom boundaries at that point's x (the endpoints stay exact on the boundaries
 * - they are shared vertices). Without this the jag of a steep splitter pokes across a
 * boundary and the assembled shard self-intersects.
 */
function clampSplitterToBand(pts: Vec2[], top: Vec2[], bot: Vec2[], gap: number): Vec2[] {
  const m = 0.05 * gap;
  return pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return p;
    const lo = interpY(top, p[0]) + m;
    const hi = interpY(bot, p[0]) - m;
    return [p[0], p[1] < lo ? lo : p[1] > hi ? hi : p[1]] as Vec2;
  });
}

function nearestIndexByX(pts: Vec2[], x: number, margin: number): number {
  let best = margin;
  let bestD = Infinity;
  for (let i = margin; i < pts.length - margin; i++) {
    const d = Math.abs(pts[i][0] - x);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
