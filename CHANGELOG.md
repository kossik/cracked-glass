# Changelog

## 0.7.0

A direction pass on the fracture geometry: the `web` mode becomes a diverging off-screen fan,
corner relief becomes a real split cast *from* the corner, and the title bands gain diagonal
splitters plus a choice of how the pane comes apart. `FracturePattern.version` is now **7**
(the web/corner geometry and the new title splitter lean regenerate differently than v6).

### Added

- **`web.dir` / `web.distance`** — `mode: 'web'` is now a **diverging fan**: rays radiate from a
  point placed OFF the canvas (`web.dir` degrees, `web.distance` in units of the larger side) and
  fan ACROSS the frame — not a centered spider web, and not parallel. The cone and outer radius
  are derived so the fan always covers the whole canvas (the origin is clamped off-screen and the
  ring band is fit to the on-canvas strip, so even `rings: 1` tiles fully).
- **`bands.diagonal`** (title, default 0.7) — band splitters lean diagonally across each band
  (with and without a bend) instead of running near-vertical; each band leans one way so adjacent
  splitters never cross. `bands.diagonal: 0` restores the v0.6 vertical splitters.
- **`shatter.spread`** (`'fall'` default / `'slide'` / `'apart'`) — how a title pane comes apart:
  `fall` drops straight down (the v0.6 behaviour), `slide` slides each half outward then falls,
  `apart` splits the two halves toward the viewer's sides.
- **`shatter.preSpreadPx`** (default 0) — once cracked but before the fall, the pane drifts
  sideways by this many px (left half left, right half right), so the break reads before the drop.

### Changed

- **Corner relief is a real split FROM the corner** — instead of slicing a triangular ear off the
  90° corner, 1–2 cracks are cast from the corner vertex to existing vertices on a non-adjacent
  edge, splitting the corner piece into wedges (watertight, terminating only at shared vertices so
  no T-junction tear). Applies to all modes; `corners: false` still leaves corners whole.
- The lab defaults to the **horizontal** scene, with a baked glass preset, diagonal splitters,
  `slide` shatter, and a slab generated larger than the (overflow-clipped) title block so the pane
  edge starts beyond the frame and the edge pieces fly in on shatter. New `web` controls
  (`fan dir` / `fan distance`) and a `diagonal lean` control.

### Determinism

Every new parameter keeps a zero/false anchor reproducing v0.6 byte-for-byte (`bands.diagonal: 0`,
`shatter.spread: 'fall'` + `preSpreadPx: 0`, `corners: false`). The web fan, diagonal splitters and
corner split each passed an adversarial validation before coding and a review after — the review
caught a `rings: 1` coverage hole (a far origin let the outer ring boundary perturb below the
canvas), now fixed by pinning the boundary rings and fitting the band to the on-canvas strip.

## 0.6.0

A realism pass: a spider-web fracture mode, a less uniform and far cheaper radial, faster
glass-like crack timing, and per-sector bevel shimmer. `FracturePattern.version` is now **6**
(radial defaults and the new geometry regenerate differently than v5).

### Added

- **`mode: 'web'`** — a thrown-object spider crack: rays from a hub joined by angular polygonal
  rings (radius-bounded so cells never self-intersect, validated over a wide sweep). No punched
  center, no ray-doubling; irregularity from `web.irregularity`, partial rings and asymmetry.
  A realistic alternative to the diagonal `collapse` mesh (which is kept).
- **`rings.asymmetry`** (radial, default 0.45) — a real impact breaks one side harder: a seeded
  calm side drops more ring arcs (bigger, fewer pieces) while the opposite side stays dense.
- **`crackStyle.growth`** (`'snap'` default / `'expo'` / `'quart'`) — cracks now race to full
  length by ~40% of their window then HOLD (the money frame); `'quart'` is the pre-v0.6 ease.
- **`bevel.facetVariation`** (default 0.6) — each edge sector breaks at a slightly different
  angle and reflects with its own brightness, so the bevel stops reading as one uniform white
  line and the sectors shimmer independently as the shard turns.

### Changed

- **Radial is much lighter and less uniform**: default rays 8→6, partial 0.8→0.88,
  doublingStartRing 2→3 — roughly half the shard count (and DOM cost), with larger uneven
  pieces. The lab warns when a configuration gets heavy (>120 shards).
- **Faster, glass-like timing**: tighter default crack window, a clear hold, then the pieces
  FALL under gravity (radial/web shatter is gravity-dominant, not a uniform outward blast).
- The lab gains a `web` scene, a motion-preset selector, and `asymmetry` / `growth` /
  `facet variation` controls.

### Determinism

Every new parameter has a zero/default anchor reproducing v0.5 byte-for-byte (`asymmetry:0`,
`growth:'quart'`, `facetVariation:0`). The web generator was validated by adversarial review
(raw straight chords were rejected for self-intersecting cells) and reviewed after implementation.

### Not in this release

- **Jagged rim** — an oversized slab with a broken perimeter. Two validation rounds showed the
  outward-bleed + enlarged-viewBox form is not a bolt-on: it needs a generator-level shared
  perimeter and a render-contract change across many consumers. Tracked for a dedicated 0.7.

## 0.5.0

New optics, a second breaking medium, a floating mode, corner relief, motion presets, and an
interactive Lab deployed to GitHub Pages. `FracturePattern.version` is now **5** (corner relief
is on by default, so partition patterns regenerate differently than v4 for the same seed — pass
`corners: false` for the prior geometry).

### Added

- **`mode: 'hero'`** — 1–3 free shards levitating over content, every edge a fracture face
  (`fx.float` bob / sway / rock / cycles; integer cycles loop seamlessly over `t`).
- **`fx.medium: 'content' | 'glass'`** — `glass` makes the shards moving lenses over content
  anchored to the pane (the page seen through them stays put; only the refraction travels). The
  component renders its own base content layer, so vanished shards reveal it undistorted.
- **`fx.optics.trackLight`** — keep facet highlights, chroma dispersion, the spectral flare and
  facet brightness pointing at the global light as a shard spins (the bevel already did).
- **`fx.edgeDistortion`** — a perimeter prism ring that refracts the content harder at the
  fractured faces (url-free `path()` keyhole clip, both tiers).
- **`fx.spectrum.edgeOnly`** — pull the rainbow flare onto the lit rim and weight the carrier
  selection toward small shards.
- **Corner relief** (`corners: { relief }`, default on) — a diagonal chord lops the perfect
  90-degree shard off each canvas corner; watertight ear-cut, owner kept in place and the ear
  appended so no other shard is renumbered.
- **Motion presets** — `impactTimeline`, `suspenseTimeline`, `hardBlastShatter`,
  `gentleCrumbleShatter`, and the `motionPresets` map, exported alongside the existing
  `collapseShatterPreset` / `staticCrackedTimeline`.
- **The Lab** (`/lab.html`) — interactive control panel: every knob, scene presets, randomizers
  with group locks, `t` playback with easings, pin-and-compare, shareable URL state, and an
  exportable shot list for the capture tool. Auto-deployed to GitHub Pages
  (https://kossik.github.io/cracked-glass/lab.html). See [docs/LAB.md](docs/LAB.md).

### Determinism

- Every new parameter has a zero/default value that reproduces the prior output byte-for-byte;
  glass anchoring is verified on the *emitted* transform strings (parsed to matrices), not the
  raw numbers. The geometry and dual-tier wiring were validated by adversarial review before and
  after implementation.

### Not in this release

- **Jagged rim** (an oversized slab with a broken perimeter) — needs an enlarged render viewBox
  and generator-level shared-perimeter jagging; tracked for 0.6.

## 0.4.0

Naturalized fracture geometry (bifurcation, T-junctions, partial rings, dead-end hairlines),
honest per-edge bevel lighting (conchoidal scatter), brightness-modulated crack ribbons. First
public release on GitHub + npm.
