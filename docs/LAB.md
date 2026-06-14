# cracked-glass — the Lab

The Lab is an interactive control panel for the effect: every `fx` knob and fracture option
as a live control, scene presets, randomizers, `t` playback, side-by-side compare, and
shareable URLs. Use it to *find* a look — then read the state back off the controls (or a
shared link) and paste the equivalent `fx` into your code.

It is review/tuning tooling, not part of the published package — `cracked-glass` on npm ships
only the library (`dist/`). The Lab lives in the repo and is deployed for browser use.

- **Live:** https://kossik.github.io/cracked-glass/lab.html
- **Local:** `npm run dev`, then open `/lab.html` (the root `/` is the simpler demo).

The Lab is demo-side code, so it is free to use `requestAnimationFrame` and `Math.random` for
the UI. The library underneath stays a pure function of `t` — nothing you do in the Lab makes
the effect non-deterministic.

## Scenes

| Scene | What it shows |
|---|---|
| **hero-1** | one shard levitating over a page of text (glass medium) |
| **hero-2** | two stacked shards, with `spread` / `overlap` controls |
| **macro-edge** | a 4× magnifier parked on one shard's edge — for tuning rim optics |
| **radial** | impact-point screen transition |
| **horizontal** | title bands |
| **diagonal** | collapse / crumble mesh |

Switching a scene loads its default `t`, zoom and pan.

## The control panel

Controls are grouped into collapsible folders. Each group has a dice (randomize), a lock
(skip it on *shuffle all*), and a reset. A changed value is highlighted with a reset dot.

- **Mode** — `medium` (`content` = the content itself breaks; `glass` = a glass pane over
  anchored content, shards are moving lenses) and `track light` (highlights/chroma/flare keep
  pointing at the global light as a shard turns).
- **Fracture** — geometry per mode: hero `shard size` / `spread` / `overlap`; radial
  `rays` / `rings` / `partial rings` / `impact hole`; title `band tilt` / `splitters` /
  `waviness`; collapse `merge` / `angles`; plus shared `jaggedness` / `edge detail`.
- **Light** — `light angle`, brightness/contrast amplitude, content blur.
- **Refraction** — per-shard content offset / rotate / scale / tilt.
- **Edge** — the perimeter prism ring: `strength`, `width`, `blur`.
- **Chroma** — dispersion mode / offset / angle / opacity.
- **Facet & Bevel** — glass-face gradient and edge bevel (`intensity`, `glint`, `scatter`).
- **Spectrum** — the rainbow flare: shard count, opacity, band width, `edge only`.
- **Cracks** — core width, variance, sub-cracks, brightness variation, hackle (partition modes).
- **Outliers** — dropped / slipped / rebel fractions (partition modes).
- **Float** — hero levitation: bob / sway / rock / cycles.
- **Timeline / Shatter / Motion** — crack and shatter timing, flight speed/drag/spin/tumble,
  settle and motion blur (animated modes).

**Motion preset** (top of the panel) drops a whole timing + flight character in at once
(impact / suspense / crumble / poster); your individual control overrides still win on top.

**Seed** is the casting call — dice it until the composition lands.

## Playback

The transport bar drives `t`:

- **▶ / ⏸** plays `t` with a chosen **duration**, **loop** and **ping-pong**.
- **Easing** maps wall-clock onto `t`: `linear`, `ease-in-out`, or `impact` (the S-profile with
  a hold from the [creative guide](AGENT-GUIDE.md) — fast crack attack, a suspended read, then
  release). The library is already internally eased, so `linear` is the honest default; the
  other curves are for the *host's* pacing.
- The `t=…` chips jump to fixed marks.

## Compare, zoom, share

- **pin** freezes the current render next to the live one; tweak and compare side by side
  (toggle whether the pinned copy follows `t` or stays frozen).
- **zoom / pan** is a magnifier over the stage — for inspecting seams and rim optics
  (the macro-edge scene starts zoomed).
- **copy link** packs the entire state into the URL (`?s=…`). Open it anywhere to reproduce the
  exact render. Loose `?scene=&seed=&t=&quality=` params also work for tooling.
- **Presets** — built-in starting points plus your own (saved to `localStorage`).

## Shot lists → showcase

**+ shot** appends the current state and `t` to a list; **export shots** downloads
`cg-lab-shots.json`. Feed it to the capture tool to render reproducible PNGs:

```bash
node tools/showcase.mjs --shots cg-lab-shots.json
```

This is how the screenshots in the README are produced — a Lab session becomes a repeatable
render package, no manual screenshotting.

## Capture / determinism notes

Add `&capture=1` to any URL to hide the panels (what the capture tools use). The page exposes
`window.__cgSetT(v)` so a headless driver can seek `t`. Frame-capture engines should run
Chromium with `--num-raster-threads=1 --disable-partial-raster` (plus the software-render flags
in the README) for byte-identical frames.
