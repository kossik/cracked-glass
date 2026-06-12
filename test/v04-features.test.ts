import { describe, expect, it } from 'vitest';
import { computeFrame, generateFracture, staticCrackedTimeline } from '../src/index';
import type { DeepPartial, EffectParams, FractureOptions } from '../src/types';

const cracked: DeepPartial<EffectParams> = { timeline: staticCrackedTimeline };

/** Options that reproduce the v0.3 geometry paths (regression anchors). */
const zeroed: Partial<FractureOptions> = {
  stubs: false,
  bands: { tilt: 0, splitters: 1, diagonalChance: 0.35 },
  rings: { count: 3, partial: 0 },
  collapse: { merge: 0 },
};

describe('stub hairlines (render-only dead-end cracks)', () => {
  it('shards and micro are byte-identical with stubs on/off (all modes)', () => {
    for (const mode of ['title', 'radial', 'collapse'] as const) {
      for (const seed of [1, 7, 42]) {
        const on = generateFracture({ mode, width: 960, height: 540, seed });
        const off = generateFracture({ mode, width: 960, height: 540, seed, stubs: false });
        expect(JSON.stringify(on.shards)).toBe(JSON.stringify(off.shards));
        expect(JSON.stringify(on.micro)).toBe(JSON.stringify(off.micro));
      }
    }
  });

  it('stubs are appended AFTER all main cracks (prefix byte-stable)', () => {
    const on = generateFracture({ mode: 'radial', width: 960, height: 540, seed: 7 });
    const off = generateFracture({ mode: 'radial', width: 960, height: 540, seed: 7, stubs: false });
    const firstStub = on.cracks.findIndex((c) => c.kind === 'stub');
    expect(firstStub).toBeGreaterThan(0);
    expect(on.cracks.slice(firstStub).every((c) => c.kind === 'stub')).toBe(true);
    expect(JSON.stringify(on.cracks.slice(0, firstStub))).toBe(JSON.stringify(off.cracks));
  });

  it('stubs have no hackle ticks and obey the crack-timing bound', () => {
    const p = generateFracture({ mode: 'collapse', width: 960, height: 540, seed: 7 });
    const stubs = p.cracks.filter((c) => c.kind === 'stub');
    expect(stubs.length).toBeGreaterThan(0);
    for (const s of stubs) {
      expect(s.ticks).toHaveLength(0);
      expect(s.birth + s.growDuration).toBeLessThanOrEqual(0.985);
      expect(typeof s.parent).toBe('number');
    }
  });

  it('subCracks 0 silences the stub layer; default renders it', () => {
    const p = generateFracture({ mode: 'title', width: 880, height: 360, seed: 7 });
    const offFrame = computeFrame(0.9, p, { ...cracked, crackStyle: { subCracks: 0 } });
    expect(offFrame.cracks.stubPath).toBe('');
    const onFrame = computeFrame(0.9, p, cracked);
    expect(onFrame.cracks.stubPath.length).toBeGreaterThan(0);
    // and the main core path is unaffected by the gate
    expect(offFrame.cracks.corePath).toBe(onFrame.cracks.corePath);
  });
});

describe('fragmentation realism (tilt, multi-splitters, partial rings, merge)', () => {
  it('area conservation holds at maximum irregularity across seeds and modes', () => {
    for (const seed of [1, 7, 42, 9001]) {
      const cases = [
        generateFracture({
          mode: 'title',
          width: 880,
          height: 440,
          seed,
          deviation: 1,
          bands: { tilt: 1, splitters: 3, diagonalChance: 1, waviness: 1 },
        }),
        generateFracture({
          mode: 'radial',
          width: 960,
          height: 540,
          seed,
          rings: { count: 5, partial: 1 },
          impact: seed % 2 === 0 ? { x: 120, y: 90 } : undefined,
        }),
        generateFracture({ mode: 'collapse', width: 960, height: 540, seed, collapse: { merge: 0.8 } }),
      ];
      for (const p of cases) {
        const sum = p.shards.reduce((acc, s) => acc + s.area, 0);
        const area = p.width * p.height;
        expect(Math.abs(sum - area) / area, `${p.mode} seed ${seed}`).toBeLessThan(0.012);
      }
    }
  });

  it('partial rings / merge actually reduce shard counts (merging happened)', () => {
    const full = generateFracture({ mode: 'radial', width: 960, height: 540, seed: 7, rings: { count: 4, partial: 0 } });
    const part = generateFracture({ mode: 'radial', width: 960, height: 540, seed: 7, rings: { count: 4, partial: 1 } });
    expect(part.shards.length).toBeLessThan(full.shards.length);
    const m0 = generateFracture({ mode: 'collapse', width: 960, height: 540, seed: 7, collapse: { merge: 0 } });
    const m8 = generateFracture({ mode: 'collapse', width: 960, height: 540, seed: 7, collapse: { merge: 0.8 } });
    expect(m8.shards.length).toBeLessThan(m0.shards.length);
  });

  it('multi-splitters produce more title pieces with uneven sizes', () => {
    const p = generateFracture({
      mode: 'title',
      width: 880,
      height: 360,
      seed: 7,
      bands: { count: 4, splitters: 3, diagonalChance: 1 },
    });
    expect(p.shards.length).toBeGreaterThan(4);
    const areas = p.shards.map((s) => s.area).sort((a, b) => a - b);
    expect(areas[areas.length - 1] / areas[0]).toBeGreaterThan(2);
  });

  it('tilted boundaries still span the full width exactly', () => {
    const p = generateFracture({ mode: 'title', width: 800, height: 400, seed: 11, bands: { tilt: 1 } });
    for (const c of p.cracks.filter((c2) => c2.kind === 'band')) {
      const xs = [c.points[0], c.points[c.points.length - 2]].sort((a, b) => a - b);
      expect(xs[0]).toBe(0);
      expect(xs[1]).toBe(800);
    }
  });

  it('the punched crush disc survives partial rings (exactly one, never droppable)', () => {
    const p = generateFracture({ mode: 'radial', width: 960, height: 540, seed: 7, rings: { count: 5, partial: 1 } });
    expect(p.shards.filter((s) => s.ringIndex === 0)).toHaveLength(1);
  });

  it('zeroed options reproduce v0.3-shaped geometry (no merge runs, single splitters)', () => {
    const a = generateFracture({ mode: 'radial', width: 960, height: 540, seed: 7, ...zeroed });
    const b = generateFracture({ mode: 'radial', width: 960, height: 540, seed: 7, ...zeroed });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // ring cracks form full loops at partial 0: every interior ring emits exactly one 'ring' crack
    const rings = a.cracks.filter((c) => c.kind === 'ring');
    expect(rings).toHaveLength(2); // count 3 -> rings 1..2
  });
});

describe('bevel conchoidal scatter', () => {
  const pattern = generateFracture({ mode: 'radial', width: 960, height: 540, seed: 7 });

  it('scatter > 0: pairs share d, structure static across t, opacities clamped', () => {
    const f0 = computeFrame(0.5, pattern, cracked);
    const f1 = computeFrame(0.95, pattern, cracked);
    for (let i = 0; i < f0.shards.length; i++) {
      const a = f0.shards[i].bevel;
      const b = f1.shards[i].bevel;
      expect(a.length).toBe(b.length);
      expect(a.length % 2).toBe(0);
      for (let k = 0; k < a.length; k++) {
        expect(a[k].d).toBe(b[k].d);
        expect(a[k].stroke).toBe(b[k].stroke);
        expect(a[k].mixBlendMode).toBe(b[k].mixBlendMode);
        expect(a[k].opacity).toBeGreaterThanOrEqual(0);
        expect(a[k].opacity).toBeLessThanOrEqual(1);
      }
      // pairs: dark entry first (paint-order parity between tiers), same d within a pair
      for (let k = 0; k < a.length; k += 2) {
        expect(a[k].d).toBe(a[k + 1].d);
        expect(a[k].mixBlendMode).toBe('normal');
      }
    }
  });

  it('a single fracture edge run shows BOTH lit and dark segments (the photo look)', () => {
    const f = computeFrame(0.6, pattern, cracked);
    let mixed = 0;
    for (const s of f.shards) {
      const litVisible = s.bevel.some((b) => b.mixBlendMode !== 'normal' && b.opacity > 0.05);
      const darkVisible = s.bevel.some((b) => b.mixBlendMode === 'normal' && b.opacity > 0.05);
      if (litVisible && darkVisible) mixed++;
    }
    expect(mixed).toBeGreaterThan(f.shards.length * 0.5);
  });

  it('opacities are continuous around the lit/dark handoff (sweep)', () => {
    // sweep t through the shatter (spin sweeps sector angles through g=0)
    const fx: DeepPartial<EffectParams> = {
      timeline: { crackStart: 0.02, crackEnd: 0.3, shatterStart: 0.38 },
    };
    let prev: number[] | null = null;
    for (let t = 0.45; t <= 0.6; t += 0.005) {
      const f = computeFrame(t, pattern, fx);
      const ops = f.shards[3].bevel.map((b) => b.opacity);
      if (prev) {
        for (let k = 0; k < ops.length; k++) {
          expect(Math.abs(ops[k] - prev[k])).toBeLessThan(0.2);
        }
      }
      prev = ops;
    }
  });
});

describe('crack brightness modulation', () => {
  const pattern = generateFracture({ mode: 'title', width: 880, height: 360, seed: 7 });

  it('brightnessVar 0 keeps the v0.3 single-ribbon output', () => {
    const f = computeFrame(0.9, pattern, { ...cracked, crackStyle: { brightnessVar: 0 } });
    expect(f.cracks.coreDimPath).toBe('');
    expect(f.cracks.coreOpacity).toBe(1);
  });

  it('brightnessVar > 0 emits the dim underlay and ranges are static in arc length', () => {
    const a = computeFrame(0.9, pattern, cracked);
    expect(a.cracks.coreDimPath.length).toBeGreaterThan(0);
    expect(a.cracks.coreDimOpacity).toBeLessThan(1);
    // already-grown stretches never "breathe": same t twice -> byte equal (and the
    // static-timeline test in determinism.test.ts covers cross-t stability)
    const b = computeFrame(0.9, pattern, cracked);
    expect(b.cracks.corePath).toBe(a.cracks.corePath);
    expect(b.cracks.coreDimPath).toBe(a.cracks.coreDimPath);
  });
});
