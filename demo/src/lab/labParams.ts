/**
 * Control registry: every knob the lab exposes, with ranges, grouping and scene visibility.
 * Keys are flat paths: 'fx.*' merges into EffectParams overrides, 'fr.*' into FractureOptions.
 */
import type { SceneId } from './state';

export interface ParamDef {
  key: string;
  label: string;
  group: string;
  kind: 'range' | 'select' | 'toggle';
  min?: number;
  max?: number;
  step?: number;
  options?: readonly string[];
  /** Default shown when the user has not overridden the param (display only). */
  def: number | string | boolean;
  /** Visible only in these scenes (undefined = all scenes). */
  scenes?: SceneId[];
  /** Randomizer range override (defaults to [min, max]). */
  dice?: [number, number];
}

const HERO: SceneId[] = ['hero-1', 'hero-2', 'macro-edge'];
const PARTITION: SceneId[] = ['radial', 'horizontal', 'diagonal'];
const ANIMATED: SceneId[] = ['radial', 'horizontal', 'diagonal'];

export const PARAM_DEFS: ParamDef[] = [
  // --- medium & lighting model ---
  { key: 'fx.medium', label: 'medium', group: 'Mode', kind: 'select', options: ['content', 'glass'], def: 'content' },
  { key: 'fx.optics.trackLight', label: 'track light', group: 'Mode', kind: 'toggle', def: false },

  // --- fracture geometry ---
  { key: 'fr.jaggedness', label: 'jaggedness', group: 'Fracture', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.5 },
  { key: 'fr.edgeDetail', label: 'edge detail', group: 'Fracture', kind: 'range', min: 0, max: 3, step: 1, def: 2 },
  { key: 'fr.deviation', label: 'deviation', group: 'Fracture', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.35, scenes: PARTITION },
  { key: 'fr.corners.relief', label: 'corner relief', group: 'Fracture', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.55, scenes: PARTITION },
  { key: 'fr.hero.sizeFrac', label: 'shard size', group: 'Fracture', kind: 'range', min: 0.1, max: 0.48, step: 0.01, def: 0.34, scenes: HERO },
  { key: 'fr.hero.spread', label: 'spread', group: 'Fracture', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.5, scenes: ['hero-2'] },
  { key: 'fr.hero.overlap', label: 'overlap', group: 'Fracture', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.35, scenes: ['hero-2'] },
  { key: 'fr.rays.count', label: 'rays', group: 'Fracture', kind: 'range', min: 4, max: 16, step: 1, def: 8, scenes: ['radial'] },
  { key: 'fr.rings.count', label: 'rings', group: 'Fracture', kind: 'range', min: 1, max: 7, step: 1, def: 4, scenes: ['radial'] },
  { key: 'fr.rings.partial', label: 'partial rings', group: 'Fracture', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.8, scenes: ['radial'] },
  { key: 'fr.impactHole', label: 'impact hole', group: 'Fracture', kind: 'range', min: 0.3, max: 3, step: 0.05, def: 1, scenes: ['radial'] },
  { key: 'fr.bands.tilt', label: 'band tilt', group: 'Fracture', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.6, scenes: ['horizontal'] },
  { key: 'fr.bands.splitters', label: 'splitters', group: 'Fracture', kind: 'range', min: 1, max: 3, step: 1, def: 3, scenes: ['horizontal'] },
  { key: 'fr.bands.waviness', label: 'waviness', group: 'Fracture', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.5, scenes: ['horizontal'] },
  { key: 'fr.bands.diagonalChance', label: 'diag chance', group: 'Fracture', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.6, scenes: ['horizontal'] },
  { key: 'fr.collapse.merge', label: 'merge', group: 'Fracture', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.3, scenes: ['diagonal'] },
  { key: 'fr.collapse.waviness', label: 'waviness', group: 'Fracture', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.5, scenes: ['diagonal'] },
  { key: 'fr.collapse.angleA', label: 'angle A', group: 'Fracture', kind: 'range', min: -10, max: 45, step: 1, def: 14, scenes: ['diagonal'] },
  { key: 'fr.collapse.angleB', label: 'angle B', group: 'Fracture', kind: 'range', min: 50, max: 110, step: 1, def: 76, scenes: ['diagonal'] },

  // --- light ---
  { key: 'fx.optics.lightAngleDeg', label: 'light angle', group: 'Light', kind: 'range', min: -180, max: 180, step: 1, def: -60 },
  { key: 'fx.optics.brightnessAmp', label: 'brightness amp', group: 'Light', kind: 'range', min: 0, max: 0.4, step: 0.01, def: 0.13 },
  { key: 'fx.optics.contrastAmp', label: 'contrast amp', group: 'Light', kind: 'range', min: 0, max: 0.3, step: 0.01, def: 0.07 },
  { key: 'fx.optics.blurPx', label: 'content blur', group: 'Light', kind: 'range', min: 0, max: 3, step: 0.05, def: 0.5 },

  // --- refraction ---
  { key: 'fx.refraction.offsetPx', label: 'offset px', group: 'Refraction', kind: 'range', min: 0, max: 24, step: 0.5, def: 6 },
  { key: 'fx.refraction.rotateDeg', label: 'rotate deg', group: 'Refraction', kind: 'range', min: 0, max: 4, step: 0.05, def: 0.9 },
  { key: 'fx.refraction.scaleAmp', label: 'scale amp', group: 'Refraction', kind: 'range', min: 0, max: 0.08, step: 0.002, def: 0.016 },
  { key: 'fx.refraction.tiltDeg', label: 'tilt deg', group: 'Refraction', kind: 'range', min: 0, max: 6, step: 0.1, def: 1.6 },

  // --- edge refraction ring ---
  { key: 'fx.edgeDistortion.strength', label: 'strength', group: 'Edge', kind: 'range', min: 0, max: 1, step: 0.01, def: 0 },
  { key: 'fx.edgeDistortion.widthPx', label: 'width px', group: 'Edge', kind: 'range', min: 2, max: 30, step: 0.5, def: 10 },
  { key: 'fx.edgeDistortion.blurPx', label: 'blur px', group: 'Edge', kind: 'range', min: 0, max: 3, step: 0.05, def: 0.6 },

  // --- chroma ---
  { key: 'fx.chroma.mode', label: 'mode', group: 'Chroma', kind: 'select', options: ['shadow', 'ghost', 'none'], def: 'shadow' },
  { key: 'fx.chroma.offsetPx', label: 'offset px', group: 'Chroma', kind: 'range', min: 0, max: 10, step: 0.1, def: 2.6 },
  { key: 'fx.chroma.angleDeg', label: 'angle', group: 'Chroma', kind: 'range', min: -180, max: 180, step: 1, def: 14 },
  { key: 'fx.chroma.opacity', label: 'opacity', group: 'Chroma', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.5 },

  // --- facet & bevel ---
  { key: 'fx.facet.strength', label: 'facet strength', group: 'Facet & Bevel', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.55 },
  { key: 'fx.facet.opacity', label: 'facet opacity', group: 'Facet & Bevel', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.55 },
  { key: 'fx.bevel.widthPx', label: 'bevel width', group: 'Facet & Bevel', kind: 'range', min: 0.5, max: 4, step: 0.1, def: 1.5 },
  { key: 'fx.bevel.intensity', label: 'bevel intensity', group: 'Facet & Bevel', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.7 },
  { key: 'fx.bevel.glintStrength', label: 'glint', group: 'Facet & Bevel', kind: 'range', min: 0, max: 1.5, step: 0.05, def: 0.6 },
  { key: 'fx.bevel.scatter', label: 'scatter', group: 'Facet & Bevel', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.65 },

  // --- spectrum ---
  { key: 'fx.spectrum.count', label: 'shards', group: 'Spectrum', kind: 'range', min: 0, max: 3, step: 1, def: 2 },
  { key: 'fx.spectrum.opacity', label: 'opacity', group: 'Spectrum', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.3 },
  { key: 'fx.spectrum.bandWidth', label: 'band width', group: 'Spectrum', kind: 'range', min: 0.1, max: 1, step: 0.01, def: 0.6 },
  { key: 'fx.spectrum.edgeOnly', label: 'edge only', group: 'Spectrum', kind: 'range', min: 0, max: 1, step: 0.01, def: 0 },

  // --- cracks (partition scenes only: hero has no crack network) ---
  { key: 'fx.crackStyle.coreWidth', label: 'core width', group: 'Cracks', kind: 'range', min: 0.4, max: 3, step: 0.05, def: 1.1, scenes: PARTITION },
  { key: 'fx.crackStyle.widthVariance', label: 'width variance', group: 'Cracks', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.6, scenes: PARTITION },
  { key: 'fx.crackStyle.doubleEdge', label: 'double edge', group: 'Cracks', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.5, scenes: PARTITION },
  { key: 'fx.crackStyle.subCracks', label: 'sub cracks', group: 'Cracks', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.6, scenes: PARTITION },
  { key: 'fx.crackStyle.brightnessVar', label: 'brightness var', group: 'Cracks', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.65, scenes: PARTITION },
  { key: 'fx.crackStyle.hackleDensity', label: 'hackle density', group: 'Cracks', kind: 'range', min: 0, max: 1, step: 0.01, def: 0.55, scenes: PARTITION },

  // --- outliers (partition scenes) ---
  { key: 'fx.outliers.dropFraction', label: 'dropped', group: 'Outliers', kind: 'range', min: 0, max: 0.3, step: 0.01, def: 0.05, scenes: PARTITION },
  { key: 'fx.outliers.slipFraction', label: 'slipped', group: 'Outliers', kind: 'range', min: 0, max: 0.4, step: 0.01, def: 0.09, scenes: PARTITION },
  { key: 'fx.outliers.rebelFraction', label: 'rebels', group: 'Outliers', kind: 'range', min: 0, max: 0.4, step: 0.01, def: 0.12, scenes: PARTITION },
  { key: 'fx.outliers.slipPx', label: 'slip px', group: 'Outliers', kind: 'range', min: 0, max: 30, step: 1, def: 10, scenes: PARTITION },

  // --- levitation (hero scenes) ---
  { key: 'fx.float.bobPx', label: 'bob px', group: 'Float', kind: 'range', min: 0, max: 30, step: 0.5, def: 10, scenes: HERO },
  { key: 'fx.float.swayPx', label: 'sway px', group: 'Float', kind: 'range', min: 0, max: 30, step: 0.5, def: 6, scenes: HERO },
  { key: 'fx.float.rotDeg', label: 'rock deg', group: 'Float', kind: 'range', min: 0, max: 10, step: 0.1, def: 2.5, scenes: HERO },
  { key: 'fx.float.cycles', label: 'cycles', group: 'Float', kind: 'range', min: 1, max: 4, step: 1, def: 1, scenes: HERO },

  // --- timeline & shatter (animated partition scenes) ---
  { key: 'fx.timeline.crackStart', label: 'crack start', group: 'Timeline', kind: 'range', min: 0, max: 0.5, step: 0.01, def: 0.02, scenes: ANIMATED },
  { key: 'fx.timeline.crackEnd', label: 'crack end', group: 'Timeline', kind: 'range', min: 0.05, max: 0.8, step: 0.01, def: 0.3, scenes: ANIMATED },
  { key: 'fx.timeline.shatterStart', label: 'shatter start', group: 'Timeline', kind: 'range', min: 0.1, max: 1, step: 0.01, def: 0.38, scenes: ANIMATED },
  { key: 'fx.shatter.speed', label: 'speed', group: 'Shatter', kind: 'range', min: 0, max: 2500, step: 10, def: 950, scenes: ANIMATED },
  { key: 'fx.shatter.drag', label: 'drag', group: 'Shatter', kind: 'range', min: 0, max: 4, step: 0.05, def: 1.6, scenes: ANIMATED },
  { key: 'fx.shatter.spinDegMax', label: 'spin max', group: 'Shatter', kind: 'range', min: 0, max: 400, step: 5, def: 170, scenes: ANIMATED },
  { key: 'fx.shatter.tumbleDegMax', label: 'tumble max', group: 'Shatter', kind: 'range', min: 0, max: 120, step: 2, def: 70, scenes: ANIMATED },
  { key: 'fx.shatter.staggerPerRing', label: 'stagger', group: 'Shatter', kind: 'range', min: 0, max: 0.12, step: 0.002, def: 0.035, scenes: ANIMATED },

  // --- settle & motion blur ---
  { key: 'fx.settle.amplitudePx', label: 'settle amp', group: 'Motion', kind: 'range', min: 0, max: 6, step: 0.1, def: 0, scenes: PARTITION },
  { key: 'fx.motionBlur.smearPx', label: 'smear px', group: 'Motion', kind: 'range', min: 0, max: 40, step: 1, def: 14, scenes: ANIMATED },
  { key: 'fx.motionBlur.smearBlurPx', label: 'smear blur', group: 'Motion', kind: 'range', min: 0, max: 4, step: 0.1, def: 1.2, scenes: ANIMATED },
];

/** Folder order in the panel. */
export const GROUP_ORDER = [
  'Mode',
  'Fracture',
  'Light',
  'Refraction',
  'Edge',
  'Chroma',
  'Facet & Bevel',
  'Spectrum',
  'Cracks',
  'Outliers',
  'Float',
  'Timeline',
  'Shatter',
  'Motion',
];

export function defsForScene(scene: SceneId): ParamDef[] {
  return PARAM_DEFS.filter((d) => !d.scenes || d.scenes.includes(scene));
}

export function groupsForScene(scene: SceneId): Array<{ group: string; defs: ParamDef[] }> {
  const defs = defsForScene(scene);
  return GROUP_ORDER.map((group) => ({ group, defs: defs.filter((d) => d.group === group) })).filter(
    (g) => g.defs.length > 0,
  );
}

/** Random value within the def's dice range, honoring step granularity. */
export function diceValue(def: ParamDef): number | string | boolean {
  if (def.kind === 'toggle') return Math.random() < 0.5;
  if (def.kind === 'select') {
    const opts = def.options ?? [];
    return opts[Math.floor(Math.random() * opts.length)] ?? def.def;
  }
  const [lo, hi] = def.dice ?? [def.min ?? 0, def.max ?? 1];
  const raw = lo + Math.random() * (hi - lo);
  const step = def.step ?? 0.01;
  const snapped = Math.round(raw / step) * step;
  return Number(snapped.toFixed(6));
}
