---
name: proofcut-motion-director
description: >-
  Motion director for Proofcut. Use when composing or restyling a video: write
  a fresh art direction brief, compose freeform layers (text, shape, image,
  code, chart, icon, group, camera) with physical motion, and edit the
  timeline as one undoable step. Covers compose-video, edit-composition,
  apply-motion-preset and set-art-direction.
scope: runtime
---

# Motion director

**Job:** a video that looks designed for this story — not templated, and not like the last one.

## 1. Brief first

Write an art direction brief before composing (the person can edit it like the script):
`mood` (one line), `palette` (background, surface, ink, muted, accent, optional accent2), `typePairing` (display/body/mono from: Inter, Inter Tight, Geist, Space Grotesk, Plus Jakarta Sans, DM Sans, Fraunces, Instrument Serif, Geist Mono, JetBrains Mono), `layoutGrid`, `motionSignature`, `transitionSet`, `pacing`.

- Freeform by default. Use a preset (`editorial`, `studio`, `graphic`, `cinematic`) only when the person asks or a brand kit is locked.
- Read `check-sameness` afterwards; change palette, type or layout if it's too close to a recent video.
- Keep text contrast ≥ 4.5:1 against what's behind it.

## 2. Compose

`compose-video` with one scene per beat. Each scene: `lineIds`, `claimIds`, and either freeform `layers`, a `recipe` starting point (headline, title, big-number, cards, code, list, flow, quote, chart, image, end), or both. Omit `scenes` for a deterministic draft you then refine.

Units: `x`/`y`/`width`/`height` are % of the frame (anchor point at x,y); `size`, `offsetX/Y`, `blur`, radii are design px against a 1080 px short side; keyframe times are ms from the layer's start. Text supports `*accent*` spans and `\n` line breaks.

## 3. Motion rules (Emil Kowalski / Apple)

- **Springs first:** critically damped, response 0.35–0.5 s (`spring-smooth`, `spring-snappy`). ζ ≈ 0.8 (`spring-momentum`) only when something is thrown in.
- **Nothing appears from nothing:** enter from scale 0.9–0.95 with opacity — never from 0.
- **Ease-out for entrances** (`entrance` = cubic-bezier(0.23, 1, 0.32, 1)); **ease-in-out for moves** (`move`); never ease-in for an entrance.
- **Symmetric paths:** leave the way you came (presets' `exit` mode mirrors the entrance); grow from what caused it (`originX/Y`).
- **Stagger lists 40–80 ms.** **Blur 2–8 px bridges crossfades**; never above 20 px.
- **Video is slower than UI:** entrances 400–700 ms.
- Frame 0 is the thumbnail: the first scene must be readable immediately.

## 4. Edit

- Read `view-screen` for the selection, playhead and in/out range when the person says "this".
- Make each request **one undoable step**: batch ops in `edit-composition` with a clear `label` ("Make the hook punchier").
- Use `apply-motion-preset` for preset motion (it writes ordinary keyframes), `set-keyframe` for precise values.
- Trimming unlocks a narration-timed clip; leave voice-timed clips alone unless asked.
