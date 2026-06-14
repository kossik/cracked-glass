import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { computeFrame, generateFracture, staticCrackedTimeline } from '../src/index';
import { CrackedGlass, CrackedGlassText } from '../src/react/index';
import type { DeepPartial, EffectParams, FrameData } from '../src/types';

/**
 * Glass medium: the wrapper flies, the content is counter-anchored to the pane.
 * Per adversarial review, the anchoring invariant is verified on the EMITTED transform
 * strings (parsed to matrices), not on the raw numbers that produced them.
 */

type Mat = [number, number, number, number, number, number];
const I: Mat = [1, 0, 0, 1, 0, 0];
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const T = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
const R = (deg: number): Mat => {
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
};
const S = (s: number): Mat => [s, 0, 0, s, 0, 0];
const apply = (m: Mat, p: [number, number]): [number, number] => [
  m[0] * p[0] + m[2] * p[1] + m[4],
  m[1] * p[0] + m[3] * p[1] + m[5],
];

/** Parse a CSS transform list (2D subset; throws on 3D functions). */
function parseCss(list: string): Mat {
  let m = I;
  for (const fn of list.matchAll(/([a-zA-Z]+)\(([^)]*)\)/g)) {
    const name = fn[1];
    const args = fn[2].split(/[,\s]+/).filter(Boolean).map((v) => parseFloat(v));
    if (name === 'translate') m = mul(m, T(args[0], args[1] ?? 0));
    else if (name === 'rotate') m = mul(m, R(args[0]));
    else if (name === 'scale') m = mul(m, S(args[0]));
    else throw new Error(`3D/unknown function in emitted string: ${name}`);
  }
  return m;
}

/** Parse an SVG transform list (translate / scale / rotate with optional pivot). */
function parseSvg(list: string): Mat {
  let m = I;
  for (const fn of list.matchAll(/([a-zA-Z]+)\(([^)]*)\)/g)) {
    const name = fn[1];
    const args = fn[2].split(/[,\s]+/).filter(Boolean).map((v) => parseFloat(v));
    if (name === 'translate') m = mul(m, T(args[0], args[1] ?? 0));
    else if (name === 'scale') m = mul(m, S(args[0]));
    else if (name === 'rotate') {
      if (args.length === 3) m = mul(mul(mul(m, T(args[1], args[2])), R(args[0])), T(-args[1], -args[2]));
      else m = mul(m, R(args[0]));
    } else throw new Error(`unknown SVG function: ${name}`);
  }
  return m;
}

const parseOrigin = (origin: string): [number, number] => {
  const m = origin.match(/(-?[\d.]+)px (-?[\d.]+)px/);
  return [parseFloat(m![1]), parseFloat(m![2])];
};

/** Screen matrix of an HTML element: transform conjugated by its transform-origin. */
const cssScreenMat = (list: string, origin: [number, number]): Mat =>
  mul(mul(T(origin[0], origin[1]), parseCss(list)), T(-origin[0], -origin[1]));

const CORNERS: Array<[number, number]> = [
  [0, 0],
  [960, 0],
  [960, 540],
  [0, 540],
];

/** fx that keeps everything 2D-parseable (no perspective tilt) and markup minimal. */
const flatGlassFx = (extra: DeepPartial<EffectParams> = {}): DeepPartial<EffectParams> => ({
  medium: 'glass',
  refraction: { tiltDeg: 0 },
  edgeDistortion: { strength: 0 },
  spectrum: { count: 0 },
  ...extra,
});

const heroPattern = generateFracture({ mode: 'hero', width: 960, height: 540, seed: 7 });
const radialPattern = generateFracture({ mode: 'radial', width: 960, height: 540, seed: 7 });

function assertAnchored(frame: FrameData, maxErrPx: number) {
  for (const s of frame.shards) {
    const g = s.raw.glass!;
    expect(g).not.toBeNull();
    const origin = parseOrigin(s.transformOrigin);
    const W = cssScreenMat(s.shardTransform, origin);
    const C = cssScreenMat(s.contentTransform, origin);
    const WC = mul(W, C);
    // target: refraction conjugated about the FLOWN centroid
    const rf = s.raw.refraction;
    const flown: [number, number] = [origin[0] + g.dx, origin[1] + g.dy];
    const target = mul(
      mul(T(flown[0], flown[1]), mul(mul(T(rf.dx, rf.dy), R(rf.rot)), S(rf.scale))),
      T(-flown[0], -flown[1]),
    );
    for (const corner of CORNERS) {
      const a = apply(WC, corner);
      const b = apply(target, corner);
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(maxErrPx);
    }
  }
}

describe('glass anchoring invariant (emitted HTML strings)', () => {
  it('hero levitation: content stays pinned to the pane while the lens drifts', () => {
    for (const t of [0.1, 0.25, 0.5, 0.85]) {
      const f = computeFrame(t, heroPattern, flatGlassFx({ timeline: staticCrackedTimeline }));
      assertAnchored(f, 0.12);
    }
  });

  it('radial mid-shatter: anchoring holds at full flight distance (no tumble in glass)', () => {
    for (const t of [0.55, 0.7, 0.85]) {
      const f = computeFrame(t, radialPattern, flatGlassFx());
      assertAnchored(f, 0.12);
      for (const s of f.shards) {
        expect(s.shardTransform).not.toContain('perspective');
        expect(s.raw.rigid.rotX).toBe(0);
        expect(s.raw.rigid.rotY).toBe(0);
      }
    }
  });

  it('punch window: the inverse scale stays bounded (symmetric clamp)', () => {
    const fx = flatGlassFx({ crush: { punch: true, scaleTo: 0.01 } });
    for (const t of [0.2, 0.3, 0.38, 0.45]) {
      const f = computeFrame(t, radialPattern, fx);
      for (const s of f.shards) {
        expect(s.raw.glass!.scale).toBeGreaterThanOrEqual(0.05);
      }
      assertAnchored(f, 0.5); // clamp window tolerates a larger (still bounded) residual
    }
  });
});

describe('glass anchoring invariant (emitted SVG strings)', () => {
  it('SVG wrapper * content cancels to refraction about the flown centroid', () => {
    const fx = flatGlassFx({ timeline: staticCrackedTimeline });
    const t = 0.3;
    const markup = renderToStaticMarkup(
      <CrackedGlassText t={t} pattern={heroPattern} fx={fx} text="GLASS" />,
    );
    const frame = computeFrame(t, heroPattern, fx);
    const wrappers = [...markup.matchAll(/<g clip-path="url\(#[^"]*-clip(\d+)\)" transform="([^"]+)"/g)];
    expect(wrappers.length).toBe(heroPattern.shards.length);
    for (const wm of wrappers) {
      const i = Number(wm[1]);
      const block = markup.slice(wm.index!, markup.indexOf('</g></g>', wm.index!));
      const inner = [...block.matchAll(/<g transform="([^"]+)"><use/g)];
      expect(inner.length).toBeGreaterThan(0);
      const W = parseSvg(wm[2]);
      const C = parseSvg(inner[inner.length - 1][1]);
      const WC = mul(W, C);
      const s = frame.shards[i];
      const g = s.raw.glass!;
      const origin = parseOrigin(s.transformOrigin);
      const rf = s.raw.refraction;
      const flown: [number, number] = [origin[0] + g.dx, origin[1] + g.dy];
      const target = mul(
        mul(T(flown[0], flown[1]), mul(mul(T(rf.dx, rf.dy), R(rf.rot)), S(rf.scale))),
        T(-flown[0], -flown[1]),
      );
      for (const corner of CORNERS) {
        const a = apply(WC, corner);
        const b = apply(target, corner);
        expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(0.2);
      }
    }
  });
});

describe('glass structure', () => {
  const fx = flatGlassFx({ timeline: staticCrackedTimeline });

  it('smear entries are inert and motion ghosts are off', () => {
    const f = computeFrame(0.6, radialPattern, flatGlassFx());
    for (const s of f.shards) {
      for (const sm of s.smear) expect(sm.opacity).toBe(0);
      expect(s.ghosts.length).toBe(0);
    }
  });

  it('HTML tier renders a base content layer under the pane (glass only)', () => {
    const glassMarkup = renderToStaticMarkup(
      <CrackedGlass t={0.5} pattern={heroPattern} fx={fx}>
        <span data-probe>content</span>
      </CrackedGlass>,
    );
    const contentMarkup = renderToStaticMarkup(
      <CrackedGlass t={0.5} pattern={heroPattern} fx={{ ...fx, medium: 'content' }}>
        <span data-probe>content</span>
      </CrackedGlass>,
    );
    // glass: one extra clone (the base layer) vs content mode
    const count = (s: string) => (s.match(/data-probe/g) ?? []).length;
    expect(count(glassMarkup)).toBe(count(contentMarkup) + 1);
  });

  it('DOM shape is constant across t in glass mode', () => {
    const shape = (t: number) =>
      renderToStaticMarkup(
        <CrackedGlass t={t} pattern={radialPattern} fx={flatGlassFx()}>
          <span>x</span>
        </CrackedGlass>,
      ).replace(/[^<]+|"[^"]*"/g, ''); // tags only, attribute values stripped
    const ref = shape(0);
    for (const t of [0.2, 0.45, 0.7, 1]) expect(shape(t)).toBe(ref);
  });
});

describe('glass ghost chroma screen axis (tier parity)', () => {
  // The HTML ghost translate lands in SCREEN space (the inverse cancels the wrapper spin),
  // so its on-screen dispersion axis must match the SVG tier: feOffset(chromaDx,chromaDy)
  // mapped by the rigid rotation => screen angle = rigidRot + (angleDeg - live*rigidRot).
  const angleDeg = (x: number, y: number) => (Math.atan2(y, x) * 180) / Math.PI;

  it('HTML ghost dispersion axis matches the SVG-tier law at trackLight on/off', () => {
    for (const live of [false, true]) {
      const fx: DeepPartial<EffectParams> = {
        medium: 'glass',
        refraction: { tiltDeg: 0 },
        chroma: { mode: 'ghost', offsetPx: 4, angleDeg: 14 },
        optics: { trackLight: live },
        timeline: staticCrackedTimeline,
      };
      const f = computeFrame(0.3, heroPattern, fx);
      for (const s of f.shards) {
        if (s.chroma.length < 2) continue;
        const rot = s.raw.rigid.rotZ;
        const origin = parseOrigin(s.transformOrigin);
        const W = cssScreenMat(s.shardTransform, origin);
        // screen positions of the two ghost origins (the leading translate of each clone)
        const p0 = apply(mul(W, cssScreenMat(s.chroma[0].transform, origin)), origin);
        const p1 = apply(mul(W, cssScreenMat(s.chroma[1].transform, origin)), origin);
        const screenAxis = angleDeg(p0[0] - p1[0], p0[1] - p1[1]);
        // SVG-tier law: rigidRot + angleDeg - live*rigidRot
        const expected = rot + 14 - (live ? rot : 0);
        const d = ((screenAxis - expected + 540) % 360) - 180;
        expect(Math.abs(d)).toBeLessThan(0.5);
      }
    }
  });
});

describe('trackLight', () => {
  const base = { timeline: staticCrackedTimeline, settle: { amplitudePx: 0 } } as const;

  it('counter-rotates facet, chroma and spectrum by the shard spin', () => {
    // hero float gives a nonzero rigidRot at t=0.25
    const off = computeFrame(0.25, heroPattern, { ...base });
    const on = computeFrame(0.25, heroPattern, { ...base, optics: { trackLight: true } });
    for (let i = 0; i < off.shards.length; i++) {
      const rot = off.shards[i].raw.rigid.rotZ;
      if (Math.abs(rot) < 0.05) continue;
      // facet angle counter-rotated
      const dFacet = on.shards[i].raw.facetAngleDeg - off.shards[i].raw.facetAngleDeg;
      expect(dFacet).toBeCloseTo(-rot, 6);
      // chroma axis counter-rotated by the same amount
      const angle = (x: number, y: number) => (Math.atan2(y, x) * 180) / Math.PI;
      const a0 = angle(off.shards[i].raw.chromaDx, off.shards[i].raw.chromaDy);
      const a1 = angle(on.shards[i].raw.chromaDx, on.shards[i].raw.chromaDy);
      const dChroma = ((a1 - a0 + 540) % 360) - 180;
      expect(dChroma).toBeCloseTo(-rot, 4);
      const sp0 = off.shards[i].spectrum;
      const sp1 = on.shards[i].spectrum;
      if (sp0 && sp1) expect(sp1.angleDeg - sp0.angleDeg).toBeCloseTo(-rot, 6);
    }
  });

  it('brightness responds to rotation only when tracking', () => {
    const off1 = computeFrame(0.1, heroPattern, { ...base });
    const off2 = computeFrame(0.4, heroPattern, { ...base });
    const on1 = computeFrame(0.1, heroPattern, { ...base, optics: { trackLight: true } });
    const on2 = computeFrame(0.4, heroPattern, { ...base, optics: { trackLight: true } });
    // static lighting: brightness identical across t once cracked
    expect(off1.shards[0].raw.brightness).toBe(off2.shards[0].raw.brightness);
    // tracking: the rocking shard sweeps the light -> brightness varies with t
    expect(on1.shards[0].raw.brightness).not.toBe(on2.shards[0].raw.brightness);
  });
});

describe('byte anchors (medium/trackLight defaults reproduce v0.4 output)', () => {
  it('explicit defaults are byte-identical to omitted params', () => {
    for (const t of [0.2, 0.62, 0.9]) {
      const a = computeFrame(t, radialPattern, {});
      const b = computeFrame(t, radialPattern, { medium: 'content', optics: { trackLight: false } });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('HTML markup is byte-identical at anchor values', () => {
    const render = (fx: DeepPartial<EffectParams>) =>
      renderToStaticMarkup(
        <CrackedGlass t={0.62} pattern={radialPattern} fx={fx}>
          <span>x</span>
        </CrackedGlass>,
      );
    expect(render({ medium: 'content', optics: { trackLight: false } })).toBe(render({}));
  });

  it('SVG-tier markup is byte-identical at anchor values (guards the anchor ternaries)', () => {
    const render = (fx: DeepPartial<EffectParams>) =>
      renderToStaticMarkup(
        <CrackedGlassText t={0.62} pattern={radialPattern} fx={{ ...fx, quality: 'high' }} text="X" />,
      );
    expect(render({ medium: 'content', optics: { trackLight: false } })).toBe(render({}));
  });

  it('glass frames are deterministic in any call order', () => {
    const fx = flatGlassFx();
    const ts = [0.8, 0.2, 0.5, 0.2, 0.8];
    const runs = ts.map((t) => JSON.stringify(computeFrame(t, radialPattern, fx)));
    expect(runs[1]).toBe(runs[3]);
    expect(runs[0]).toBe(runs[4]);
  });
});
