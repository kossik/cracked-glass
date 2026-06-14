/** Scene registry: composition (underlay + glass), fracture options and scene-default fx. */
import type { FC, ReactNode } from 'react';
import {
  collapseShatterPreset,
  staticCrackedTimeline,
  type DeepPartial,
  type EffectParams,
  type FractureOptions,
  type FracturePattern,
} from 'cracked-glass';
import { CrackedGlass } from 'cracked-glass/react';
import type { SceneId } from './state';
import { deepMerge } from './state';

export interface SceneRenderProps {
  t: number;
  pattern: FracturePattern;
  fx: DeepPartial<EffectParams>;
  debug: boolean;
}

export interface SceneDef {
  id: SceneId;
  label: string;
  defaultT: number;
  defaultZoom: number;
  /** Default magnifier pan, % of stage size (lands the macro window on a shard edge). */
  defaultPanX?: number;
  defaultPanY?: number;
  /** Base fracture options; flat 'fr.*' overrides are deep-merged on top. */
  makeOptions(seed: number, fr: Record<string, unknown>): FractureOptions;
  /** Scene-default fx (user param overrides are deep-merged on top). */
  baseFx(): DeepPartial<EffectParams>;
  Render: FC<SceneRenderProps>;
}

const STAGE_W = 960;
const STAGE_H = 540;

const noOutliers = { dropFraction: 0, slipFraction: 0, rebelFraction: 0 } as const;

const heroFx = (): DeepPartial<EffectParams> => ({
  timeline: staticCrackedTimeline,
  // Glass medium: the shard is a lens floating over the page - the content stays
  // anchored to the pane while the silhouette drifts. trackLight keeps the facet
  // highlight, chroma axis and flare pointed at the global light as the lens rocks.
  medium: 'glass',
  optics: { trackLight: true },
  outliers: { ...noOutliers },
  refraction: { offsetPx: 10, tiltDeg: 2.2, scaleAmp: 0.03 },
  chroma: { offsetPx: 3.2 },
  facet: { strength: 0.45, opacity: 0.38 },
  bevel: { intensity: 0.85 },
  // M2 single-shard optics: prism rim + edge-hugging spectral flare.
  edgeDistortion: { strength: 0.7, widthPx: 12 },
  spectrum: { count: 1, opacity: 0.32, bandWidth: 0.5, edgeOnly: 1 },
});

const heroOptions = (
  seed: number,
  fr: Record<string, unknown>,
  hero: NonNullable<FractureOptions['hero']>,
): FractureOptions =>
  deepMerge(
    { mode: 'hero', width: STAGE_W, height: STAGE_H, seed, hero } as unknown as Record<string, unknown>,
    fr,
  ) as unknown as FractureOptions;

function HeroScene({ t, pattern, fx, debug }: SceneRenderProps): ReactNode {
  // No sibling underlay: in the glass medium the component renders its own base content
  // layer under the pane; switching the medium control to 'content' then shows the other
  // philosophy literally - the content itself is broken and nothing remains underneath.
  return (
    <CrackedGlass t={t} pattern={pattern} fx={fx} debug={debug} style={{ position: 'absolute', inset: 0 }}>
      <HeroUnderlay />
    </CrackedGlass>
  );
}

function TransitionScene({ t, pattern, fx, debug }: SceneRenderProps): ReactNode {
  return (
    <>
      <ScreenB />
      <CrackedGlass t={t} pattern={pattern} fx={fx} debug={debug} style={{ position: 'absolute', inset: 0 }}>
        <ScreenA />
      </CrackedGlass>
    </>
  );
}

function TitleScene({ t, pattern, fx, debug }: SceneRenderProps): ReactNode {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
      <div className="title-block">
        <CrackedGlass t={t} pattern={pattern} fx={fx} debug={debug}>
          <div className="title-content">
            <p className="big">
              CRACKED
              <br />
              GLASS
            </p>
            <p className="sub">deterministic · pure function of t</p>
          </div>
        </CrackedGlass>
      </div>
    </div>
  );
}

export const SCENES: SceneDef[] = [
  {
    id: 'hero-1',
    label: 'Hero — single floating shard over text',
    defaultT: 0.5,
    defaultZoom: 1,
    makeOptions: (seed, fr) => heroOptions(seed, fr, { count: 1 }),
    baseFx: heroFx,
    Render: HeroScene,
  },
  {
    id: 'hero-2',
    label: 'Hero — two stacked shards over text',
    defaultT: 0.5,
    defaultZoom: 1,
    makeOptions: (seed, fr) => heroOptions(seed, fr, { count: 2, overlap: 0.35, sizeFrac: 0.28 }),
    baseFx: heroFx,
    Render: HeroScene,
  },
  {
    id: 'macro-edge',
    label: 'Macro — edge close-up (zoomed hero)',
    defaultT: 0.5,
    defaultZoom: 4,
    defaultPanX: 21,
    defaultPanY: 0,
    makeOptions: (seed, fr) => heroOptions(seed, fr, { count: 1, sizeFrac: 0.4 }),
    baseFx: () => deepMerge(heroFx() as Record<string, unknown>, { float: { bobPx: 3, swayPx: 2, rotDeg: 0.8 } }) as DeepPartial<EffectParams>,
    Render: HeroScene,
  },
  {
    id: 'radial',
    label: 'Radial — screen transition',
    defaultT: 0.45,
    defaultZoom: 1,
    makeOptions: (seed, fr) =>
      deepMerge(
        {
          mode: 'radial',
          width: STAGE_W,
          height: STAGE_H,
          seed,
          impact: { x: 430, y: 250 },
          rays: { count: 8 },
          rings: { count: 4 },
        } as unknown as Record<string, unknown>,
        fr,
      ) as unknown as FractureOptions,
    baseFx: () => ({
      timeline: { crackStart: 0.02, crackEnd: 0.3, shatterStart: 0.38 },
      shatter: { speed: 1550, gravity: [0, 420] as const, drag: 1.25, staggerPerRing: 0.045 },
      refraction: { offsetPx: 7 },
      chroma: { mode: 'ghost', offsetPx: 3.4 },
      facet: { strength: 0.5, opacity: 0.5 },
      bevel: { intensity: 0.85, glintStrength: 0.9 },
    }),
    Render: TransitionScene,
  },
  {
    id: 'horizontal',
    label: 'Horizontal — title bands',
    defaultT: 0.5,
    defaultZoom: 1,
    makeOptions: (seed, fr) =>
      deepMerge(
        {
          mode: 'title',
          width: 880,
          height: 360,
          seed,
          bands: { count: [3, 5] },
        } as unknown as Record<string, unknown>,
        fr,
      ) as unknown as FractureOptions,
    baseFx: () => ({
      timeline: { crackStart: 0.05, crackEnd: 0.4, shatterStart: 0.55 },
      outliers: { dropFraction: 0.18, slipFraction: 0.25 },
    }),
    Render: TitleScene,
  },
  {
    id: 'diagonal',
    label: 'Diagonal — collapse crumble',
    defaultT: 0.5,
    defaultZoom: 1,
    makeOptions: (seed, fr) =>
      deepMerge(
        { mode: 'collapse', width: STAGE_W, height: STAGE_H, seed } as unknown as Record<string, unknown>,
        fr,
      ) as unknown as FractureOptions,
    baseFx: () => ({
      timeline: { crackStart: 0.02, crackEnd: 0.28, shatterStart: 0.34 },
      shatter: { ...collapseShatterPreset, fadeOut: [0.92, 1] as [number, number] },
      bevel: { intensity: 0.75 },
    }),
    Render: TransitionScene,
  },
];

export const sceneById = (id: SceneId): SceneDef => SCENES.find((s) => s.id === id) ?? SCENES[0];

/* ---------------- underlays ---------------- */

/** Text content the hero shard levitates over: fine ruled lines make refraction readable. */
function HeroUnderlay(): ReactNode {
  return (
    <div className="hero-under" aria-hidden>
      <span className="kicker">specimen 01 — float study</span>
      <h2 className="hero-word">FRACTURE</h2>
      <p className="hero-body">
        A shard of glass drifts over this paragraph: the silhouette moves, but the page
        seen through it stays anchored - only the refraction field travels with the lens.
        Watch the rim: the broken faces bend the text hardest, catch the light, and throw
        a narrow spectral flare along the lit edge.
      </p>
      <div className="hero-rules" />
    </div>
  );
}

function ScreenA(): ReactNode {
  return (
    <div className="screen a">
      <span className="kicker">Screen A — current</span>
      <h2 className="headline">
        Everything you
        <br />
        ship, verified.
      </h2>
      <div className="cards">
        <div className="card">
          <b>99.98%</b> uptime across regions
        </div>
        <div className="card">
          <b>1.2s</b> median build time
        </div>
        <div className="card">
          <b>48</b> active pipelines
        </div>
      </div>
    </div>
  );
}

function ScreenB(): ReactNode {
  return (
    <div className="screen b">
      <span className="kicker">Screen B — next</span>
      <h2 className="headline">
        Welcome to the
        <br />
        other side.
      </h2>
      <div className="cards">
        <div className="card">
          <b>→</b> revealed by the shatter transition
        </div>
      </div>
    </div>
  );
}
