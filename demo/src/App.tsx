import { useEffect, useMemo, useRef, useState } from 'react';
import {
  collapseShatterPreset,
  computeFrame,
  generateFracture,
  staticCrackedTimeline,
  type DeepPartial,
  type EffectParams,
  type QualityPreset,
} from 'cracked-glass';
import { CrackedGlass, CrackedGlassText } from 'cracked-glass/react';

type SceneId = 'title' | 'title-anim' | 'radial' | 'collapse' | 'text-svg';

const params = new URLSearchParams(window.location.search);
const isCapture = params.get('capture') === '1';

export function App() {
  const [scene, setScene] = useState<SceneId>((params.get('scene') as SceneId) || 'title');
  const [seed, setSeed] = useState(() => Number(params.get('seed') ?? 7));
  const [quality, setQuality] = useState<QualityPreset>((params.get('quality') as QualityPreset) || 'normal');
  const [debug, setDebug] = useState(params.get('debug') === '1');
  const [t, setT] = useState(() => Number(params.get('t') ?? (sceneIsAnimated(scene) ? 0.62 : 1)));
  const [zoom, setZoom] = useState(1);
  const [hud, setHud] = useState('');
  const stageRef = useRef<HTMLDivElement>(null);
  const scrubTimer = useRef<number | null>(null);

  // Engine hook for the capture tools: the page renders as a pure function of this t.
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__cgSetT = (v: number) => setT(v);
    if (isCapture) document.body.classList.add('capture');
  }, []);

  const pattern = useMemo(() => {
    if (scene === 'radial') {
      return generateFracture({
        mode: 'radial',
        width: 960,
        height: 540,
        seed,
        impact: { x: 430, y: 250 },
        rays: { count: 6 },
        rings: { count: 3 },
      });
    }
    if (scene === 'collapse') {
      return generateFracture({ mode: 'collapse', width: 960, height: 540, seed });
    }
    if (scene === 'text-svg') {
      return generateFracture({ mode: 'title', width: 880, height: 320, seed, bands: { count: [3, 4] } });
    }
    return generateFracture({ mode: 'title', width: 880, height: 360, seed, bands: { count: [3, 5] } });
  }, [scene, seed]);

  const fx = useMemo<DeepPartial<EffectParams>>(() => {
    if (scene === 'title') {
      return {
        quality,
        timeline: staticCrackedTimeline,
        settle: { amplitudePx: 0 },
        // small patterns: make the exceptions actually show up
        outliers: { dropFraction: 0.12, slipFraction: 0.25 },
      };
    }
    if (scene === 'radial') {
      return {
        quality,
        timeline: { crackStart: 0.02, crackEnd: 0.3, shatterStart: 0.38 },
        shatter: { speed: 1550, gravity: [0, 420] as const, drag: 1.25, staggerPerRing: 0.045 },
        refraction: { offsetPx: 7 },
        chroma: { mode: 'ghost', offsetPx: 3.4 },
        facet: { strength: 0.5, opacity: 0.5 },
        bevel: { intensity: 0.85, glintStrength: 0.9 },
      };
    }
    if (scene === 'collapse') {
      return {
        quality,
        timeline: { crackStart: 0.02, crackEnd: 0.28, shatterStart: 0.34 },
        shatter: { ...collapseShatterPreset, fadeOut: [0.92, 1] as [number, number] },
        bevel: { intensity: 0.75 },
      };
    }
    if (scene === 'text-svg') {
      return {
        quality,
        timeline: { crackStart: 0.05, crackEnd: 0.4, shatterStart: 0.55 },
        facet: { strength: 0.4, opacity: 0.32 },
      };
    }
    return {
      quality,
      timeline: { crackStart: 0.05, crackEnd: 0.4, shatterStart: 0.55 },
      outliers: { dropFraction: 0.18, slipFraction: 0.25 },
    };
  }, [scene, quality]);

  // Perf HUD: an extra measured computeFrame call (demo-side only; the library has no clocks).
  useEffect(() => {
    const t0 = performance.now();
    computeFrame(t, pattern, fx);
    const dt = performance.now() - t0;
    const nodes = stageRef.current ? stageRef.current.querySelectorAll('*').length : 0;
    setHud(
      `computeFrame: ${dt.toFixed(2)} ms\nDOM nodes in stage: ${nodes}\nshards: ${pattern.shards.length}  micro: ${pattern.micro.length}\nseed: ${pattern.seed}  mode: ${pattern.mode}`,
    );
  }, [t, pattern, fx]);

  const runScrub = (seq: number[], stepMs = 220) => {
    if (scrubTimer.current !== null) window.clearInterval(scrubTimer.current);
    let i = 0;
    setT(seq[0]);
    scrubTimer.current = window.setInterval(() => {
      i++;
      if (i >= seq.length) {
        if (scrubTimer.current !== null) window.clearInterval(scrubTimer.current);
        scrubTimer.current = null;
        return;
      }
      setT(seq[i]);
    }, stepMs);
  };

  const sweep = () => {
    const seq: number[] = [];
    for (let i = 0; i <= 120; i++) seq.push(i / 120);
    runScrub(seq, 33);
  };

  return (
    <div className="app">
      <div className="sidebar">
        <h1>
          cracked-<span>glass</span> / demo
        </h1>
        <a className="cross-link" href={`${import.meta.env.BASE_URL}lab.html`}>
          → open the Lab (full control panel)
        </a>
        <div className="field">
          <label>Scene</label>
          <select value={scene} onChange={(e) => setScene(e.target.value as SceneId)}>
            <option value="title">Title — static cracked (HTML tier)</option>
            <option value="title-anim">Title — crack &amp; shatter</option>
            <option value="radial">Radial — screen transition</option>
            <option value="collapse">Collapse — diagonal mesh crumble</option>
            <option value="text-svg">Text — SVG premium tier</option>
          </select>
        </div>
        <div className="field">
          <label>Seed</label>
          <div className="row">
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value) >>> 0)}
            />
            <button onClick={() => setSeed(Math.floor(Math.random() * 1e9))}>🎲</button>
          </div>
        </div>
        <div className="field">
          <label>Quality</label>
          <select value={quality} onChange={(e) => setQuality(e.target.value as QualityPreset)}>
            <option value="draft">draft</option>
            <option value="normal">normal</option>
            <option value="high">high</option>
          </select>
        </div>
        <div className="field">
          <label>Zoom (seam inspection)</label>
          <input
            type="range"
            min={1}
            max={6}
            step={0.5}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </div>
        <div className="row">
          <button onClick={() => setDebug(!debug)}>{debug ? 'debug: on' : 'debug: off'}</button>
        </div>
        <div className="hud">{hud}</div>
      </div>

      <div className="main">
        <div className="stage-wrap">
          <div
            ref={stageRef}
            className="stage"
            data-stage
            style={{ transform: zoom > 1 ? `scale(${zoom})` : undefined }}
          >
            <Scene scene={scene} t={t} pattern={pattern} fx={fx} debug={debug} />
          </div>
        </div>
        <div className="tbar">
          <div className="trow">
            <span>t</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={t}
              onChange={(e) => setT(Number(e.target.value))}
            />
            <span className="tval">{t.toFixed(3)}</span>
          </div>
          <div className="scrubs">
            <button className="primary" onClick={sweep}>
              ▶ sweep 0→1
            </button>
            <button onClick={() => runScrub([0, 0.8, 0.2, 1, 0.5, 0.2, 0.8, 0.62])}>
              scrub [0 .8 .2 1 .5 .2 .8]
            </button>
            <button onClick={() => runScrub([1, 0.9, 0.5, 0.3, 0.1, 0])}>reverse 1→0</button>
            {[0, 0.2, 0.38, 0.5, 0.62, 0.8, 1].map((v) => (
              <button key={v} onClick={() => setT(v)}>
                t={v}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function sceneIsAnimated(s: SceneId) {
  return s !== 'title';
}

function Scene(props: {
  scene: SceneId;
  t: number;
  pattern: ReturnType<typeof generateFracture>;
  fx: DeepPartial<EffectParams>;
  debug: boolean;
}) {
  const { scene, t, pattern, fx, debug } = props;

  if (scene === 'radial' || scene === 'collapse') {
    return (
      <>
        <ScreenB />
        <CrackedGlass t={t} pattern={pattern} fx={fx} debug={debug} style={{ position: 'absolute', inset: 0 }}>
          <ScreenA />
        </CrackedGlass>
      </>
    );
  }

  if (scene === 'text-svg') {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
        <CrackedGlassText
          t={t}
          pattern={pattern}
          fx={fx}
          text={['CRACKED', 'EFFECT']}
          fontWeight={900}
          fill="#f2f6ff"
        />
      </div>
    );
  }

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

function ScreenA() {
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

function ScreenB() {
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
