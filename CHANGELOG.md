# Changelog

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
