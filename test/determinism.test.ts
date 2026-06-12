import { describe, expect, it } from 'vitest';
import { computeFrame, generateFracture, staticCrackedTimeline } from '../src/index';
import type { DeepPartial, EffectParams } from '../src/types';

const TS = [0, 0.5, 0.2, 0.5, 1, 0.99, 0.2, 0.38, 0.62, 0.8, 0.44, 0.05, 0.62];

describe('computeFrame referential transparency', () => {
  const pattern = generateFracture({ mode: 'radial', width: 960, height: 540, seed: 7 });
  const collapsePattern = generateFracture({ mode: 'collapse', width: 960, height: 540, seed: 7 });
  const fx: DeepPartial<EffectParams> = {
    quality: 'high',
    timeline: { crackStart: 0.02, crackEnd: 0.3, shatterStart: 0.38 },
  };

  it('identical t in any order -> byte-identical FrameData (radial and collapse)', () => {
    for (const p of [pattern, collapsePattern]) {
      const shuffled = TS.map((t) => [t, JSON.stringify(computeFrame(t, p, fx))] as const);
      const sorted = [...TS].sort().map((t) => [t, JSON.stringify(computeFrame(t, p, fx))] as const);
      const byT = new Map(sorted);
      for (const [t, json] of shuffled) {
        expect(json).toBe(byT.get(t));
      }
    }
  });

  it('repeated calls are byte-identical (no internal state drift)', () => {
    const a = JSON.stringify(computeFrame(0.42, pattern, fx));
    for (let i = 0; i < 5; i++) {
      computeFrame(Math.abs(Math.sin(i + 1)), pattern, fx); // interleave other ts
      expect(JSON.stringify(computeFrame(0.42, pattern, fx))).toBe(a);
    }
  });

  it('does not mutate the pattern or fx', () => {
    const fxLocal: DeepPartial<EffectParams> = { quality: 'normal', refraction: { offsetPx: 5 } };
    const before = JSON.stringify({ p: pattern, fx: fxLocal });
    for (const t of TS) computeFrame(t, pattern, fxLocal);
    expect(JSON.stringify({ p: pattern, fx: fxLocal })).toBe(before);
  });

  it('emits no NaN / exponent-notation / unclamped values in strings', () => {
    for (const t of [0, 0.001, 0.31, 0.38001, 0.5, 0.86, 0.999, 1]) {
      const json = JSON.stringify(computeFrame(t, pattern, fx));
      expect(json).not.toMatch(/NaN/);
      expect(json).not.toMatch(/\de[+-]\d/);
      const frame = computeFrame(t, pattern, fx);
      for (const s of frame.shards) {
        expect(s.opacity).toBeGreaterThanOrEqual(0);
        expect(s.opacity).toBeLessThanOrEqual(1);
      }
    }
  });

  it('constant frame structure across t (no DOM popping)', () => {
    const f0 = computeFrame(0, pattern, fx);
    const f1 = computeFrame(0.9, pattern, fx);
    expect(f0.shards.length).toBe(f1.shards.length);
    expect(f0.micro.length).toBe(f1.micro.length);
    expect(f0.shards.map((s) => s.id)).toEqual(f1.shards.map((s) => s.id));
  });

  it('bevel sector d-strings are static and smear/bevel array lengths constant across t', () => {
    const f0 = computeFrame(0.05, pattern, fx);
    const f1 = computeFrame(0.7, pattern, fx);
    for (let i = 0; i < f0.shards.length; i++) {
      expect(f0.shards[i].bevel.length).toBe(f1.shards[i].bevel.length);
      expect(f0.shards[i].bevel.map((b) => b.d)).toEqual(f1.shards[i].bevel.map((b) => b.d));
      expect(f0.shards[i].smear.length).toBe(f1.shards[i].smear.length);
      expect(f0.shards[i].bevel.length).toBeGreaterThan(0); // quality 'high' -> bevel on
    }
    // idle smear entries exist with opacity 0 (constant DOM), become active mid-shatter
    expect(f0.shards[0].smear.every((s) => s.opacity === 0)).toBe(true);
    const anyActive = f1.shards.some((s) => s.smear.some((sm) => sm.opacity > 0));
    expect(anyActive).toBe(true);
  });

  it('t is clamped to [0,1]', () => {
    expect(JSON.stringify(computeFrame(-5, pattern, fx))).toBe(JSON.stringify(computeFrame(0, pattern, fx)));
    expect(JSON.stringify(computeFrame(7, pattern, fx))).toBe(JSON.stringify(computeFrame(1, pattern, fx)));
  });

  it('static timeline freezes shards and cracks for any t (micro twinkle stays t-driven by design)', () => {
    const fa = computeFrame(0.1, pattern, { timeline: staticCrackedTimeline });
    const fb = computeFrame(0.9, pattern, { timeline: staticCrackedTimeline });
    expect(JSON.stringify(fa.shards)).toBe(JSON.stringify(fb.shards));
    expect(JSON.stringify(fa.cracks)).toBe(JSON.stringify(fb.cracks));
  });
});
