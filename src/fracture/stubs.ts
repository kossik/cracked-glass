import type { CrackPolyline, Vec2 } from '../types';
import { degToRad } from '../core/math';
import { hashCombine, hashString, rand01 } from '../core/prng';
import { cumulativeLengths, pointAtLength, tangentAtLength, unflattenPts } from '../core/geometry';
import { subdivideMidpoint } from '../core/noise';
import { makeCrack, type ResolvedFracture } from './build';

/**
 * Dead-end hairline cracks: short partial-depth cracks that branch off main cracks at
 * 20-55 degrees and die out inside a shard - they are RENDER-ONLY and never touch shard
 * geometry (the fractographic reality: hackle traces and lateral cracks that do not
 * separate pieces).
 *
 * Determinism contract: stubs are APPENDED after all main cracks (the index-keyed ribbon /
 * filament / hackle streams in render/cracks.ts stay byte-stable for the prefix), micro
 * seeding filters them out, and every random value is an order-independent one-shot - so
 * a rejected candidate never shifts a sibling.
 */

/** A T-junction point expressed as (crack, arc station) so stub births can be derived. */
export interface StubJunction {
  crackIndex: number;
  s: number;
}

const MAX_TOTAL_STUBS = 200;

export function addStubCracks(
  o: ResolvedFracture,
  cracks: CrackPolyline[],
  junctions: StubJunction[],
  localScale: number,
): void {
  if (o.stubs === false || o.stubs.maxPerCrack <= 0) return;
  const { width: w, height: h, seed } = o;
  const mainCount = cracks.length;
  type Rec = { parent: number; pts: Vec2[]; birth: number; grow: number };
  const recs: Rec[] = [];
  const forkSeeds: Array<{ rec: Rec; key: number }> = [];

  const tryStub = (
    parentIdx: number,
    sStation: number,
    keyA: number,
    keyB: number,
    group: string,
    freeAngle: boolean,
  ): void => {
    const c = cracks[parentIdx];
    const rs = (field: string) => rand01(seed, `${group}:${field}`, keyA, keyB);
    const pts = unflattenPts(c.points);
    const p = pointAtLength(pts, c.cumLen, sStation);
    if (p[0] < 2 || p[0] > w - 2 || p[1] < 2 || p[1] > h - 2) return; // off-pane: invisible
    const tan = tangentAtLength(pts, c.cumLen, sStation);
    const side = rs('side') < 0.5 ? 1 : -1;
    const angDeg = freeAngle ? 25 + 55 * rs('ang') : 20 + 35 * rs('ang');
    const ang = degToRad(angDeg) * side;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const dir: Vec2 = [tan[0] * cos - tan[1] * sin, tan[0] * sin + tan[1] * cos];
    // Cap so the hairline cannot systematically pierce the next crack and "continue" in a
    // neighbor shard: perpendicular penetration stays within ~55% of the local cell scale.
    const sinA = Math.max(0.2, Math.abs(Math.sin(ang)));
    const L = Math.min(45, (0.18 + 0.45 * rs('len')) * localScale, (0.55 * localScale) / sinA);
    if (L < 4) return;
    // The stub may only start growing once the parent's tip has passed its station
    // (inverting crackLayer's easeOutQuart growth).
    const arrival =
      c.birth + c.growDuration * (1 - Math.pow(Math.max(0, 1 - sStation / Math.max(1e-6, c.totalLen)), 0.25));
    if (arrival > 0.965) return;
    const grow = Math.min(0.04 + 0.04 * rs('grow'), 0.985 - arrival);
    if (grow < 0.02) return;
    const curve = (rs('curve') - 0.5) * 0.24 * L;
    const perp: Vec2 = [-dir[1], dir[0]];
    const base: Vec2[] = [
      p,
      [p[0] + dir[0] * 0.55 * L + perp[0] * curve, p[1] + dir[1] * 0.55 * L + perp[1] * curve],
      [p[0] + dir[0] * L, p[1] + dir[1] * L],
    ];
    const jag = subdivideMidpoint(
      base,
      Math.min(2, o.edgeDetail),
      o.jaggedness * 0.4,
      hashCombine(seed, hashString(`${group}:jag`), keyA, keyB),
      0.15 * L,
    );
    const rec: Rec = { parent: parentIdx, pts: jag, birth: arrival, grow };
    recs.push(rec);
    if (rs('fork') < 0.25) forkSeeds.push({ rec, key: hashCombine(keyA, keyB) });
  };

  // 1. station stubs along main cracks (the crush ring is punched out - no stubs there)
  for (let ci = 0; ci < mainCount; ci++) {
    const c = cracks[ci];
    if (c.kind === 'crush' || c.totalLen < 30) continue;
    const n = Math.min(1 + Math.floor(rand01(seed, 'stub:n', ci) * 3.2), o.stubs.maxPerCrack);
    for (let k = 0; k < n; k++) {
      const s = (0.08 + 0.84 * rand01(seed, 'stub:s', ci, k)) * c.totalLen;
      tryStub(ci, s, ci, k, 'stub', false);
    }
  }

  // 2. junction stubs (crack endpoints dying into other cracks - T-junction hairlines)
  if (o.stubs.atJunctions) {
    for (let ji = 0; ji < junctions.length; ji++) {
      if (rand01(seed, 'stub:junction', ji) >= 0.3) continue;
      const jn = junctions[ji];
      tryStub(jn.crackIndex, jn.s, 1000003 + ji, 0, 'stubj', true);
    }
  }

  // 3. one-level forks of accepted stubs
  const forkRecs: Rec[] = [];
  for (let fi = 0; fi < forkSeeds.length; fi++) {
    const { rec, key } = forkSeeds[fi];
    const rf = (field: string) => rand01(seed, `stubf:${field}`, key, fi);
    const cum = cumulativeLengths(rec.pts);
    const total = cum[cum.length - 1];
    const sF = 0.6 * total;
    const p = pointAtLength(rec.pts, cum, sF);
    const tan = tangentAtLength(rec.pts, cum, sF);
    const side = rf('side') < 0.5 ? 1 : -1;
    const ang = degToRad(15 + 15 * rf('ang')) * side;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const dir: Vec2 = [tan[0] * cos - tan[1] * sin, tan[0] * sin + tan[1] * cos];
    const L = 0.4 * total;
    if (L < 4) continue;
    const forkBirth = rec.birth + rec.grow * (1 - Math.pow(1 - 0.6, 0.25));
    const forkGrow = Math.min(0.03 + 0.03 * rf('grow'), 0.985 - forkBirth);
    if (forkGrow < 0.02) continue;
    const base: Vec2[] = [
      p,
      [p[0] + dir[0] * 0.5 * L, p[1] + dir[1] * 0.5 * L],
      [p[0] + dir[0] * L, p[1] + dir[1] * L],
    ];
    const jag = subdivideMidpoint(
      base,
      Math.min(2, o.edgeDetail),
      o.jaggedness * 0.4,
      hashCombine(seed, hashString('stubf:jag'), key, fi),
      0.15 * L,
    );
    forkRecs.push({ parent: rec.parent, pts: jag, birth: forkBirth, grow: forkGrow });
  }

  // Append: stations, junctions (already interleaved in recs order), then forks - so caps
  // drop forks first. Distinct 'st' ids keep the id-keyed tick streams of main cracks safe.
  const all = [...recs, ...forkRecs].slice(0, MAX_TOTAL_STUBS);
  for (let si = 0; si < all.length; si++) {
    const r = all[si];
    const crack = makeCrack(seed, `st${si}`, 'stub', r.pts, r.birth, r.grow, false);
    crack.parent = r.parent;
    cracks.push(crack);
  }
}
