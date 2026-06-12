# cracked-glass — creative guide for AI agents

How to *play* this instrument when assembling a motion-graphics design system. The technical
side (API, determinism, renderers) lives in the [README](../README.md); this page covers mood,
pacing and the artistic levers.

## The core principle

The library is an instrument with a single time axis `t` (0→1) and physics built in. An agent
directs **character**, not keyframes: mood comes from `fx` and pattern parameters, pacing comes
from how the host maps scene time onto `t`. Everything inside is already eased (crack growth is
easeOutQuart, shard poses easeOutCubic, flight is closed-form ballistics with drag) — so feed
`t` **linearly** almost always and direct the timeline phases instead.

Animate **only `t`**. Never tween parameters (`fx`, seed, light) between frames — spectral-flare
carriers and DOM structure would re-select and pop.

## Mood → recipe

| Mood | Mode | Key levers |
|---|---|---|
| Impact, aggression, ad punch | `radial` | short crack phase (`{crackStart:0, crackEnd:0.2, shatterStart:0.25}`), `shatter.speed 1500+`, `drag 1.0`, `gravity [0,400]`, `bevel.intensity 0.9`, `chroma.mode 'ghost'` |
| Suspense, dread | `radial`/`title` | long crack phase (0→0.55), `shatterStart` late or `Infinity` — make the viewer wait; `crackStyle.brightnessVar 0.8`, `subCracks 0.9` keep the web alive |
| Melancholy, loss | `collapse` | `collapseShatterPreset`, `staggerPerRing 0.07` — pieces tear off reluctantly, one by one; low side light (`lightAngleDeg 160`), spectrum off (`spectrum.count 0`) |
| Glitch, techno, cyberpunk | any | `outliers {dropFraction:0.12, rebelFraction:0.25}`, `chroma.offsetPx 5-7`, `deviation 0.8` — a system with loud exceptions |
| Poster, cover art | `title` + `staticCrackedTimeline` | `t` barely matters; character = seed casting + light + a single spectral flare |

## Pacing: mapping scene time onto t

The classic transition dramaturgy is an S-profile with a hold:

```
0.00s ──▶ 0.30s   t: 0 → 0.45      (cracks propagate)
0.30s ──▶ 0.60s   t: 0.45 (hold)   (the viewer reads the web — the money frame)
0.60s ──▶ 1.10s   t: 0.45 → 1      (shatter; the kinematics inside are already eased)
```

A hard impact works with near-linear `t` and no hold. Scrubbing backwards is legal and free —
"reverse assembly" (rewind) works out of the box.

## Light is the main artistic lever

`optics.lightAngleDeg` (0° = right, clockwise):
- **−90 (top)** — showcase-neutral;
- **−30…−60 (upper-side)** — the cinematic standard, edges read best;
- **~150 (low back light)** — dramatic dark slabs with rare glints.

`bevel.scatter` is the "age of the fracture": 0.4 — a fresh clean break, 0.8 — sparkling
crushed glass. The spectral flare is a delicacy: `spectrum.count 1-2`, `opacity ≤ 0.35`; it is
bound to the light source and glints on its own as a shard turns.

## The seed is a casting call

Generate 5–10 seeds and pick by composition: the impact hole must not sit on a face, a splitter
must not cut through the key word, a dropped piece must not kill legibility. Drive
composition-critical points explicitly: put `impact {x,y}` at the visual center of the event,
`impactHole` sets the wound size. `deviation` + `jaggedness` define the glass character:
0.3 — a laboratory-clean break, 0.9 — an old battered window.

## What not to do

- Don't animate `lightAngleDeg`, `spectrum.count`, `seed`, or quality between frames — only `t`.
- Don't feed heavy DOM into transition modes: content is cloned per shard — pass an `<img>`
  snapshot of the screen instead.
- Don't push `outliers.dropFraction` above ~0.15 on text scenes — pieces fall out together
  with the letters.
- Previews on `quality: 'draft'`, final renders on `'high'`; give the capture engine the flags
  `--num-raster-threads=1 --disable-partial-raster` (see README).
