import { useMemo, type CSSProperties, type ReactNode } from 'react';
import type { DeepPartial, EffectParams, FracturePattern, FrameData } from '../types';
import { computeFrame } from '../render/frame';
import { resolveQuality } from '../render/quality';
import { normalizeEffectParams } from '../render/params';
import { toSvgPathD } from '../core/geometry';
import { fmt } from '../core/math';

/**
 * HTML clone tier: the content is instantiated once per shard, clipped with url()-free
 * `clip-path: polygon(...)` and transformed. Works for text and arbitrary HTML children.
 *
 * Pure renderer: no effects, no state, no ids from useId, no measurements. Time comes
 * only through the `t` prop.
 */
export interface CrackedGlassProps {
  /** Time/progress 0..1. The only source of time. */
  t: number;
  pattern: FracturePattern;
  fx?: DeepPartial<EffectParams>;
  /** Content; instantiated once per shard (clones get aria-hidden). */
  children?: ReactNode;
  /** Alternative to children for full control over each clone. */
  renderContent?: (shardIndex: number) => ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Draw shard outlines, indices and the impact point. */
  debug?: boolean;
}

export function useCrackedGlassFrame(
  t: number,
  pattern: FracturePattern,
  fx?: DeepPartial<EffectParams>,
): FrameData {
  return useMemo(() => computeFrame(t, pattern, fx), [t, pattern, fx]);
}

export function CrackedGlass(props: CrackedGlassProps): ReactNode {
  const { t, pattern, fx, children, renderContent, className, style, debug } = props;
  const frame = useCrackedGlassFrame(t, pattern, fx);
  const fxFull = useMemo(() => normalizeEffectParams(fx), [fx]);
  const q = resolveQuality(fxFull.quality);
  const w = pattern.width;
  const h = pattern.height;
  const overlayZ = (pattern.shards.length + 1) * 10 + 10;
  const iid = pattern.instanceId;
  const content = (i: number): ReactNode => (renderContent ? renderContent(i) : children);

  const fill: CSSProperties = { position: 'absolute', inset: 0 };

  return (
    <div
      className={className}
      style={{ position: 'relative', width: w, height: h, isolation: 'isolate', ...style }}
    >
      {frame.shards.map((s, i) => (
        <div key={s.id} style={{ display: 'contents' }}>
          {s.ghosts.map((g, k) => (
            <div
              key={`g${k}`}
              aria-hidden
              style={{
                ...fill,
                clipPath: s.clipPath,
                transform: g.shardTransform,
                transformOrigin: s.transformOrigin,
                opacity: g.opacity,
                zIndex: s.zIndex - 1 - k,
                pointerEvents: 'none',
              }}
            >
              <div style={{ ...fill, transform: s.contentTransform, transformOrigin: s.transformOrigin }}>
                {content(i)}
              </div>
            </div>
          ))}
          <div
            aria-hidden={i > 0 || undefined}
            style={{
              ...fill,
              clipPath: s.clipPath,
              transform: s.shardTransform,
              transformOrigin: s.transformOrigin,
              opacity: s.opacity,
              zIndex: s.zIndex,
              isolation: 'isolate',
            }}
          >
            {s.smear.map((sm, k) => (
              <div
                key={`sm${k}`}
                aria-hidden
                style={{
                  ...fill,
                  transform: sm.transform,
                  transformOrigin: s.transformOrigin,
                  filter: s.smearFilter || undefined,
                  opacity: sm.opacity,
                  pointerEvents: 'none',
                }}
              >
                {content(i)}
              </div>
            ))}
            <div
              style={{
                ...fill,
                transform: s.contentTransform,
                transformOrigin: s.transformOrigin,
                filter: s.contentFilter || undefined,
              }}
            >
              {content(i)}
            </div>
            {s.chroma.map((c, k) => (
              <div
                key={`c${k}`}
                aria-hidden
                style={{
                  ...fill,
                  clipPath: s.innerClipPath,
                  transform: c.transform,
                  transformOrigin: s.transformOrigin,
                  filter: c.filter || undefined,
                  mixBlendMode: c.mixBlendMode,
                  opacity: c.opacity,
                  pointerEvents: 'none',
                }}
              >
                {content(i)}
              </div>
            ))}
            {s.facet && (
              <div
                aria-hidden
                style={{
                  ...fill,
                  clipPath: s.innerClipPath,
                  background: s.facet.background,
                  mixBlendMode: s.facet.mixBlendMode,
                  opacity: s.facet.opacity,
                  pointerEvents: 'none',
                }}
              />
            )}
            {s.spectrum && (
              <div
                aria-hidden
                style={{
                  ...fill,
                  clipPath: s.innerClipPath,
                  background: s.spectrum.background,
                  mixBlendMode: s.spectrum.mixBlendMode,
                  opacity: s.spectrum.opacity,
                  pointerEvents: 'none',
                }}
              />
            )}
            {s.bevel.length > 0 && (
              // Edge bevel: the visible glass thickness. Pure stroked paths, zero url() refs;
              // lives inside the clipped+transformed wrapper, so it flies and glints with the
              // shard. Dark sectors paint normally in the first svg; lit sectors live in a
              // second svg whose ELEMENT-level blend reaches the shard content (an embedded
              // svg root is an isolated group, so per-path blends would be no-ops).
              <svg
                aria-hidden
                width={w}
                height={h}
                viewBox={`0 0 ${w} ${h}`}
                style={{ ...fill, overflow: 'visible', pointerEvents: 'none', display: 'block' }}
              >
                {s.bevel
                  .filter((b) => b.mixBlendMode === 'normal')
                  .map((b, k) => (
                    <path
                      key={k}
                      d={b.d}
                      fill="none"
                      stroke={b.stroke}
                      strokeWidth={fxFull.bevel.widthPx}
                      strokeLinecap="round"
                      opacity={b.opacity}
                    />
                  ))}
              </svg>
            )}
            {s.bevel.length > 0 && fxFull.bevel.blendMode !== 'normal' && (
              <svg
                aria-hidden
                width={w}
                height={h}
                viewBox={`0 0 ${w} ${h}`}
                style={{
                  ...fill,
                  overflow: 'visible',
                  pointerEvents: 'none',
                  display: 'block',
                  mixBlendMode: fxFull.bevel.blendMode,
                }}
              >
                {s.bevel
                  .filter((b) => b.mixBlendMode !== 'normal')
                  .map((b, k) => (
                    <path
                      key={k}
                      d={b.d}
                      fill="none"
                      stroke={b.stroke}
                      strokeWidth={fxFull.bevel.widthPx}
                      strokeLinecap="round"
                      opacity={b.opacity}
                    />
                  ))}
              </svg>
            )}
          </div>
        </div>
      ))}

      {/* dark crack-face strokes; own svg so the blend applies to the whole layer.
          translateZ(0) pins these frequently-repainted overlays to stable compositing
          layers from the very first frame - Chromium otherwise promotes them after the
          first invalidation, which changes rasterization between early and late frames. */}
      <svg
        aria-hidden
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        style={{
          ...fill,
          zIndex: overlayZ,
          pointerEvents: 'none',
          mixBlendMode: frame.cracks.style.blendMode,
          opacity: frame.cracks.opacity,
          overflow: 'hidden',
          display: 'block',
          transform: 'translateZ(0)',
        }}
      >
        <path d={frame.cracks.shadowPath} fill={frame.cracks.style.shadowColor} />
      </svg>

      {/* bright crack cores, hackle ticks, impact sparkle, micro debris */}
      <svg
        aria-hidden
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        style={{
          ...fill,
          zIndex: overlayZ + 1,
          pointerEvents: 'none',
          overflow: 'visible',
          display: 'block',
          transform: 'translateZ(0)',
        }}
      >
        <defs>
          <clipPath id={`${iid}-rect`}>
            <rect x="0" y="0" width={w} height={h} />
          </clipPath>
          <radialGradient id={`${iid}-spark`}>
            <stop offset="0%" stopColor="rgba(255,255,255,0.95)" />
            <stop offset="35%" stopColor="rgba(255,255,255,0.5)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
        </defs>
        <g clipPath={`url(#${iid}-rect)`} opacity={frame.cracks.opacity}>
          {fxFull.crackStyle.brightnessVar > 0 && (
            <path d={frame.cracks.coreDimPath} fill={frame.cracks.style.coreColor} opacity={frame.cracks.coreDimOpacity} />
          )}
          <path d={frame.cracks.stubPath} fill={frame.cracks.style.coreColor} opacity={0.55} />
          <path d={frame.cracks.corePath} fill={frame.cracks.style.coreColor} opacity={frame.cracks.coreOpacity} />
          <path
            d={frame.cracks.highlightPath}
            fill="none"
            stroke={frame.cracks.style.coreColor}
            strokeWidth={Math.max(0.4, frame.cracks.style.coreWidth * 0.65)}
            strokeLinecap="round"
            opacity={0.75}
          />
          <path
            d={frame.cracks.hacklePath}
            fill="none"
            stroke={frame.cracks.style.coreColor}
            strokeWidth={Math.max(0.5, frame.cracks.style.coreWidth * 0.6)}
            strokeLinecap="round"
            opacity={0.7}
          />
          {frame.cracks.sparkle && (
            <circle
              cx={frame.cracks.sparkle.cx}
              cy={frame.cracks.sparkle.cy}
              r={frame.cracks.sparkle.r}
              fill={`url(#${iid}-spark)`}
              opacity={frame.cracks.sparkle.opacity}
            />
          )}
        </g>
        <g>
          {frame.micro.map((m) => (
            <polygon
              key={m.id}
              points={m.points}
              transform={m.transform}
              opacity={m.opacity}
              fill={m.fill}
            />
          ))}
        </g>
      </svg>

      {/* static film grain (self-contained filter, quality-gated) */}
      {frame.grain && (
        <svg
          aria-hidden
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          style={{
            ...fill,
            zIndex: overlayZ + 2,
            pointerEvents: 'none',
            mixBlendMode: 'overlay',
            opacity: frame.grain.opacity,
            overflow: 'hidden',
            display: 'block',
            transform: 'translateZ(0)',
          }}
        >
          <defs>
            <filter id={`${iid}-grain`} x="0" y="0" width="100%" height="100%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.9"
                numOctaves="2"
                seed={pattern.seed % 997}
                stitchTiles="stitch"
              />
              <feColorMatrix
                type="matrix"
                values="0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 0 0.4"
              />
            </filter>
          </defs>
          <rect x="0" y="0" width={w} height={h} filter={`url(#${iid}-grain)`} />
        </svg>
      )}

      {debug && (
        <svg
          aria-hidden
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          style={{ ...fill, zIndex: overlayZ + 3, pointerEvents: 'none', overflow: 'visible', display: 'block' }}
        >
          {pattern.shards.map((s) => (
            <g key={s.id}>
              <path d={toSvgPathD(s.polygon, true)} fill="none" stroke="rgba(0,255,140,0.8)" strokeWidth={0.75} />
              <text
                x={fmt(s.centroid[0])}
                y={fmt(s.centroid[1])}
                fill="rgba(0,255,140,0.9)"
                fontSize={10}
                textAnchor="middle"
                fontFamily="monospace"
              >
                {s.id}:{s.ringIndex}
              </text>
            </g>
          ))}
          <circle cx={pattern.impact[0]} cy={pattern.impact[1]} r={3} fill="none" stroke="#ff5050" strokeWidth={1.5} />
          {q.microShardCap > 0 && (
            <text x={4} y={12} fill="rgba(0,255,140,0.9)" fontSize={10} fontFamily="monospace">
              shards:{pattern.shards.length} micro:{Math.min(pattern.micro.length, q.microShardCap)} phase:{frame.phase}
            </text>
          )}
        </svg>
      )}
    </div>
  );
}
