/**
 * Public types of cracked-glass.
 *
 * Everything in this library is a pure function of (seed, params) and time `t`:
 *   generateFracture(opts)            -> FracturePattern   (t-independent, frozen)
 *   computeFrame(t, pattern, fx)      -> FrameData         (plain numbers + ready style strings)
 *
 * No clocks, no Math.random, no mutable state between calls.
 */

export type Vec2 = readonly [number, number];

export type FractureMode = 'title' | 'radial' | 'collapse' | 'hero' | 'web';

/** Options for generateFracture(). width/height/seed are mandatory: the library never measures the DOM. */
export interface FractureOptions {
  mode: FractureMode;
  /** Design-space width in px. The pattern is generated for this exact size. */
  width: number;
  /** Design-space height in px. */
  height: number;
  /** Master seed. Same (seed, options) -> bit-identical pattern. */
  seed: number;
  /**
   * Prefix for SVG ids (filters/gradients/clipPaths live inside self-contained <svg> blocks).
   * Defaults to a seed-derived string. Two same-seed instances mounted simultaneously
   * on one page must be given distinct instanceIds.
   */
  instanceId?: string;
  /** Midpoint-subdivision depth for conchoidal edge detail. 0 = straight cracks. Default 2. */
  edgeDetail?: 0 | 1 | 2 | 3;
  /** 0..1 amplitude of conchoidal jagging along crack edges. Default 0.5. */
  jaggedness?: number;
  /** Outset (px) applied to the opaque content clip of each shard to hide antialiasing seams. Default 0.4. */
  seamOutsetPx?: number;
  /**
   * 0..1 amount of "veering": a minority of cracks deviating strongly from the main flow
   * (excursions/kinks). 0 reproduces pre-deviation geometry byte-identically. Default 0.35.
   */
  deviation?: number;
  /** Micro-debris shards. `false` disables. Default: mode-specific count. */
  micro?: { count?: number; sizeRange?: [number, number] } | false;

  /** mode 'title': near-horizontal bands. */
  bands?: {
    /** Band count or [min,max] range to pick from. Default [3,5]. */
    count?: number | [number, number];
    /** 0..1 low-frequency waviness of band boundaries. Default 0.5. */
    waviness?: number;
    /** 0..1 chance scale for diagonal splitters. Default 0.6. */
    diagonalChance?: number;
    /** 0..1 boundary tilt: bands wedge instead of running parallel. 0 = v0.3 geometry. Default 0.6. */
    tilt?: number;
    /** Max splitters per band (1..3). 1 = v0.3 single-splitter behavior. Default 3. */
    splitters?: number;
  };

  /** mode 'radial': impact point in design-space px. Default: container center. */
  impact?: { x: number; y: number };
  /** mode 'radial': scale of the punched-out impact hole (crush zone). Default 1, clamp 0.3..3. */
  impactHole?: number;
  rays?: {
    /** Base ray count. Default 8. */
    count?: number;
    /** 0..1 angular jitter of rays within their slot. Default 0.6. */
    angleJitter?: number;
    /** 0..1 lateral waviness of rays (amplitude scales with local spacing - rays cannot cross). Default 0.5. */
    waviness?: number;
    /** Insert secondary rays starting at ring `doublingStartRing` (keeps cells from getting too wide). Default true. */
    doubling?: boolean;
    /** Ring index from which secondary rays exist. Default 2. */
    doublingStartRing?: number;
  };
  rings?: {
    /** Concentric crack ring count (excluding the virtual outer boundary). Default 4. */
    count?: number;
    /** Radial spacing law. Default 'geometric' (denser near impact). */
    spacing?: 'uniform' | 'geometric';
    /** 0..1 per-anchor radius jitter. Default 0.5. */
    jitter?: number;
    /**
     * 0..1 ring incompleteness: real concentric cracks are PARTIAL arcs, never closed circles.
     * Dropped arcs merge radially-adjacent cells (uneven fragment sizes). 0 = v0.3. Default 0.88.
     */
    partial?: number;
    /**
     * 0..1 directional asymmetry: a real impact breaks one side harder than the other. A
     * seeded "calm side" drops more ring arcs (bigger, fewer pieces there) while the opposite
     * side stays dense. 0 = symmetric (pre-v0.6 keep map). Default 0.45.
     */
    asymmetry?: number;
  };

  /**
   * mode 'web': a thrown-object spider crack - rays from a center joined by straight-ish
   * polygonal rings (radius-bounded so cells never self-intersect), no punched hub and no
   * ray-doubling. Distinct from 'radial' (an impact transition with a punched center and
   * smooth arc rings). Irregularity comes from radius jitter, partial rings and asymmetry.
   */
  web?: {
    /** Primary ray count. Default 7. */
    rays?: number;
    /** Concentric ring count. Default 4. */
    rings?: number;
    /** 0..1 extra radius jitter for uneven cells. Default 0.6. */
    irregularity?: number;
  };

  /** mode 'collapse': two transversal families of wavy crack lines -> irregular quad mesh that crumbles. */
  collapse?: {
    /** Direction of family A in degrees. Default 14. */
    angleA?: number;
    /** Direction of family B in degrees (clamped so the families stay >= 35 deg apart). Default 76. */
    angleB?: number;
    /** Interior line count of family A, or [min,max]. Default [3,5]. */
    countA?: number | [number, number];
    /** Interior line count of family B, or [min,max]. Default [4,7]. */
    countB?: number | [number, number];
    /** 0..1 line waviness. Default 0.5. */
    waviness?: number;
    /** 0..1 chance to drop B-separators, merging cells along the A direction. 0 = v0.3. Default 0.3. */
    merge?: number;
  };

  /**
   * Dead-end hairline cracks running from main cracks into shard interiors
   * (render-only: they never split geometry). `false` disables. Default on.
   */
  stubs?: { maxPerCrack?: number; atJunctions?: boolean } | false;

  /**
   * Corner relief: a short diagonal crack that lops the perfect 90-degree shard off each
   * canvas corner (real panes never break to a clean right angle). Watertight - the chord
   * is shared by the two pieces. Applies to title/radial/collapse; skipped for hero and for
   * corners owned by 0 or 2 shards, the crush plug, or sub-pixel edges. `relief` 0..1 sizes
   * the cut. 0 or `false` reproduces pre-corner-relief geometry. Default 0.55.
   */
  corners?: { relief?: number } | false;

  /**
   * mode 'hero': free-floating standalone shards (no pane partition, no cracks).
   * Every edge of a hero shard is a fully jagged fracture face - built for close-up
   * scenes where a single shard levitates over content.
   */
  hero?: {
    /** Number of floating shards (1..3). Default 1. */
    count?: number;
    /** Shard radius as a fraction of min(width, height). Default 0.34. */
    sizeFrac?: number;
    /** 0..1 distance between shards when count > 1 (0 = touching). Default 0.5. */
    spread?: number;
    /** 0..1 pulls shards together until they visibly overlap (z-stack). Default 0. */
    overlap?: number;
  };
}

/** One crack polyline. Shared by the two adjacent shards -> watertight by construction. */
export interface CrackPolyline {
  id: string;
  kind: 'ray' | 'ring' | 'band' | 'split' | 'crush' | 'mesh' | 'stub';
  /** For kind 'stub': index of the parent crack in pattern.cracks. */
  parent?: number;
  /** Flat [x0,y0, x1,y1, ...]. Direction = growth direction during propagation. */
  points: number[];
  /** Cumulative arc length per point (same length as points/2). */
  cumLen: number[];
  totalLen: number;
  /** 0..1 position inside the crack phase at which this polyline starts growing. */
  birth: number;
  /** 0..1 duration (in crack-phase progress units) of its growth. */
  growDuration: number;
  /** Hackle ticks: flat [s, ax,ay, bx,by]* - tick at arc-length s, segment a->b. */
  ticks: number[];
}

export interface Shard {
  id: string;
  /** Exact polygon, flat [x,y]*, normalized winding (positive shoelace area in screen coords). */
  polygon: number[];
  /** Same polygon outset by seamOutsetPx along outward edge normals (for the opaque content clip). */
  outsetPolygon: number[];
  centroid: Vec2;
  area: number;
  /** Ring index (radial) or band index (title); drives shatter stagger. */
  ringIndex: number;
  /** Fixed paint order rank (0..n-1), chosen at generation time, never re-sorted by t. */
  z: number;
  /** Per-shard rng key for all derived per-shard randomness. */
  hash: number;
}

export interface MicroShardSeed {
  id: string;
  /** Small polygon in local coords centered at (0,0), flat [x,y]*. */
  polygon: number[];
  /** Spawn origin in design space. */
  origin: Vec2;
  hash: number;
  /** 0..1 position inside the crack phase at which it becomes visible. */
  birth: number;
  /** Ring/band index for shatter stagger. */
  ringIndex: number;
}

export interface FracturePattern {
  version: 6;
  mode: FractureMode;
  width: number;
  height: number;
  seed: number;
  instanceId: string;
  impact: Vec2;
  shards: Shard[];
  cracks: CrackPolyline[];
  micro: MicroShardSeed[];
}

export type QualityPreset = 'draft' | 'normal' | 'high';

export interface QualitySettings {
  /** Extra content clones for ghost-mode chromatic aberration (0 disables ghost chroma). */
  chromaGhosts: 0 | 1 | 2;
  /** Whole-shard ghost copies during shatter (off by default since v0.2 - see smearGhosts). */
  motionGhosts: 0 | 2 | 3 | 4;
  /** Content-smear copies inside each flying shard (motion blur of the content, crisp edges). */
  smearGhosts: 0 | 1 | 2 | 3;
  /** Per-shard edge bevel highlight layer. */
  bevel: boolean;
  /** Edge refraction ring (one extra content clone per shard when enabled). */
  edgeDistortion: boolean;
  /** Spectral dispersion flares (1-2 blended gradient layers). */
  spectrum: boolean;
  /** Cap on rendered dead-end hairline cracks (stable prefix of the stub list). */
  stubCap: number;
  /** Hard cap for blur radii emitted anywhere. */
  maxBlurPx: number;
  /** Static feTurbulence film grain overlay. */
  grain: boolean;
  /** Cap on rendered micro shards. */
  microShardCap: number;
}

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'soft-light'
  | 'lighten'
  | 'darken'
  | 'color-dodge'
  | 'plus-lighter';

export interface TimelineParams {
  /** t at which cracks start propagating. */
  crackStart: number;
  /** t at which the crack network is complete. */
  crackEnd: number;
  /** t at which shards start flying. Infinity = never (static cracked state). */
  shatterStart: number;
}

export interface EffectParams {
  quality: QualityPreset | QualitySettings;
  timeline: TimelineParams;
  /**
   * What the fracture breaks:
   * - 'content': the content itself shatters; each piece carries its image away (v0.4).
   * - 'glass':   a glass pane lies OVER the content; shards are moving lenses - the
   *   content stays anchored to the pane and is seen REFRACTED through each flying
   *   silhouette. The component renders one unclipped base content layer underneath,
   *   so vanished shards (punch/drop/fadeOut) reveal the undistorted content.
   *   Notes: rigid 3D tumble is disabled in this medium (a clipped wrapper flattens
   *   transforms, making exact compensation impossible); whole-shard motion ghosts are
   *   off; content motion blur is expressed via speed-scaled blur only. Glass cannot
   *   reveal a second screen - use 'content' for screen transitions.
   *   Scope: each lens refracts only the underlying content; shards never see each
   *   other (no neighbor reflections, no compounded refraction in overlaps).
   */
  medium: 'content' | 'glass';
  /** Per-shard refraction of the content inside the (stationary) shard shape. */
  refraction: {
    /** Max lateral content shift in px (per-shard magnitude/direction derived from shard hash). */
    offsetPx: number;
    /** Max in-plane content rotation in deg. */
    rotateDeg: number;
    /** Max content scale deviation (0.02 -> +-2%). */
    scaleAmp: number;
    /** Max pseudo-3D plate tilt in deg (0 disables 3D transforms entirely - crispest text). */
    tiltDeg: number;
    /** Perspective distance for the tilt, px. */
    perspectivePx: number;
  };
  optics: {
    /** Max brightness deviation from facet lighting (0.12 -> 0.88..1.12). */
    brightnessAmp: number;
    /** Max contrast deviation. */
    contrastAmp: number;
    /** Per-shard content blur, px (capped by quality.maxBlurPx). */
    blurPx: number;
    /** Light direction in degrees (0 = +x, positive clockwise in screen coords). */
    lightAngleDeg: number;
    /** Opacity of the static grain overlay when quality.grain is on. */
    grainOpacity: number;
    /**
     * Keep facet highlights, chroma dispersion, the spectral flare and facet brightness
     * tracking the GLOBAL light while a shard spins/flies (the bevel always does).
     * false = v0.4 behavior: those layers rotate away with the shard (byte anchor).
     */
    trackLight: boolean;
  };
  /** Chromatic aberration / spectral split. */
  chroma: {
    /**
     * 'shadow': two colored drop-shadow() silhouettes along the dispersion angle - zero extra DOM,
     *           ideal for text/alpha content.
     * 'ghost':  hue-rotated screen-blended content clones - works on opaque imagery
     *           (count capped by quality.chromaGhosts).
     * 'none':   disabled.
     */
    mode: 'shadow' | 'ghost' | 'none';
    offsetPx: number;
    /** Dispersion direction in degrees. */
    angleDeg: number;
    opacity: number;
    blendMode: BlendMode;
    /** Fringe colors for 'shadow' mode (any CSS color, alpha welcome). */
    colorA: string;
    colorB: string;
  };
  /** The glass facet layer drawn over the content of each shard (the white/black faces). */
  facet: {
    /** 0..1 strength of the white->black facet gradient. */
    strength: number;
    /** Extra uniform tint laid under the gradient (use rgba with low alpha). '' disables. */
    tint: string;
    opacity: number;
    blendMode: BlendMode;
  };
  crackStyle: {
    coreColor: string;
    coreWidth: number;
    shadowColor: string;
    shadowWidth: number;
    /** Offset of the dark "crack face" ribbon, px (direction opposite to the light). */
    shadowOffsetPx: number;
    /** 0..1 thickness variation along the crack (real cracks are never uniform). */
    widthVariance: number;
    /** 0..1 amount of "second fracture face" filaments running parallel to the crack. */
    doubleEdge: number;
    /** 0..1 density of dead-end hairline cracks running into shard interiors. */
    subCracks: number;
    /**
     * 0..1 brightness modulation along a crack: real cracks are blinding-bright in some
     * stretches and nearly invisible in others. 0 = uniform (v0.3).
     */
    brightnessVar: number;
    /** 0..1 density of perpendicular hackle ticks. */
    hackleDensity: number;
    /** Bright impact sparkle (radial mode). */
    sparkle: boolean;
    /**
     * Per-crack propagation curve over its own growth window: real cracks race to full
     * length almost instantly, then hold (the "money frame") before the shards depart.
     * 'snap' (default) reaches full length by ~40% of the window then holds; 'expo' is
     * fast-but-eased; 'quart' is the gentle pre-v0.6 curve (byte anchor).
     */
    growth: 'snap' | 'expo' | 'quart';
    /** Blend mode of the dark shadow ribbon layer. */
    blendMode: BlendMode;
  };
  /** Per-shard edge bevel: the visible glass thickness catching/blocking light. */
  bevel: {
    widthPx: number;
    /** 0..1 overall strength. */
    intensity: number;
    /** Extra glint while a shard tumbles through the light. */
    glintStrength: number;
    lightColor: string;
    darkColor: string;
    /** Blend mode of LIT bevel sectors (dark sectors always paint 'normal' to stay visible). */
    blendMode: BlendMode;
    /**
     * 0..1 conchoidal scatter: a real fracture face shows INTERLEAVED highlight and shadow
     * segments along one edge (micro-facet refraction); the global light only biases the mix.
     * 0 = v0.3 single-light law.
     */
    scatter: number;
    /**
     * 0..1 per-sector facet variation: each edge sector breaks at a slightly different angle
     * and reflects with a different intrinsic brightness, so the bevel stops reading as one
     * uniform white line and the sectors shimmer independently as the shard turns.
     * 0 = uniform v0.5 law (byte anchor). Default 0.6.
     */
    facetVariation: number;
  };
  /** Behavior of the radial impact crush disc (geometry size lives in FractureOptions.impactHole). */
  crush: {
    /** Knock the center plug clean through during cracking (leaves a real hole). */
    punch: boolean;
    /** Scale the plug shrinks to while being punched through. */
    scaleTo: number;
  };
  /**
   * Outlier shards that break the system (the glitch-animation principle: rules + exceptions).
   * Classification is a pure function of shard.hash - identical across frames and between
   * the style and motion layers.
   */
  outliers: {
    /** Fraction of shards that fall out whole during cracking (leave a hole in the pane). */
    dropFraction: number;
    /** Fraction that visibly slip out of alignment (rigid offset + rotation) in the cracked state. */
    slipFraction: number;
    /** Fraction that disobey the shatter timing/direction (early/late, off-axis, faster). */
    rebelFraction: number;
    /** Slip distance, px. */
    slipPx: number;
    /** Max slip rotation, deg. */
    slipRotDeg: number;
  };
  /**
   * Spectral decomposition flare: a subtle rainbow band on the 1-2 shards best aligned
   * with the light source (never random positions).
   */
  spectrum: {
    /** How many shards carry the flare. 0 disables. */
    count: number;
    opacity: number;
    /** Band width relative to the shard's own extent along the light axis. */
    bandWidth: number;
    blendMode: BlendMode;
    /**
     * 0..1: pull the flare to the shard rim (dispersion happens at the fractured faces,
     * not across the body) and weight the selection toward SMALL shards. The band is
     * clipped to a perimeter ring and centered on the light-facing rim. 0 = v0.3
     * full-body band with alignment-only selection (byte anchor).
     */
    edgeOnly: number;
  };
  shatter: {
    /** Initial speed in px per unit of t. */
    speed: number;
    /** Optional override of the flight direction in degrees (default: per-mode law). */
    direction?: number;
    /** Gravity in px/t^2. */
    gravity: Vec2;
    /** Air drag coefficient (1/t units). 0 = none. */
    drag: number;
    /** Max in-plane spin in deg per unit t. */
    spinDegMax: number;
    /** Max 3D tumble in deg per unit t (0 keeps shards flat - cheaper, crisper). */
    tumbleDegMax: number;
    /** Birth delay per ring/band index, in t units. */
    staggerPerRing: number;
    /** 0..1 randomization of speeds/delays. */
    jitter: number;
    /** Absolute-t window over which flying shards fade out (only applies during shatter). */
    fadeOut: [number, number];
  };
  motionBlur: {
    /** Whole-shard ghost copies (capped by quality.motionGhosts; 0 by default since v0.2). */
    ghosts?: number;
    /** Time offset between smear/ghost samples, in t units. */
    dt: number;
    /** Opacity multiplier per smear/ghost step. */
    opacityFalloff: number;
    /** Minimum speed (px/t) for smear/ghosts to appear. */
    speedThreshold: number;
    /** Cap (px) for the total content-smear trail length inside a shard. */
    smearPx: number;
    /** Max extra speed-scaled blur added to the content of fast shards (capped by quality.maxBlurPx). */
    smearBlurPx: number;
  };
  micro: {
    opacity: number;
    /** Micro debris speed relative to shard speed. */
    speedScale: number;
    fill: string;
    fillAlt: string;
  };
  /** Damped wobble of the cracked-static state. amplitude 0 = frozen. */
  settle: {
    amplitudePx: number;
    frequency: number;
  };
  /**
   * Edge refraction band: a ring along the shard perimeter where the content refracts
   * noticeably harder than in the interior - the fractured faces act as prisms and
   * visibly distort whatever sits behind the rim. strength 0 disables the layer (v0.4).
   */
  edgeDistortion: {
    /** Ring width in px, measured inward from the shard outline. */
    widthPx: number;
    /** 0..1 how much harder the rim refracts vs the interior. 0 = off. */
    strength: number;
    /** Extra blur inside the ring, px (capped by quality.maxBlurPx). */
    blurPx: number;
  };
  /**
   * Levitation of free shards (mode 'hero' only; ignored elsewhere). Pure sinusoids of t -
   * integer `cycles` loop seamlessly over t in [0, 1].
   */
  float: {
    /** Vertical bob amplitude, px. */
    bobPx: number;
    /** Horizontal sway amplitude, px. */
    swayPx: number;
    /** In-plane rocking amplitude, deg. */
    rotDeg: number;
    /** Full bob cycles over t in [0, 1]. */
    cycles: number;
  };
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends string | number | boolean | undefined | null
    ? T[K]
    : T[K] extends ReadonlyArray<unknown>
      ? T[K]
      : T[K] extends object
        ? DeepPartial<T[K]>
        : T[K];
};

export type Phase = 'intact' | 'cracking' | 'cracked' | 'shattering';

/** Everything needed to paint one shard. Strings are ready-to-assign CSS values. */
export interface ShardFrame {
  id: string;
  /** clip-path for the shard wrapper (outset polygon), 'polygon(..px ..px, ...)'. */
  clipPath: string;
  /** Exact-polygon clip for chroma ghosts / facet layer. */
  innerClipPath: string;
  /** 'Xpx Ypx' (shard centroid). */
  transformOrigin: string;
  /** Rigid flight transform of the whole clipped shard. */
  shardTransform: string;
  /** Refraction transform of the content inside the shard. */
  contentTransform: string;
  /** url()-free filter list for the content clone ('' if none). */
  contentFilter: string;
  opacity: number;
  zIndex: number;
  facet: { background: string; mixBlendMode: BlendMode; opacity: number } | null;
  /**
   * Rainbow dispersion flare - only on the shards best aligned with the light source
   * (selection is t-independent). angleDeg/center01/width01 are the raw numbers the SVG
   * renderer needs (center/width as fractions of the pane's projection onto the light axis).
   */
  spectrum: {
    background: string;
    mixBlendMode: BlendMode;
    opacity: number;
    angleDeg: number;
    center01: number;
    width01: number;
    /** Present when spectrum.edgeOnly > 0: CSS `path("...")` ring clip (perimeter band). */
    clipPath?: string;
    /** Raw ring path d for the SVG tier (outer loop + reversed inner loop, nonzero fill). */
    d?: string;
  } | null;
  /**
   * Edge refraction ring: one extra content clone clipped to a perimeter ring. The ring
   * path is the outer outline plus a REVERSED inner inset loop - the default nonzero
   * fill rule punches the hole, so no evenodd support is required anywhere.
   * null when edgeDistortion.strength is 0 or the quality tier disables it.
   */
  edge: {
    /** CSS `path("...")` clip for the HTML tier. */
    clipPath: string;
    /** Raw ring path d for the SVG tier <clipPath>. */
    d: string;
    /** Amplified refraction transform of the ring content (CSS value). */
    transform: string;
    /** url()-free filter list for the ring clone. */
    filter: string;
    opacity: number;
    /** Raw amplified-refraction numbers for the SVG tier. */
    dx: number;
    dy: number;
    rot: number;
    scale: number;
  } | null;
  /** Ghost-mode chroma clones ([] in shadow/none mode). */
  chroma: Array<{
    transform: string;
    filter: string;
    mixBlendMode: BlendMode;
    opacity: number;
  }>;
  /** Whole-shard motion ghosts ([] outside shatter; off by default since v0.2). */
  ghosts: Array<{ shardTransform: string; opacity: number }>;
  /**
   * Content-smear copies (motion blur of the content while shard edges stay crisp).
   * ALWAYS exactly quality.smearGhosts entries (opacity 0 when idle) - constant DOM structure.
   * `transform` is the CSS value for the HTML tier; dx/dy are the raw local offsets for SVG.
   */
  smear: Array<{ transform: string; dx: number; dy: number; opacity: number }>;
  /** Light filter for smear copies ('brightness(..) contrast(..)'; no chroma shadows, no blur). */
  smearFilter: string;
  /**
   * Edge-bevel paths: per static normal-angle sector TWO entries (a lit one with the
   * configured blend mode and a dark 'normal' one) whose d/stroke/blend never change with t -
   * only opacity does (continuous handoff at the lit/dark boundary, zero structure popping).
   * [] when quality.bevel is false.
   */
  bevel: Array<{ d: string; stroke: string; mixBlendMode: BlendMode; opacity: number }>;
  /** Raw numbers behind the strings - consumed by the SVG renderer and tests. */
  raw: {
    rigid: { dx: number; dy: number; rotZ: number; rotX: number; rotY: number; scale: number };
    refraction: { dx: number; dy: number; rot: number; scale: number; tiltX: number; tiltY: number };
    /**
     * medium 'glass' only (null otherwise): the rigid components the inverse anchor was
     * built from, PRE-ROUNDED to the same precision as the wrapper string so the
     * wrapper/inverse pair cancels to the browser's own arithmetic. The SVG tier
     * composes: translate(cx cy) scale(1/scale) translate(-cx -cy) rotate(-rot cx cy)
     * [refraction] translate(-dx -dy).
     */
    glass: { dx: number; dy: number; rot: number; scale: number } | null;
    brightness: number;
    contrast: number;
    blurPx: number;
    chromaDx: number;
    chromaDy: number;
    facetAngleDeg: number;
    facetWhite: number;
    facetBlack: number;
  };
}

export interface FrameData {
  /** Clamped input t, echoed back. */
  t: number;
  phase: Phase;
  /** Always full length for every t (constant DOM structure - no popping between frames). */
  shards: ShardFrame[];
  cracks: {
    /** Bright-stretch ribbon FILL path at current propagation ('' when nothing visible). */
    corePath: string;
    /** Full-length dim ribbon FILL underlay (brightness modulation; '' when brightnessVar is 0). */
    coreDimPath: string;
    /** Dead-end hairline ribbons running into shard interiors ('' when disabled). */
    stubPath: string;
    /** Opacity of the dim underlay (1 - 0.65*brightnessVar; meaningless when brightnessVar is 0). */
    coreDimOpacity: number;
    /** Opacity of the bright-stretch overlay (ramps in continuously as brightnessVar leaves 0). */
    coreOpacity: number;
    /** Dark crack-face ribbon FILL path (offset opposite to the light). */
    shadowPath: string;
    /** Thin parallel "second face" filaments (STROKE path). */
    highlightPath: string;
    hacklePath: string;
    /** Whole crack layer opacity (fades out at shatter). */
    opacity: number;
    style: EffectParams['crackStyle'];
    sparkle: { cx: number; cy: number; r: number; opacity: number } | null;
  };
  /** Constant length (= min(pattern.micro.length, quality cap)); hidden entries have opacity 0. */
  micro: Array<{
    id: string;
    /** SVG points string in local coords. */
    points: string;
    /** SVG transform attribute string. */
    transform: string;
    opacity: number;
    fill: string;
  }>;
  grain: { opacity: number } | null;
}
