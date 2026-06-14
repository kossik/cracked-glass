/** Named lab presets: committed starting points + user presets in localStorage. */
import type { LabState } from './state';
import { defaultLabState } from './state';

export interface LabPreset {
  name: string;
  state: Partial<LabState>;
}

export const BUILTIN_PRESETS: LabPreset[] = [
  {
    name: 'hero / calm float',
    state: {
      scene: 'hero-1',
      seed: 7,
      t: 0.5,
      params: { 'fx.float.bobPx': 8, 'fx.float.swayPx': 5, 'fx.float.rotDeg': 1.8 },
    },
  },
  {
    name: 'hero / strong optics',
    state: {
      scene: 'hero-1',
      seed: 21,
      t: 0.5,
      params: {
        'fx.refraction.offsetPx': 16,
        'fx.refraction.tiltDeg': 4,
        'fx.chroma.offsetPx': 5.5,
        'fx.bevel.intensity': 1,
        'fx.spectrum.opacity': 0.45,
      },
    },
  },
  {
    name: 'hero / stacked pair',
    state: {
      scene: 'hero-2',
      seed: 12,
      t: 0.5,
      params: { 'fr.hero.overlap': 0.55, 'fr.hero.spread': 0.4 },
    },
  },
  {
    name: 'macro / edge light study',
    state: {
      scene: 'macro-edge',
      seed: 7,
      t: 0.5,
      zoom: 4.5,
      panX: 18,
      panY: 0,
      params: { 'fx.bevel.widthPx': 2.2, 'fx.bevel.scatter': 0.8 },
    },
  },
  {
    name: 'radial / hard blast',
    state: {
      scene: 'radial',
      seed: 7,
      t: 0.45,
      params: { 'fx.shatter.speed': 2100, 'fr.rings.partial': 0.9 },
      play: { ...defaultLabState.play, easing: 'impact', duration: 3 },
    },
  },
  {
    name: 'diagonal / slow crumble',
    state: {
      scene: 'diagonal',
      seed: 4,
      t: 0.5,
      params: { 'fx.shatter.staggerPerRing': 0.08 },
      play: { ...defaultLabState.play, easing: 'inout', duration: 6 },
    },
  },
];

const LS_KEY = 'cg-lab-presets:v1';

export function loadUserPresets(): LabPreset[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as LabPreset[]) : [];
  } catch {
    return [];
  }
}

export function saveUserPreset(name: string, state: LabState): LabPreset[] {
  const list = loadUserPresets().filter((p) => p.name !== name);
  list.push({ name, state });
  localStorage.setItem(LS_KEY, JSON.stringify(list));
  return list;
}

export function deleteUserPreset(name: string): LabPreset[] {
  const list = loadUserPresets().filter((p) => p.name !== name);
  localStorage.setItem(LS_KEY, JSON.stringify(list));
  return list;
}

export function applyPreset(preset: LabPreset): LabState {
  return {
    ...defaultLabState,
    ...preset.state,
    play: { ...defaultLabState.play, ...preset.state.play },
    params: { ...preset.state.params },
  };
}
