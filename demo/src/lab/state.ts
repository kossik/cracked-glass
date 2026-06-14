/**
 * Lab state model + URL serialization. The whole lab session is one serializable object:
 * paste a link and you reproduce the exact render (scene, seed, t, every knob).
 * Demo-side code: free to use Math.random/rAF - the library itself never does.
 */

export type SceneId = 'hero-1' | 'hero-2' | 'radial' | 'web' | 'horizontal' | 'diagonal' | 'macro-edge';

export type EasingId = 'linear' | 'inout' | 'impact';

export interface PlaybackState {
  /** Seconds for a full 0..1 sweep. */
  duration: number;
  easing: EasingId;
  loop: boolean;
  pingpong: boolean;
}

export interface LabState {
  scene: SceneId;
  seed: number;
  t: number;
  quality: 'draft' | 'normal' | 'high';
  /** Named motion preset (timeline + shatter) merged under user param overrides. '' = none. */
  motionPreset: string;
  zoom: number;
  /** Pan of the zoomed stage, % of stage size (macro inspection). */
  panX: number;
  panY: number;
  debug: boolean;
  play: PlaybackState;
  /** Flat overrides: 'fx.refraction.offsetPx' -> 7, 'fr.hero.overlap' -> 0.5, ... */
  params: Record<string, number | string | boolean>;
}

export const defaultLabState: LabState = {
  scene: 'horizontal',
  seed: 7,
  t: 0.5,
  quality: 'normal',
  motionPreset: '',
  zoom: 1,
  panX: 0,
  panY: 0,
  debug: false,
  play: { duration: 4, easing: 'linear', loop: true, pingpong: false },
  params: {},
};

/** Compact state -> base64url (unicode-safe). */
export function serializeState(state: LabState): string {
  const json = JSON.stringify(state);
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function deserializeState(s: string): LabState | null {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<LabState>;
    return {
      ...defaultLabState,
      ...parsed,
      play: { ...defaultLabState.play, ...parsed.play },
      params: { ...parsed.params },
    };
  } catch {
    return null;
  }
}

export function stateFromUrl(): LabState {
  const q = new URLSearchParams(window.location.search);
  const packed = q.get('s');
  let state = (packed && deserializeState(packed)) || { ...defaultLabState, params: {} };
  // Loose single params override the packed state (handy for tooling: &t=0.3&seed=9).
  const scene = q.get('scene') as SceneId | null;
  if (scene) state = { ...state, scene };
  if (q.get('seed') !== null) state = { ...state, seed: Number(q.get('seed')) >>> 0 };
  if (q.get('t') !== null) state = { ...state, t: Number(q.get('t')) };
  if (q.get('quality')) state = { ...state, quality: q.get('quality') as LabState['quality'] };
  return state;
}

export function urlForState(state: LabState, extra = ''): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?s=${serializeState(state)}${extra}`;
}

export const isCaptureMode = (): boolean =>
  new URLSearchParams(window.location.search).get('capture') === '1';

/* ---------------- playback easings (lab-side pacing of t) ---------------- */

const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);
const easeInOutCubic = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

/**
 * The S-profile with hold from the agent guide: fast crack attack, a suspended "broken
 * but holding" beat, then the shatter release.
 */
const impactProfile = (p: number): number => {
  if (p < 0.3) return easeOutCubic(p / 0.3) * 0.44;
  if (p < 0.55) return 0.44 + ((p - 0.3) / 0.25) * 0.06;
  return 0.5 + easeInOutCubic((p - 0.55) / 0.45) * 0.5;
};

export const easings: Record<EasingId, (p: number) => number> = {
  linear: (p) => p,
  inout: easeInOutCubic,
  impact: impactProfile,
};

/* ---------------- flat param paths -> nested objects ---------------- */

/** Apply 'a.b.c' -> value entries with the given prefix into a nested object. */
export function buildNested(
  params: Record<string, number | string | boolean>,
  prefix: 'fx' | 'fr',
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!key.startsWith(prefix + '.')) continue;
    const path = key.slice(prefix.length + 1).split('.');
    let node = out;
    for (let i = 0; i < path.length - 1; i++) {
      const seg = path[i];
      if (typeof node[seg] !== 'object' || node[seg] === null) node[seg] = {};
      node = node[seg] as Record<string, unknown>;
    }
    node[path[path.length - 1]] = value;
  }
  return out;
}

/** Deep-merge b over a (plain objects only; arrays/primitives replaced). */
export function deepMerge<T extends Record<string, unknown>>(a: T, b: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const prev = out[k];
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      prev &&
      typeof prev === 'object' &&
      !Array.isArray(prev)
    ) {
      out[k] = deepMerge(prev as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}
