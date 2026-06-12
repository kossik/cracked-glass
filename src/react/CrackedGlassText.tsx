import { useMemo, type CSSProperties, type ReactNode } from 'react';
import type { DeepPartial, EffectParams, FracturePattern } from '../types';
import { useCrackedGlassFrame } from './CrackedGlass';
import { normalizeEffectParams } from '../render/params';
import { resolveQuality } from '../render/quality';
import { toSvgPathD, unflattenPts } from '../core/geometry';
import { fmt } from '../core/math';

/**
 * SVG premium tier for headlines: one self-contained <svg> where every shard gets a
 * <clipPath> + <filter> with TRUE per-channel chromatic decomposition (feColorMatrix ->
 * feOffset -> screen merge) and conchoidal feDisplacementMap refraction. All url(#...)
 * references resolve inside this same <svg> - safe for headless frame capture.
 *
 * Limitations vs the HTML tier: SVG <text> (no HTML wrapping), 2D-only shard motion.
 */
export interface CrackedGlassTextProps {
  t: number;
  pattern: FracturePattern;
  fx?: DeepPartial<EffectParams>;
  /** Headline text; array = multiple lines. Ignored when renderSvgContent is given. */
  text?: string | string[];
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | string;
  fill?: string;
  letterSpacing?: number | string;
  lineHeight?: number;
  /** Custom SVG content instead of text (rendered once, re-used per shard via <use>). */
  renderSvgContent?: () => ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function CrackedGlassText(props: CrackedGlassTextProps): ReactNode {
  const {
    t,
    pattern,
    fx,
    text = 'CRACKED',
    fontFamily = "'Inter', 'Segoe UI', system-ui, sans-serif",
    fontWeight = 800,
    fill = '#ffffff',
    letterSpacing,
    lineHeight = 1.12,
    renderSvgContent,
    className,
    style,
  } = props;
  const frame = useCrackedGlassFrame(t, pattern, fx);
  const fxFull = useMemo(() => normalizeEffectParams(fx), [fx]);
  const q = resolveQuality(fxFull.quality);
  const w = pattern.width;
  const h = pattern.height;
  const iid = `${pattern.instanceId}-t`;

  const lines = Array.isArray(text) ? text : [text];
  const fontSize = props.fontSize ?? Math.floor(h / (lines.length * 1.7));

  // Static per-pattern geometry strings.
  const geo = useMemo(
    () => ({
      clipD: pattern.shards.map((s) => toSvgPathD(s.polygon, true)),
      bbox: pattern.shards.map((s) => {
        const pts = unflattenPts(s.polygon);
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (const p of pts) {
          if (p[0] < x0) x0 = p[0];
          if (p[1] < y0) y0 = p[1];
          if (p[0] > x1) x1 = p[0];
          if (p[1] > y1) y1 = p[1];
        }
        return { x0, y0, x1, y1 };
      }),
    }),
    [pattern],
  );

  const hasChroma = fxFull.chroma.mode !== 'none' && fxFull.chroma.offsetPx > 0;
  const hasDisp = fxFull.refraction.offsetPx > 0;
  const hasBlur = fxFull.optics.blurPx > 0 && q.maxBlurPx > 0;
  const dispFreq = fmt(10 / Math.max(w, h), 4);

  const totalTextH = lines.length * fontSize * lineHeight;
  const firstBaseline = (h - totalTextH) / 2 + fontSize * 0.86;

  return (
    <svg
      className={className}
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ display: 'block', isolation: 'isolate', overflow: 'visible', transform: 'translateZ(0)', ...style }}
    >
      <defs>
        <g id={`${iid}-content`}>
          {renderSvgContent ? (
            renderSvgContent()
          ) : (
            <text
              x={w / 2}
              y={firstBaseline}
              textAnchor="middle"
              fontFamily={fontFamily}
              fontSize={fontSize}
              fontWeight={fontWeight}
              letterSpacing={letterSpacing}
              fill={fill}
            >
              {lines.map((line, i) => (
                <tspan key={i} x={w / 2} y={firstBaseline + i * fontSize * lineHeight}>
                  {line}
                </tspan>
              ))}
            </text>
          )}
        </g>
        {pattern.shards.map((s, i) => (
          <clipPath key={s.id} id={`${iid}-clip${i}`} clipPathUnits="userSpaceOnUse">
            <path d={geo.clipD[i]} />
          </clipPath>
        ))}
        {pattern.shards.map((s, i) => {
          const r = frame.shards[i].raw;
          const b = geo.bbox[i];
          const pad = Math.abs(r.chromaDx) + Math.abs(r.chromaDy) + fxFull.refraction.offsetPx * 2 + r.blurPx * 3 + 12;
          const slope = r.brightness * r.contrast;
          const intercept = r.brightness * ((1 - r.contrast) / 2);
          let src = 'SourceGraphic';
          const nodes: ReactNode[] = [];
          if (hasChroma) {
            nodes.push(
              <feColorMatrix key="cr" in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="cr" />,
              <feOffset key="cro" in="cr" dx={fmt(r.chromaDx)} dy={fmt(r.chromaDy)} result="cro" />,
              <feColorMatrix key="cg" in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="cg" />,
              <feColorMatrix key="cb" in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="cb" />,
              <feOffset key="cbo" in="cb" dx={fmt(-r.chromaDx)} dy={fmt(-r.chromaDy)} result="cbo" />,
              <feBlend key="rg" in="cro" in2="cg" mode="screen" result="rg" />,
              <feBlend key="rgb" in="rg" in2="cbo" mode="screen" result="rgb" />,
            );
            src = 'rgb';
          }
          if (hasDisp) {
            nodes.push(
              <feTurbulence
                key="noise"
                type="turbulence"
                baseFrequency={dispFreq}
                numOctaves={2}
                seed={s.hash % 9973}
                result="noise"
              />,
              <feDisplacementMap
                key="disp"
                in={src}
                in2="noise"
                scale={fmt(Math.hypot(r.refraction.dx, r.refraction.dy) * 2.2)}
                xChannelSelector="R"
                yChannelSelector="G"
                result="disp"
              />,
            );
            src = 'disp';
          }
          if (hasBlur) {
            nodes.push(<feGaussianBlur key="blur" in={src} stdDeviation={fmt(r.blurPx)} result="blurred" />);
            src = 'blurred';
          }
          nodes.push(
            <feComponentTransfer key="bc" in={src}>
              <feFuncR type="linear" slope={fmt(slope, 4)} intercept={fmt(intercept, 4)} />
              <feFuncG type="linear" slope={fmt(slope, 4)} intercept={fmt(intercept, 4)} />
              <feFuncB type="linear" slope={fmt(slope, 4)} intercept={fmt(intercept, 4)} />
            </feComponentTransfer>,
          );
          return (
            <filter
              key={s.id}
              id={`${iid}-f${i}`}
              x={fmt(b.x0 - pad)}
              y={fmt(b.y0 - pad)}
              width={fmt(b.x1 - b.x0 + pad * 2)}
              height={fmt(b.y1 - b.y0 + pad * 2)}
              filterUnits="userSpaceOnUse"
              primitiveUnits="userSpaceOnUse"
              colorInterpolationFilters="sRGB"
            >
              {nodes}
            </filter>
          );
        })}
        {pattern.shards.map((s, i) => {
          const r = frame.shards[i].raw;
          return (
            <linearGradient
              key={s.id}
              id={`${iid}-facet${i}`}
              gradientTransform={`rotate(${fmt(r.facetAngleDeg, 1)} 0.5 0.5)`}
            >
              <stop offset="0%" stopColor={`rgba(255,255,255,${fmt(r.facetWhite, 3)})`} />
              <stop offset="38%" stopColor="rgba(255,255,255,0)" />
              <stop offset="62%" stopColor="rgba(0,0,0,0)" />
              <stop offset="100%" stopColor={`rgba(0,0,0,${fmt(r.facetBlack, 3)})`} />
            </linearGradient>
          );
        })}
        {frame.shards.map((sf, i) => {
          if (!sf.spectrum) return null;
          // userSpaceOnUse axis along the light direction: identical band math to the HTML
          // tier and no objectBoundingBox skew for non-square shards.
          const rad = (sf.spectrum.angleDeg * Math.PI) / 180;
          const dirX = Math.cos(rad);
          const dirY = Math.sin(rad);
          let tMin = Infinity;
          let tMax = -Infinity;
          for (const [cx2, cy2] of [
            [0, 0],
            [w, 0],
            [w, h],
            [0, h],
          ]) {
            const p = cx2 * dirX + cy2 * dirY;
            if (p < tMin) tMin = p;
            if (p > tMax) tMax = p;
          }
          const c = sf.spectrum.center01;
          const hw = sf.spectrum.width01 / 2;
          const off = (v: number) => fmt(Math.max(0, Math.min(1, v)), 4);
          return (
            <linearGradient
              key={sf.id}
              id={`${iid}-spec${i}`}
              gradientUnits="userSpaceOnUse"
              x1={fmt(dirX * tMin)}
              y1={fmt(dirY * tMin)}
              x2={fmt(dirX * tMax)}
              y2={fmt(dirY * tMax)}
            >
              <stop offset={off(c - hw)} stopColor="rgba(255,70,70,0)" />
              <stop offset={off(c - hw * 0.6)} stopColor="rgba(255,70,70,0.85)" />
              <stop offset={off(c - hw * 0.25)} stopColor="rgba(255,210,70,0.85)" />
              <stop offset={off(c)} stopColor="rgba(110,255,150,0.85)" />
              <stop offset={off(c + hw * 0.35)} stopColor="rgba(80,200,255,0.85)" />
              <stop offset={off(c + hw * 0.65)} stopColor="rgba(170,100,255,0.85)" />
              <stop offset={off(c + hw)} stopColor="rgba(170,100,255,0)" />
            </linearGradient>
          );
        })}
        <clipPath id={`${iid}-rect`}>
          <rect x="0" y="0" width={w} height={h} />
        </clipPath>
        <radialGradient id={`${iid}-spark`}>
          <stop offset="0%" stopColor="rgba(255,255,255,0.95)" />
          <stop offset="35%" stopColor="rgba(255,255,255,0.5)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
        {frame.grain && (
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
        )}
      </defs>

      {/* shards (fixed z-order from the pattern) */}
      {frame.shards
        .map((sf, i) => ({ sf, i, z: sf.zIndex }))
        .sort((a, b) => a.z - b.z)
        .map(({ sf, i }) => {
          const s = pattern.shards[i];
          const [cx, cy] = s.centroid;
          // rigid scale included (punched plug shrink) - keeps the SVG tier in lockstep with HTML
          const rigid = `translate(${fmt(sf.raw.rigid.dx)} ${fmt(sf.raw.rigid.dy)}) rotate(${fmt(sf.raw.rigid.rotZ, 3)} ${fmt(cx)} ${fmt(cy)}) translate(${fmt(cx)} ${fmt(cy)}) scale(${fmt(sf.raw.rigid.scale, 4)}) translate(${fmt(-cx)} ${fmt(-cy)})`;
          const rf = sf.raw.refraction;
          const refr = `translate(${fmt(rf.dx)} ${fmt(rf.dy)}) rotate(${fmt(rf.rot, 3)} ${fmt(cx)} ${fmt(cy)}) translate(${fmt(cx)} ${fmt(cy)}) scale(${fmt(rf.scale, 4)}) translate(${fmt(-cx)} ${fmt(-cy)})`;
          return (
            <g
              key={sf.id}
              clipPath={`url(#${iid}-clip${i})`}
              transform={rigid}
              opacity={sf.opacity}
              style={{ isolation: 'isolate' }}
            >
              <g filter={`url(#${iid}-f${i})`}>
                {/* content-smear trail INSIDE the shared filter: the channel split and
                    displacement run once over the merged group - chroma on the trail for free */}
                {sf.smear.map((sm, k) => (
                  <g key={k} transform={`translate(${fmt(sm.dx)} ${fmt(sm.dy)})`} opacity={sm.opacity}>
                    <g transform={refr}>
                      <use href={`#${iid}-content`} />
                    </g>
                  </g>
                ))}
                <g transform={refr}>
                  <use href={`#${iid}-content`} />
                </g>
              </g>
              {sf.facet && (
                <path
                  d={geo.clipD[i]}
                  fill={`url(#${iid}-facet${i})`}
                  style={{ mixBlendMode: sf.facet.mixBlendMode as CSSProperties['mixBlendMode'] }}
                  opacity={sf.facet.opacity}
                />
              )}
              {sf.spectrum && (
                <path
                  d={geo.clipD[i]}
                  fill={`url(#${iid}-spec${i})`}
                  style={{ mixBlendMode: sf.spectrum.mixBlendMode as CSSProperties['mixBlendMode'] }}
                  opacity={sf.spectrum.opacity}
                />
              )}
              {sf.bevel.map((b, k) => (
                // per-path blends work here: the shard <g> is an isolated group within one svg
                <path
                  key={`b${k}`}
                  d={b.d}
                  fill="none"
                  stroke={b.stroke}
                  strokeWidth={fxFull.bevel.widthPx}
                  strokeLinecap="round"
                  opacity={b.opacity}
                  style={{ mixBlendMode: b.mixBlendMode as CSSProperties['mixBlendMode'] }}
                />
              ))}
            </g>
          );
        })}

      {/* crack layer */}
      <g
        clipPath={`url(#${iid}-rect)`}
        opacity={frame.cracks.opacity}
        style={{ mixBlendMode: frame.cracks.style.blendMode as CSSProperties['mixBlendMode'] }}
      >
        <path d={frame.cracks.shadowPath} fill={frame.cracks.style.shadowColor} />
      </g>
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
          <polygon key={m.id} points={m.points} transform={m.transform} opacity={m.opacity} fill={m.fill} />
        ))}
      </g>
      {frame.grain && (
        <rect
          x="0"
          y="0"
          width={w}
          height={h}
          filter={`url(#${iid}-grain)`}
          opacity={frame.grain.opacity}
          style={{ mixBlendMode: 'overlay' }}
        />
      )}
    </svg>
  );
}
