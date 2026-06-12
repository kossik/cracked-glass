import { describe, expect, it } from 'vitest';
import { computeFrame, generateFracture, staticCrackedTimeline } from '../src/index';
import { assignOutliers } from '../src/motion/kinematics';
import { normalizeEffectParams } from '../src/render/params';
import type { DeepPartial, EffectParams } from '../src/types';

const cracked: DeepPartial<EffectParams> = { timeline: staticCrackedTimeline };

describe('punched impact center (radial)', () => {
  const pattern = generateFracture({ mode: 'radial', width: 960, height: 540, seed: 7 });
  const crushIdx = pattern.shards.findIndex((s) => s.ringIndex === 0);

  it('exactly one crush shard exists', () => {
    expect(pattern.shards.filter((s) => s.ringIndex === 0)).toHaveLength(1);
  });

  it('the pane is intact before cracking and punched through after', () => {
    const intact = computeFrame(0, pattern, { timeline: { crackStart: 0.1, crackEnd: 0.4, shatterStart: 0.6 } });
    expect(intact.shards[crushIdx].opacity).toBe(1);
    const crackedFrame = computeFrame(0.5, pattern, cracked);
    expect(crackedFrame.shards[crushIdx].opacity).toBeLessThan(0.01);
    // and the plug shrank + sank
    expect(crackedFrame.shards[crushIdx].raw.rigid.scale).toBeLessThan(0.95);
  });

  it('crush.punch: false keeps the v0.2 look', () => {
    const f = computeFrame(0.5, pattern, { ...cracked, crush: { punch: false } });
    expect(f.shards[crushIdx].opacity).toBe(1);
    expect(f.shards[crushIdx].raw.rigid.scale).toBe(1);
  });

  it('sparkle dies with the punch (it must not glow over the hole)', () => {
    const withPunch = computeFrame(0.5, pattern, cracked);
    const without = computeFrame(0.5, pattern, { ...cracked, crush: { punch: false } });
    expect(withPunch.cracks.sparkle!.opacity).toBeLessThan(0.01);
    expect(without.cracks.sparkle!.opacity).toBeGreaterThan(0.5);
  });

  it('impactHole scales the crush disc geometry', () => {
    const small = generateFracture({ mode: 'radial', width: 960, height: 540, seed: 7, impactHole: 0.5 });
    const big = generateFracture({ mode: 'radial', width: 960, height: 540, seed: 7, impactHole: 2 });
    const a = small.shards.find((s) => s.ringIndex === 0)!.area;
    const b = big.shards.find((s) => s.ringIndex === 0)!.area;
    expect(b).toBeGreaterThan(a * 4);
  });
});

describe('outlier shards (system + exceptions)', () => {
  const pattern = generateFracture({ mode: 'collapse', width: 960, height: 540, seed: 7 });

  it('classification agrees between style and motion layers and is deterministic', () => {
    const fx = normalizeEffectParams({});
    const a = assignOutliers(pattern, fx.outliers);
    const b = assignOutliers(pattern, fx.outliers);
    expect(a).toEqual(b);
  });

  it('dropFraction 1 makes every shard fall out of the cracked state', () => {
    const f = computeFrame(0.6, pattern, {
      ...cracked,
      outliers: { dropFraction: 1, slipFraction: 0, rebelFraction: 0 },
    });
    for (const s of f.shards) expect(s.opacity).toBeLessThan(0.01);
  });

  it('slipFraction 1 visibly displaces every shard rigidly in the cracked state', () => {
    const f = computeFrame(0.6, pattern, {
      ...cracked,
      outliers: { dropFraction: 0, slipFraction: 1, rebelFraction: 0, slipPx: 10 },
    });
    for (const s of f.shards) {
      const d = Math.hypot(s.raw.rigid.dx, s.raw.rigid.dy);
      expect(d).toBeGreaterThan(3);
      expect(s.opacity).toBe(1);
    }
  });

  it('small patterns are guaranteed at least one exception', () => {
    // tiny fractions would normally yield zero outliers on a 4-6 shard title
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const p = generateFracture({ mode: 'title', width: 800, height: 400, seed, bands: { count: 4, diagonalChance: 0 } });
      const fx = normalizeEffectParams({ outliers: { dropFraction: 0.001, slipFraction: 0.001, rebelFraction: 0.001 } });
      const kinds = assignOutliers(p, fx.outliers);
      expect(kinds.some((k) => k !== 'none')).toBe(true);
    }
  });

  it('zero fractions mean zero outliers (and no guarantee promotion)', () => {
    const fx = normalizeEffectParams({ outliers: { dropFraction: 0, slipFraction: 0, rebelFraction: 0 } });
    const kinds = assignOutliers(pattern, fx.outliers);
    expect(kinds.every((k) => k === 'none')).toBe(true);
  });

  it('the radial crush disc is never an outlier (the punch owns it)', () => {
    const rp = generateFracture({ mode: 'radial', width: 960, height: 540, seed: 7 });
    const fx = normalizeEffectParams({ outliers: { dropFraction: 1, slipFraction: 0, rebelFraction: 0 } });
    const kinds = assignOutliers(rp, fx.outliers);
    const crushIdx = rp.shards.findIndex((s) => s.ringIndex === 0);
    expect(kinds[crushIdx]).toBe('none');
  });
});

describe('spectral dispersion flare', () => {
  const pattern = generateFracture({ mode: 'radial', width: 960, height: 540, seed: 7 });

  it('exactly spectrum.count shards carry the flare, selection identical across t', () => {
    const sel = (t: number) =>
      computeFrame(t, pattern, cracked)
        .shards.map((s, i) => (s.spectrum ? i : -1))
        .filter((i) => i >= 0);
    const s0 = sel(0.05);
    expect(s0).toHaveLength(2);
    for (const t of [0, 0.3, 0.62, 0.9, 1]) {
      expect(sel(t)).toEqual(s0);
    }
  });

  it('flare geometry is light-driven: rotating the light moves the band', () => {
    const a = computeFrame(0.6, pattern, { ...cracked, optics: { lightAngleDeg: -60 } });
    const b = computeFrame(0.6, pattern, { ...cracked, optics: { lightAngleDeg: 45 } });
    const specA = a.shards.find((s) => s.spectrum)!.spectrum!;
    const specB = b.shards.find((s) => s.spectrum)!.spectrum!;
    expect(specA.angleDeg).toBe(-60);
    expect(specB.angleDeg).toBe(45);
    expect(specA.background).toContain('linear-gradient(30deg'); // -60 + 90
  });

  it('the crush disc and slivers never win a spectral slot', () => {
    const f = computeFrame(0.6, pattern, cracked);
    const minArea = 0.02 * 960 * 540;
    for (let i = 0; i < f.shards.length; i++) {
      if (f.shards[i].spectrum) {
        expect(pattern.shards[i].area).toBeGreaterThanOrEqual(minArea);
      }
    }
  });

  it('count 0 or draft quality disables the layer entirely', () => {
    const none = computeFrame(0.6, pattern, { ...cracked, spectrum: { count: 0 } });
    expect(none.shards.every((s) => s.spectrum === null)).toBe(true);
    const draft = computeFrame(0.6, pattern, { ...cracked, quality: 'draft' });
    expect(draft.shards.every((s) => s.spectrum === null)).toBe(true);
  });
});

describe('bevel double entries', () => {
  const pattern = generateFracture({ mode: 'radial', width: 960, height: 540, seed: 7 });
  // lit/dark exclusivity is the v0.3 single-light law: it only holds at scatter 0
  // (with conchoidal scatter both members of a pair are visible simultaneously by design)
  const cracked: DeepPartial<EffectParams> = { timeline: staticCrackedTimeline, bevel: { scatter: 0 } };

  it('static structure: d/stroke/blend constant across t, opacities <= 1, lit/dark exclusive', () => {
    const f0 = computeFrame(0.5, pattern, cracked);
    const f1 = computeFrame(0.95, pattern, { ...cracked });
    for (let i = 0; i < f0.shards.length; i++) {
      const a = f0.shards[i].bevel;
      const b = f1.shards[i].bevel;
      expect(a.length).toBe(b.length);
      expect(a.length % 2).toBe(0);
      for (let k = 0; k < a.length; k++) {
        expect(a[k].d).toBe(b[k].d);
        expect(a[k].stroke).toBe(b[k].stroke);
        expect(a[k].mixBlendMode).toBe(b[k].mixBlendMode);
        expect(a[k].opacity).toBeLessThanOrEqual(1);
        expect(a[k].opacity).toBeGreaterThanOrEqual(0);
      }
      // paired entries: at most one of (lit, dark) visible at a time
      for (let k = 0; k < a.length; k += 2) {
        expect(Math.min(a[k].opacity, a[k + 1].opacity)).toBe(0);
      }
    }
  });
});
