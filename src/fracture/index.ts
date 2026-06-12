import type { FractureOptions, FracturePattern, Vec2 } from '../types';
import { resolveFractureOptions } from './build';
import { generateTitleFracture } from './title';
import { generateRadialFracture } from './radial';
import { generateCollapseFracture } from './collapse';
import { addStubCracks, type StubJunction } from './stubs';
import { seedMicroShards } from './micro';

/**
 * Generate the t-independent fracture geometry. Pure: same options -> bit-identical pattern.
 * The result is deeply frozen; cache it on the caller side and feed it to computeFrame(t, ...).
 */
export function generateFracture(opts: FractureOptions): FracturePattern {
  const o = resolveFractureOptions(opts);

  let shards;
  let cracks;
  let junctions: StubJunction[];
  let stubScale: number;
  let ringIndexAt: (origin: Vec2) => number;

  if (o.mode === 'title') {
    const res = generateTitleFracture(o);
    shards = res.shards;
    cracks = res.cracks;
    junctions = res.junctions;
    stubScale = res.stubScale;
    const bandH = o.height / Math.max(1, Math.max(...shards.map((s) => s.ringIndex)) + 1);
    ringIndexAt = (origin) => Math.max(0, Math.min(Math.floor(origin[1] / bandH), 64));
  } else if (o.mode === 'collapse') {
    const res = generateCollapseFracture(o);
    shards = res.shards;
    cracks = res.cracks;
    junctions = res.junctions;
    stubScale = res.stubScale;
    const rowH = o.height / Math.max(1, res.rows);
    // rows are counted from the bottom (release order of the crumble)
    ringIndexAt = (origin) =>
      Math.max(0, Math.min(Math.floor((o.height - origin[1]) / rowH), res.rows - 1));
  } else {
    const res = generateRadialFracture(o);
    shards = res.shards;
    cracks = res.cracks;
    junctions = res.junctions;
    stubScale = res.stubScale;
    const R = Math.hypot(Math.max(o.impact[0], o.width - o.impact[0]), Math.max(o.impact[1], o.height - o.impact[1]));
    ringIndexAt = (origin) => {
      const d = Math.hypot(origin[0] - o.impact[0], origin[1] - o.impact[1]);
      return Math.max(0, Math.min(Math.round((d / Math.max(1, R)) * (res.maxRing + 1)), res.maxRing + 1));
    };
  }

  // Dead-end hairlines: appended AFTER all main cracks (render streams stay prefix-stable);
  // micro seeding below filters them, so shards/micro are byte-identical with stubs off.
  addStubCracks(o, cracks, junctions, stubScale);

  const micro = seedMicroShards(o, cracks, ringIndexAt);

  const pattern: FracturePattern = {
    version: 4,
    mode: o.mode,
    width: o.width,
    height: o.height,
    seed: o.seed,
    instanceId: o.instanceId,
    impact: o.impact,
    shards,
    cracks,
    micro,
  };
  return deepFreeze(pattern);
}

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const key of Object.keys(obj as object)) {
      deepFreeze((obj as Record<string, unknown>)[key]);
    }
  }
  return obj;
}
