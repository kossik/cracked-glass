/**
 * cracked-glass lab: review tool for tuning the effect. Scene presets, every knob as a
 * control, randomizers with group locks, t playback with easings, pin & compare,
 * shareable URL state and an exportable shot list for the showcase capture tool.
 *
 * Demo-side code: rAF/Math.random are fine HERE - the library stays a pure function of t.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { computeFrame, generateFracture, motionPresets } from 'cracked-glass';
import {
  buildNested,
  deepMerge,
  deserializeState,
  easings,
  isCaptureMode,
  serializeState,
  stateFromUrl,
  urlForState,
  type LabState,
  type SceneId,
} from './state';
import { SCENES, sceneById } from './scenes';
import { diceValue, groupsForScene } from './labParams';
import { Folder, ParamRow } from './controls';
import {
  applyPreset,
  BUILTIN_PRESETS,
  loadUserPresets,
  saveUserPreset,
  type LabPreset,
} from './presets';

interface Shot {
  name: string;
  s: string;
  t: number;
}

const capture = isCaptureMode();

export function Lab(): ReactNode {
  const [state, setState] = useState<LabState>(() => {
    const s = stateFromUrl();
    // Loose ?scene= entry (no packed state): adopt the scene's default zoom/t.
    const q = new URLSearchParams(window.location.search);
    if (q.has('scene') && !q.has('s')) {
      const def = sceneById(s.scene);
      return {
        ...s,
        zoom: def.defaultZoom,
        panX: def.defaultPanX ?? 0,
        panY: def.defaultPanY ?? 0,
        t: q.has('t') ? s.t : def.defaultT,
      };
    }
    return s;
  });
  const [locks, setLocks] = useState<ReadonlySet<string>>(new Set());
  const [pinned, setPinned] = useState<string | null>(null);
  const [pinSyncT, setPinSyncT] = useState(true);
  const [shots, setShots] = useState<Shot[]>([]);
  const [userPresets, setUserPresets] = useState<LabPreset[]>(loadUserPresets);
  const [playing, setPlaying] = useState(false);
  const [hud, setHud] = useState('');
  const stageRef = useRef<HTMLDivElement>(null);

  const up = (patch: Partial<LabState>) => setState((s) => ({ ...s, ...patch }));
  const setParam = (key: string, v: number | string | boolean | undefined) =>
    setState((s) => {
      const params = { ...s.params };
      if (v === undefined) delete params[key];
      else params[key] = v;
      return { ...s, params };
    });

  // Capture hook: the page is a pure function of this t (same contract as the demo).
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__cgSetT = (v: number) =>
      setState((s) => ({ ...s, t: v }));
    if (capture) document.body.classList.add('capture');
  }, []);

  // Shareable URL: keep ?s= in sync (debounced; not while a capture tool drives the page).
  useEffect(() => {
    if (capture) return;
    const id = window.setTimeout(() => {
      window.history.replaceState(null, '', urlForState(state));
    }, 300);
    return () => window.clearTimeout(id);
  }, [state]);

  // Latest state for the rAF loop without restarting it on every slider move.
  const stateRef = useRef(state);
  stateRef.current = state;

  // Playback: drive t with rAF (lab-side pacing; the library never animates itself).
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const t0 = performance.now();
    const startT = stateRef.current.t >= 0.999 ? 0 : stateRef.current.t;
    const tick = (now: number) => {
      const { duration, easing, loop, pingpong } = stateRef.current.play;
      const span = Math.max(0.2, duration) * 1000;
      let p = startT + (now - t0) / span;
      if (pingpong) {
        const cycle = p % 2;
        p = cycle <= 1 ? cycle : 2 - cycle;
      } else if (loop) {
        p = p % 1;
      } else if (p >= 1) {
        setState((s) => ({ ...s, t: easings[easing](1) }));
        setPlaying(false);
        return;
      }
      setState((s) => ({ ...s, t: easings[easing](Math.min(1, Math.max(0, p))) }));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Perf HUD (lab-side measurement; quality/scene aware).
  const scene = sceneById(state.scene);
  const frJson = JSON.stringify(buildNested(state.params, 'fr'));
  const pattern = useMemo(
    () => generateFracture(scene.makeOptions(state.seed, buildNested(state.params, 'fr'))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scene, state.seed, frJson],
  );
  const fxJson = JSON.stringify(buildNested(state.params, 'fx'));
  const fx = useMemo(() => {
    // baseFx -> motion preset (timeline+shatter) -> user param overrides
    let merged = scene.baseFx() as Record<string, unknown>;
    const mp = state.motionPreset && motionPresets[state.motionPreset];
    if (mp) {
      const mpFx: Record<string, unknown> = {};
      if (mp.timeline) mpFx.timeline = mp.timeline;
      if (mp.shatter) mpFx.shatter = mp.shatter;
      merged = deepMerge(merged, mpFx);
    }
    merged = deepMerge(merged, buildNested(state.params, 'fx'));
    return { ...merged, quality: state.quality };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, fxJson, state.quality, state.motionPreset]);
  useEffect(() => {
    const t0 = performance.now();
    computeFrame(state.t, pattern, fx);
    const dt = performance.now() - t0;
    const nodes = stageRef.current ? stageRef.current.querySelectorAll('*').length : 0;
    const heavy = pattern.shards.length > 120 || nodes > 4000;
    const warn = heavy ? `\n⚠ heavy (${pattern.shards.length} shards) — drop rays/rings, use draft, or feed an <img> snapshot` : '';
    setHud(
      `computeFrame: ${dt.toFixed(2)} ms · DOM: ${nodes}\nshards: ${pattern.shards.length} · seed: ${pattern.seed} · mode: ${pattern.mode}${warn}`,
    );
  }, [state.t, pattern, fx]);

  const switchScene = (id: SceneId) => {
    const def = sceneById(id);
    setState((s) => ({
      ...s,
      scene: id,
      t: def.defaultT,
      zoom: def.defaultZoom,
      panX: def.defaultPanX ?? 0,
      panY: def.defaultPanY ?? 0,
    }));
  };

  const diceSeed = () => up({ seed: Math.floor(Math.random() * 1e9) });

  const diceGroup = (group: string) => {
    setState((s) => {
      const params = { ...s.params };
      for (const def of groupsForScene(s.scene).find((g) => g.group === group)?.defs ?? []) {
        params[def.key] = diceValue(def);
      }
      return { ...s, params };
    });
  };

  const resetGroup = (group: string) => {
    setState((s) => {
      const params = { ...s.params };
      for (const def of groupsForScene(s.scene).find((g) => g.group === group)?.defs ?? []) {
        delete params[def.key];
      }
      return { ...s, params };
    });
  };

  const shuffleAll = () => {
    setState((s) => {
      const params = { ...s.params };
      for (const g of groupsForScene(s.scene)) {
        if (locks.has(g.group)) continue;
        for (const def of g.defs) params[def.key] = diceValue(def);
      }
      return { ...s, params, seed: locks.has('Seed') ? s.seed : Math.floor(Math.random() * 1e9) };
    });
  };

  const toggleLock = (group: string) =>
    setLocks((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });

  const copyLink = () => {
    void navigator.clipboard.writeText(urlForState(state));
  };

  const addShot = () => {
    const name = `${state.scene}-t${state.t.toFixed(2)}-${shots.length + 1}`;
    setShots((list) => [...list, { name, s: serializeState(state), t: state.t }]);
  };

  const exportShots = () => {
    const json = JSON.stringify(shots, null, 2);
    void navigator.clipboard.writeText(json);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'cg-lab-shots.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const savePreset = () => {
    const name = window.prompt('Preset name:', `${state.scene} custom`);
    if (name) setUserPresets(saveUserPreset(name, state));
  };

  const onPreset = (name: string) => {
    const preset = [...BUILTIN_PRESETS, ...userPresets].find((p) => p.name === name);
    if (preset) setState(applyPreset(preset));
  };

  const pinnedState = pinned ? deserializeState(pinned) : null;
  const groups = groupsForScene(state.scene);
  const dirtyCount = (group: string) =>
    groups.find((g) => g.group === group)?.defs.filter((d) => state.params[d.key] !== undefined)
      .length ?? 0;

  return (
    <div className="app">
      <div className="sidebar lab-sidebar">
        <h1>
          cracked-<span>glass</span> / lab
        </h1>
        <a className="cross-link" href={`${import.meta.env.BASE_URL}index.html`}>
          ← back to the demo
        </a>

        <div className="field">
          <label>Scene</label>
          <select value={state.scene} onChange={(e) => switchScene(e.target.value as SceneId)}>
            {SCENES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Seed</label>
          <div className="row">
            <input
              type="number"
              value={state.seed}
              onChange={(e) => up({ seed: Number(e.target.value) >>> 0 })}
            />
            <button onClick={diceSeed}>🎲</button>
            <button
              className={`icon${locks.has('Seed') ? ' active' : ''}`}
              title="lock seed (shuffle-all skips it)"
              onClick={() => toggleLock('Seed')}
            >
              {locks.has('Seed') ? '🔒' : '🔓'}
            </button>
          </div>
        </div>

        <div className="field">
          <label>Quality</label>
          <select
            value={state.quality}
            onChange={(e) => up({ quality: e.target.value as LabState['quality'] })}
          >
            <option value="draft">draft</option>
            <option value="normal">normal</option>
            <option value="high">high</option>
          </select>
        </div>

        <div className="field">
          <label>Motion preset</label>
          <select
            value={state.motionPreset}
            onChange={(e) => up({ motionPreset: e.target.value })}
            title="timeline + shatter dramaturgy (under your param overrides)"
          >
            <option value="">none (scene default)</option>
            {Object.entries(motionPresets).map(([key, p]) => (
              <option key={key} value={key}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>View</label>
          <div className="prow">
            <label>zoom</label>
            <input
              type="range"
              min={1}
              max={8}
              step={0.5}
              value={state.zoom}
              onChange={(e) => up({ zoom: Number(e.target.value) })}
            />
            <span className="val">{state.zoom}×</span>
          </div>
          {state.zoom > 1 && (
            <>
              <div className="prow">
                <label>pan x</label>
                <input
                  type="range"
                  min={-45}
                  max={45}
                  step={1}
                  value={state.panX}
                  onChange={(e) => up({ panX: Number(e.target.value) })}
                />
                <span className="val">{state.panX}%</span>
              </div>
              <div className="prow">
                <label>pan y</label>
                <input
                  type="range"
                  min={-45}
                  max={45}
                  step={1}
                  value={state.panY}
                  onChange={(e) => up({ panY: Number(e.target.value) })}
                />
                <span className="val">{state.panY}%</span>
              </div>
            </>
          )}
          <div className="row">
            <button onClick={() => up({ debug: !state.debug })}>
              {state.debug ? 'debug: on' : 'debug: off'}
            </button>
          </div>
        </div>

        <div className="field">
          <label>Preset</label>
          <div className="row">
            <select defaultValue="" onChange={(e) => e.target.value && onPreset(e.target.value)}>
              <option value="" disabled>
                apply preset...
              </option>
              <optgroup label="built-in">
                {BUILTIN_PRESETS.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
              {userPresets.length > 0 && (
                <optgroup label="yours">
                  {userPresets.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <button onClick={savePreset} title="save current state as a named preset">
              save
            </button>
          </div>
        </div>

        <div className="field">
          <label>Share & review</label>
          <div className="row">
            <button onClick={copyLink} title="copy a link reproducing this exact state">
              copy link
            </button>
            <button
              onClick={() => setPinned(pinned ? null : serializeState(state))}
              className={pinned ? 'active' : ''}
              title="freeze the current render next to the live one"
            >
              {pinned ? 'unpin' : 'pin'}
            </button>
          </div>
          {pinned && (
            <div className="row">
              <button onClick={() => setPinSyncT(!pinSyncT)}>
                {pinSyncT ? 'pinned t: live' : 'pinned t: frozen'}
              </button>
            </div>
          )}
          <div className="row">
            <button onClick={addShot} title="add the current state + t to the shot list">
              + shot
            </button>
            <button onClick={exportShots} disabled={shots.length === 0} title="download cg-lab-shots.json for tools/showcase.mjs --shots">
              export shots ({shots.length})
            </button>
          </div>
        </div>

        <div className="field">
          <div className="row">
            <button className="primary" onClick={shuffleAll} title="randomize all unlocked groups + seed">
              🎲 shuffle all
            </button>
            <button onClick={() => up({ params: {} })} title="reset all params to defaults">
              reset all
            </button>
          </div>
        </div>

        {groups.map((g) => (
          <Folder
            key={g.group}
            title={g.group}
            dirty={dirtyCount(g.group)}
            locked={locks.has(g.group)}
            onToggleLock={() => toggleLock(g.group)}
            onDice={() => diceGroup(g.group)}
            onReset={() => resetGroup(g.group)}
            defaultOpen={g.group === 'Fracture'}
          >
            {g.defs.map((def) => (
              <ParamRow
                key={def.key}
                def={def}
                value={state.params[def.key]}
                onChange={(v) => setParam(def.key, v)}
              />
            ))}
          </Folder>
        ))}

        <div className="hud">{hud}</div>
      </div>

      <div className="main">
        <div className={`stage-wrap${pinnedState ? ' compare' : ''}`}>
          <div className="stage-cell">
            {pinnedState && <div className="stage-tag live">live</div>}
            <div ref={stageRef} className="stage" data-stage>
              <ZoomWindow zoom={state.zoom} panX={state.panX} panY={state.panY}>
                <scene.Render t={state.t} pattern={pattern} fx={fx} debug={state.debug} />
              </ZoomWindow>
            </div>
          </div>
          {pinnedState && !capture && (
            <div className="stage-cell">
              <div className="stage-tag">pinned</div>
              <PinnedStage state={pinnedState} t={pinSyncT ? state.t : pinnedState.t} />
            </div>
          )}
        </div>

        <div className="tbar">
          <div className="trow">
            <button className="primary play" onClick={() => setPlaying(!playing)}>
              {playing ? '⏸' : '▶'}
            </button>
            <span>t</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={state.t}
              onChange={(e) => {
                setPlaying(false);
                up({ t: Number(e.target.value) });
              }}
            />
            <span className="tval">{state.t.toFixed(3)}</span>
          </div>
          <div className="trow playopts">
            <label>
              duration
              <input
                type="number"
                min={0.5}
                max={20}
                step={0.5}
                value={state.play.duration}
                onChange={(e) => up({ play: { ...state.play, duration: Number(e.target.value) } })}
              />
              s
            </label>
            <label>
              easing
              <select
                value={state.play.easing}
                onChange={(e) =>
                  up({ play: { ...state.play, easing: e.target.value as LabState['play']['easing'] } })
                }
              >
                <option value="linear">linear</option>
                <option value="inout">ease-in-out</option>
                <option value="impact">impact (S + hold)</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={state.play.loop}
                onChange={(e) => up({ play: { ...state.play, loop: e.target.checked } })}
              />
              loop
            </label>
            <label>
              <input
                type="checkbox"
                checked={state.play.pingpong}
                onChange={(e) => up({ play: { ...state.play, pingpong: e.target.checked } })}
              />
              ping-pong
            </label>
            <span className="spacer" />
            {[0, 0.25, 0.5, 0.62, 0.8, 1].map((v) => (
              <button key={v} onClick={() => up({ t: v })}>
                t={v}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Frozen copy of a serialized lab state, rendered next to the live stage. */
function PinnedStage(props: { state: LabState; t: number }): ReactNode {
  const { state, t } = props;
  const scene = sceneById(state.scene);
  const pattern = useMemo(
    () => generateFracture(scene.makeOptions(state.seed, buildNested(state.params, 'fr'))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scene, state.seed, JSON.stringify(state.params)],
  );
  const fx = useMemo(
    () => ({
      ...deepMerge(scene.baseFx() as Record<string, unknown>, buildNested(state.params, 'fx')),
      quality: state.quality,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scene, JSON.stringify(state.params), state.quality],
  );
  return (
    <div className="stage">
      <ZoomWindow zoom={state.zoom} panX={state.panX} panY={state.panY}>
        <scene.Render t={t} pattern={pattern} fx={fx} debug={state.debug} />
      </ZoomWindow>
    </div>
  );
}

/**
 * Macro window: the stage box stays put (overflow hidden) and the scene is scaled/panned
 * INSIDE it - a magnifier over the effect, used by the macro-edge scene.
 */
function ZoomWindow(props: { zoom: number; panX: number; panY: number; children: ReactNode }): ReactNode {
  const { zoom, panX, panY, children } = props;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        transform: zoom > 1 ? `scale(${zoom}) translate(${-panX}%, ${-panY}%)` : undefined,
      }}
    >
      {children}
    </div>
  );
}
