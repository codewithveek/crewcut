import { type CompositionInput, type LayerInput, normalizeComposition, parseComposition } from "@crewcut/composition";

import { CUT, DIM, FRAME, INK, INK_2, PAPER, SURFACE, exitUp, fadeIn, glow, kf, loadRecording, loadVo, mark, merge, pop, rect, rise, sfx, sfxTracks, text, voiceAndCaptions, words } from "./kit";
import { clicksIn, cursorLayer, moment, ripple } from "./launch";
import type { Recording, Segment } from "./screen";

/**
 * "Get your afternoon back." The Autopilot launch film. Cut to its own
 * ElevenLabs track: a ticking build, the drop at 17.1 s (the switch flips on),
 * a second lift at 33.3 s; product moments come from the real Autopilot run
 * (auto1) and the finished project (auto3).
 */

const DROP = 17100;
const LIFT = 33300;

/** Same segments, one speed for all of them, so they fill `targetMs` (capped at 8×, the schema's limit). */
function fit(segments: Array<{ from: number; to: number }>, targetMs: number): Segment[] {
  const span = segments.reduce((sum, segment) => sum + (segment.to - segment.from), 0);
  const rate = Math.min(8, Math.max(0.5, Math.round((span / targetMs) * 100) / 100));
  return segments.map((segment) => ({ ...segment, rate }));
}

/** A clock face: ring, ticks and two hands; the hands turn `minuteTurns` and `hourTurns` full turns over `durationMs`. */
function clock(id: string, cx: number, cy: number, sizePx: number, durationMs: number, minuteTurns: number, hourTurns: number, color = PAPER, startMs = 0, handColor = CUT): LayerInput[] {
  const w = (sizePx / FRAME.width) * 100;
  const h = (sizePx / FRAME.height) * 100;
  const hand = (handId: string, lengthPx: number, thickPx: number, turns: number, fill: string) =>
    rect(handId, { x: cx, y: cy, w: (thickPx / FRAME.width) * 100, h: (lengthPx / FRAME.height) * 100 }, fill, {
      radius: thickPx,
      anchorY: 1,
      originY: 1,
      startMs,
      keyframes: { rotation: [kf(0, 0, "hold"), kf(durationMs, 360 * turns, turns > 2 ? { bezier: [0.55, 0, 0.9, 0.6] } : "linear")] },
    });
  const ticks: LayerInput[] = Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * Math.PI * 2;
    const r = sizePx * 0.4;
    return rect(`${id}-tick-${i}`, { x: cx + ((Math.sin(angle) * r) / FRAME.width) * 100, y: cy - ((Math.cos(angle) * r) / FRAME.height) * 100, w: (6 / FRAME.width) * 100, h: ((i % 3 ? 14 : 26) / FRAME.height) * 100 }, i % 3 ? `${color}66` : color, { radius: 3, startMs, keyframes: { rotation: [kf(0, (i / 12) * 360, "hold")] } });
  });
  return [
    { id: `${id}-ring`, type: "shape", shape: "ring", stroke: color, strokeWidth: 6, startMs, transform: { x: cx, y: cy, width: w, height: h }, keyframes: pop(0, 0.92) } as LayerInput,
    ...ticks,
    hand(`${id}-hour`, sizePx * 0.24, 12, hourTurns, color),
    hand(`${id}-minute`, sizePx * 0.36, 8, minuteTurns, handColor),
    { id: `${id}-hub`, type: "shape", shape: "ellipse", fill: handColor, startMs, transform: { x: cx, y: cy, width: (22 / FRAME.width) * 100, height: (22 / FRAME.height) * 100 } } as LayerInput,
  ];
}

export function autopilotLaunchFilm(sourceDir: string): CompositionInput {
  const run = loadRecording("auto1", sourceDir);
  const tour = loadRecording("auto3", sourceDir);
  const vo = loadVo(`${sourceDir}/../audio`);
  const m = (recording: Recording, name: string, fallback: number) => recording.marks[name] ?? fallback;
  const clips: Array<Record<string, unknown>> = [];
  const sfxClips: ReturnType<typeof sfx>[] = [];
  const cues: Array<{ id: string; atMs: number }> = [];
  const dark = { gradient: { kind: "radial", angle: 0, stops: [{ color: INK_2, at: 0 }, { color: INK, at: 1 }] } };

  // ── A · Time flies. (0–3 s) ────────────────────────────────────────────
  clips.push({
    id: "a-time",
    name: "Time flies",
    startMs: 0,
    durationMs: 3000,
    background: dark,
    layers: [glow("a-glow", 50, 40, 70, 90, CUT, "14"), ...clock("a-clock", 50, 38, 330, 3000, 0.25, 0.02), text("a-t", "Time flies.", 50, 79, 120, { align: "center", startMs: 350, animation: words({ staggerMs: 90 }) })],
  });
  sfxClips.push(sfx("clock-run", 0, 0.55, 3000));
  cues.push({ id: "a1", atMs: 400 });

  // ── B · Especially when you're making a video. (3–6.5 s) ───────────────
  clips.push({
    id: "b-video",
    name: "Especially making a video",
    startMs: 3000,
    durationMs: 3500,
    background: dark,
    transitionIn: { type: "push", durationMs: 420, direction: "up", easing: "move" },
    layers: [
      glow("b-glow", 50, 55, 80, 90, "#8b5cf6", "14"),
      text("b-t", "Especially when you're\n*making a video.*", 50, 50, 104, { align: "center", accent: CUT, startMs: 150, animation: words({ staggerMs: 60 }) }),
    ],
  });
  cues.push({ id: "a2", atMs: 3150 });

  // ── C · Research. Script. Fact-check. Animation. Voice. (6.5–12 s) ──────
  const montageAt = 6500;
  const a3 = vo.a3?.words ?? [];
  const jobs = ["Research.", "Script.", "Fact-check.", "Animation.", "Voice."];
  const wordStart = (i: number) => 200 + Math.round((a3[i]?.start ?? i * 0.6) * 1000);
  clips.push({
    id: "c-jobs",
    name: "Research, script, fact-check, animation, voice",
    startMs: montageAt,
    durationMs: 5500,
    background: dark,
    transitionIn: { type: "push", durationMs: 380, direction: "left", easing: "move" },
    layers: [
      ...clock("c-clock", 50, 50, 760, 5500, 3, 0.25, "#2c2c33", 0, "#4a2a22"),
      ...jobs.map((job, i) => {
        const start = wordStart(i);
        const end = i < jobs.length - 1 ? wordStart(i + 1) : 5500;
        return text(`c-${i}`, job, 50, 50, 170, { align: "center", font: "Geist", weight: 600, tracking: -0.04, color: i === jobs.length - 1 ? CUT : PAPER, startMs: start, durationMs: end - start, keyframes: pop(0, 0.86) });
      }),
      ...jobs.map((_, i) => text(`c-n${i}`, `0${i + 1} / 05`, 50, 72, 26, { align: "center", font: "Geist Mono", weight: 500, tracking: 0.1, color: DIM, startMs: wordStart(i), durationMs: (i < jobs.length - 1 ? wordStart(i + 1) : 5500) - wordStart(i) })),
    ],
  });
  cues.push({ id: "a3", atMs: montageAt + 200 });
  for (let i = 0; i < jobs.length; i += 1) sfxClips.push(sfx("clock-tick", montageAt + wordStart(i) - 10, 0.55, 500));

  // ── D · Hours, gone. (12–14.5 s) ────────────────────────────────────────
  clips.push({
    id: "d-gone",
    name: "Hours, gone",
    startMs: 12000,
    durationMs: 2500,
    background: dark,
    transitionIn: { type: "zoom-through", durationMs: 400, direction: "left", easing: "move" },
    layers: [...clock("d-clock", 50, 40, 330, 2500, 9, 1.2), text("d-t", "Hours, *gone.*", 50, 79, 120, { align: "center", accent: DIM, startMs: 150, animation: words({ staggerMs: 90 }) })],
  });
  sfxClips.push(sfx("clock-spin", 12000, 0.5, 1500));
  cues.push({ id: "a3b", atMs: 12150 });

  // ── E · What if a whole crew did it for you? (14.5–17.1 s) ─────────────
  clips.push({
    id: "e-crew",
    name: "What if a crew did it",
    startMs: 14500,
    durationMs: DROP - 14500,
    background: dark,
    transitionIn: { type: "push", durationMs: 420, direction: "up", easing: "move" },
    layers: [
      glow("e-glow", 50, 55, 90, 100, CUT, "1a", { keyframes: fadeIn(0, 2000) }),
      text("e-t", "What if a whole crew\ndid it *for you?*", 50, 50, 110, { align: "center", accent: CUT, startMs: 150, animation: words({ staggerMs: 70 }) }),
    ],
  });
  cues.push({ id: "a4", atMs: 14650 });
  sfxClips.push(sfx("riser", 14600, 0.35, 2500));

  // ── F · Introducing Autopilot (17.1–21.5 s): the switch flips on the drop ─
  const flipAt = 450;
  const trackW = (230 / FRAME.width) * 100;
  const trackH = (124 / FRAME.height) * 100;
  const knob = (100 / FRAME.width) * 100;
  const smallLeft = (1920 - (60 + 12 + 40 * 3.55)) / 2;
  clips.push({
    id: "f-autopilot",
    name: "Introducing Autopilot",
    startMs: DROP,
    durationMs: 21500 - DROP,
    background: INK,
    transitionIn: { type: "slip-cut", durationMs: 600, direction: "right", easing: "move" },
    layers: [
      glow("f-glow", 50, 45, 90, 100, CUT, "26", { keyframes: fadeIn(flipAt, 700) }),
      text("f-eyebrow", "INTRODUCING", 50, 22, 30, { align: "center", font: "Geist Mono", weight: 500, tracking: 0.22, color: CUT, startMs: 100, keyframes: fadeIn(0, 300) }),
      rect("f-track", { x: 50, y: 40, w: trackW, h: trackH }, SURFACE, { radius: 999, stroke: "#ffffff26", strokeWidth: 2, keyframes: pop(0, 0.9) }),
      rect("f-track-on", { x: 50, y: 40, w: trackW, h: trackH }, CUT, { radius: 999, startMs: flipAt, keyframes: fadeIn(0, 160), shadow: { color: "#ff5b2e80", blur: 60, x: 0, y: 12 } }),
      { id: "f-knob", type: "shape", shape: "ellipse", fill: PAPER, transform: { x: 50 - trackW / 2 + knob / 2 + 0.6, y: 40, width: knob, height: (100 / FRAME.height) * 100 }, shadow: { color: "#00000066", blur: 16, x: 0, y: 4 }, keyframes: { x: [kf(flipAt, 50 - trackW / 2 + knob / 2 + 0.6, "hold"), kf(flipAt + 260, 50 + trackW / 2 - knob / 2 - 0.6, "spring-snappy")] } } as LayerInput,
      text("f-word", "Autopilot", 50, 64, 200, { align: "center", font: "Geist", weight: 600, tracking: -0.05, leading: 1, startMs: flipAt + 150, animation: { unit: "char", preset: "mask-rise", delayMs: 0, staggerMs: 34, durationMs: 560, easing: "spring-smooth" } }),
      text("f-in", "in", ((smallLeft - 6) / 1920) * 100, 84, 40, { align: "right", color: DIM, startMs: 1900, keyframes: fadeIn(0, 300) }),
      ...mark("f-mark", ((smallLeft + 30) / 1920) * 100, 84, 60, 1900),
      text("f-crewcut", "crewcut", ((smallLeft + 72) / 1920) * 100, 84.3, 40, { font: "Geist", weight: 600, tracking: -0.045, leading: 1, startMs: 2100, keyframes: fadeIn(0, 300) }),
    ],
  });
  sfxClips.push(sfx("impact", DROP - 20, 0.6, 2040), sfx("toggle", DROP + flipAt - 30, 0.7, 600));
  cues.push({ id: "a5", atMs: DROP + 900 });

  // ── G–L · The product, real ─────────────────────────────────────────────
  const typing = m(run, "typing", 1700);
  const launched = m(run, "launched", 11260);
  const resumed = m(run, "done", 1042600);
  const t = (name: string, fallback: number) => m(tour, name, fallback);
  const beats: Array<{ id: string; at: number; end: number; recording: Recording; segments: Segment[]; camera: Array<{ at: number; focus: [number, number]; zoom: number; move?: number }>; pill: string; url: string; cue: string; cursorFrom?: number }> = [
    {
      id: "g-sentence",
      at: 21500,
      end: 27400,
      recording: run,
      segments: fit([{ from: typing - 700, to: launched + 1200 }], 27400 - 21500),
      camera: [
        { at: typing - 700, focus: [930, 230], zoom: 1.8 },
        { at: launched - 2600, focus: [1010, 290], zoom: 1.9, move: 700 },
      ],
      pill: "One sentence. *Autopilot on.*",
      url: "getcrewcut.app/home",
      cue: "a6",
    },
    {
      id: "h-sources",
      at: 27400,
      end: LIFT,
      recording: tour,
      segments: fit([
        { from: t("research", 20306) - 3200, to: t("research", 20306) + 2200 },
        { from: t("factcheck", 62329) - 3400, to: t("factcheck", 62329) + 1600 },
      ], LIFT - 27400),
      camera: [
        { at: t("research", 20306) - 3200, focus: [560, 600], zoom: 1.45 },
        { at: t("factcheck", 62329) - 2800, focus: [430, 530], zoom: 1.85, move: 600 },
      ],
      pill: "Sources quoted. *Fact-check: 100.*",
      url: "getcrewcut.app/videos/time",
      cue: "a7",
    },
    {
      id: "i-made",
      at: LIFT,
      end: 38500,
      recording: tour,
      segments: fit([
        { from: t("motion", 68029) - 3200, to: t("motion", 68029) + 1500 },
        { from: t("voice", 73293) - 3000, to: t("voice", 73293) + 800 },
        { from: t("publish", 78366) - 3000, to: t("publish", 78366) + 1500 },
      ], 38500 - LIFT),
      camera: [
        { at: t("motion", 68029) - 3200, focus: [520, 600], zoom: 1.5 },
        { at: t("voice", 73293) - 3000, focus: [560, 560], zoom: 1.5 },
        { at: t("publish", 78366) - 3000, focus: [480, 560], zoom: 1.6 },
      ],
      pill: "Designed, voiced, *exported.*",
      url: "getcrewcut.app/videos/time",
      cue: "a8",
    },
    {
      id: "j-recover",
      at: 38500,
      end: 42500,
      recording: run,
      segments: fit([{ from: resumed - 3200, to: resumed + 4800 }], 4000),
      camera: [{ at: resumed - 3200, focus: [500, 200], zoom: 2 }],
      pill: "Stalled? *It picks itself back up.*",
      url: "getcrewcut.app/videos/time",
      cue: "a9",
    },
    {
      id: "k-editor",
      at: 42500,
      end: 48500,
      recording: tour,
      segments: fit([{ from: t("editor", 86358) - 200, to: t("play-1", 91437) + 5000 }], 6000),
      camera: [
        { at: t("editor", 86358), focus: [720, 450], zoom: 1 },
        { at: t("play-1", 91437) - 1800, focus: [640, 760], zoom: 1.55, move: 1500 },
        { at: t("play-1", 91437) + 2600, focus: [700, 330], zoom: 1.3, move: 1000 },
      ],
      pill: "Every layer, *yours to edit.*",
      url: "getcrewcut.app/videos/time/edit",
      cue: "a10",
    },
    {
      id: "l-publish",
      at: 48500,
      end: 52500,
      recording: tour,
      segments: fit([{ from: t("end", 532144) - 3400, to: t("end", 532144) + 200 }], 4000),
      camera: [{ at: t("end", 532144) - 3400, focus: [1240, 120], zoom: 1.9 }],
      pill: "Publishing? *Always yours.*",
      url: "getcrewcut.app/videos/time/edit",
      cue: "a11",
    },
  ];
  for (const beat of beats) {
    const shot = moment({ id: beat.id, recording: beat.recording, segments: beat.segments, camera: beat.camera, pill: beat.pill, url: beat.url, cursorFrom: beat.cursorFrom });
    clips.push({
      id: beat.id,
      name: beat.pill.replace(/\*/g, ""),
      startMs: beat.at,
      durationMs: beat.end - beat.at,
      background: INK,
      transitionIn: beat.at === LIFT ? { type: "zoom-through", durationMs: 450, direction: "left", easing: "move" } : { type: "push", durationMs: 450, direction: "left", easing: "move" },
      layers: shot.layers,
    });
    sfxClips.push(sfx(beat.at === LIFT ? "whoosh-fast" : "whoosh", beat.at - 150, 0.28, 840));
    for (const click of clicksIn(beat.recording, beat.segments)) {
      const filmAt = beat.at + shot.shot.filmTime(click);
      if (filmAt < beat.end - 100) sfxClips.push(sfx("click", filmAt - 20, 0.45, 520));
    }
    cues.push({ id: beat.cue, atMs: beat.at + 250 });
  }

  // ── M · Crewcut Autopilot. Get your afternoon back. (52.5–56.5 s) ───────
  clips.push({
    id: "m-tagline",
    name: "Get your afternoon back",
    startMs: 52500,
    durationMs: 4000,
    background: INK,
    transitionIn: { type: "slip-cut", durationMs: 600, direction: "right", easing: "move" },
    layers: [
      glow("m-glow", 50, 45, 90, 100, CUT, "1f", { keyframes: fadeIn(200, 900) }),
      ...clock("m-clock", 50, 28, 200, 4000, 0.05, 0.004),
      text("m-1", "Crewcut Autopilot.", 50, 54, 104, { align: "center", startMs: 200, animation: words({ staggerMs: 70 }) }),
      text("m-2", "*Get your afternoon back.*", 50, 70, 104, { align: "center", startMs: 200 + Math.round((vo.a12?.words.find((w) => w.text === "Get")?.start ?? 1) * 1000), animation: words({ staggerMs: 70 }) }),
    ],
  });
  sfxClips.push(sfx("whoosh-fast", 52450, 0.45, 520), sfx("impact", 52700, 0.5, 2040));
  cues.push({ id: "a12", atMs: 52700 });

  // ── N · Try Crewcut (56.5–62.5 s): the cursor clicks, the lockup opens ───
  const ctaAt = 56500;
  const ctaMs = 6000;
  const voAt = 600;
  const ctaWords = vo.a13?.words ?? [];
  const wordAt = (needle: string, fallback: number) => voAt + Math.round((ctaWords.find((w) => w.text.toLowerCase().startsWith(needle))?.start ?? fallback) * 1000);
  const clickAt = wordAt("crewcut", 0.35);
  const openAt = clickAt + 300;
  const urlAt = wordAt("get", 0.95);
  const BTN = { x: 50, y: 50, w: 21, h: 10.5 };
  const button = merge(
    { scale: [kf(0, 0.9, "hold"), kf(500, 1, "spring-snappy")], opacity: [kf(0, 0, "hold"), kf(220, 1, "entrance")] },
    { scale: [kf(clickAt - 10, 1, "hold"), kf(clickAt + 80, 0.94, "standard"), kf(openAt, 1, "spring-snappy"), kf(openAt + 260, 0.72, "exit")] },
    { opacity: [kf(openAt, 1, "hold"), kf(openAt + 220, 0, "exit")] },
  );
  const lockLeft = (1920 - (120 + 22 + 84 * 3.55)) / 2;
  clips.push({
    id: "n-cta",
    name: "Try Crewcut",
    startMs: ctaAt,
    durationMs: ctaMs,
    background: INK,
    transitionIn: { type: "push", durationMs: 420, direction: "up", easing: "move" },
    layers: [
      glow("n-glow", 50, 50, 90, 100, CUT, "1f"),
      rect("n-btn", BTN, CUT, { radius: 999, durationMs: openAt + 400, shadow: { color: "#ff5b2e73", blur: 60, x: 0, y: 16 }, keyframes: button }),
      text("n-btn-label", "Try Crewcut  →", BTN.x, BTN.y, 44, { align: "center", weight: 600, tracking: -0.015, color: "#ffffff", durationMs: openAt + 400, keyframes: button }),
      cursorLayer("n-cursor", [
        [100, 84, 99],
        [clickAt - 60, 55, 52.5],
      ], [clickAt], openAt + 100),
      ripple("n-ripple", 55, 52.5, clickAt, 5),
      ...mark("n-mark", ((lockLeft + 60) / 1920) * 100, 42, 120, openAt),
      text("n-word", "crewcut", ((lockLeft + 142) / 1920) * 100, 42.4, 84, { font: "Geist", weight: 600, tracking: -0.045, leading: 1, startMs: openAt + 300, animation: { unit: "char", preset: "mask-rise", delayMs: 0, staggerMs: 32, durationMs: 520, easing: "spring-smooth" } }),
      text("n-url", "getcrewcut.app", 50, 60, 52, { align: "center", font: "Geist Mono", weight: 500, tracking: -0.01, color: PAPER, startMs: urlAt, keyframes: rise(0, 24, 600) }),
      text("n-plans", "Autopilot on Creator and Studio plans", 50, 69, 28, { align: "center", font: "Geist Mono", weight: 500, tracking: 0, color: DIM, startMs: urlAt + 400, keyframes: fadeIn(0, 400) }),
    ],
  });
  sfxClips.push(sfx("whoosh", ctaAt - 120, 0.3, 840), sfx("click", ctaAt + clickAt - 20, 0.55, 520), sfx("success", ctaAt + openAt, 0.35, 1500), sfx("tick", ctaAt + urlAt, 0.25, 520));
  cues.push({ id: "a13", atMs: ctaAt + voAt });
  const totalMs = ctaAt + ctaMs;

  const { voice, captions } = voiceAndCaptions(vo, cues);
  const composition = {
    schemaVersion: 1,
    id: "film-autopilot-launch",
    title: "Crewcut Autopilot — launch film",
    ratio: "16:9",
    width: FRAME.width,
    height: FRAME.height,
    fps: 30,
    durationMs: totalMs,
    seed: 17,
    brief: {
      mood: "Crewcut's own: ink, paper and the cut orange; time running out, then handed back",
      palette: { background: INK, surface: SURFACE, ink: PAPER, muted: DIM, accent: CUT, accent2: "#F5F3EE" },
      typePairing: { display: "Geist", body: "Geist", mono: "Geist Mono" },
      layoutGrid: "centered",
      motionSignature: "kinetic",
      transitionSet: ["slip-cut", "push", "zoom-through"],
      pacing: "brisk",
      notes: "Made in Crewcut. A ticking build to the drop at 17.1 s (the switch flips on), a lift at 33.3 s. Product moments are the real Autopilot run.",
    },
    tracks: [
      { id: "track-main", name: "Main", kind: "visual", clips: clips.map((clip) => ({ ...clip, lineIds: [], timing: "manual" })) },
      { id: "track-voice", name: "Voice", kind: "audio", role: "voice", clips: voice },
      { id: "track-music", name: "Music", kind: "audio", role: "music", volume: 1, clips: [{ id: "music", src: "asset:film-music-auto", startMs: 0, durationMs: Math.min(totalMs, 63900), volume: 0.8, fadeInMs: 0, fadeOutMs: 1500, duckUnderVoice: true, text: "Autopilot launch track (ElevenLabs Music)" }] },
      ...sfxTracks(sfxClips),
      { id: "track-captions", name: "Captions", kind: "caption", hidden: true, style: { preset: "clean", size: 40, weight: 600, font: "body", position: "bottom" }, clips: captions },
    ],
    markers: [
      { id: "mk-drop", atMs: DROP, label: "Drop" },
      { id: "mk-lift", atMs: LIFT, label: "Lift" },
    ],
  } as unknown as CompositionInput;
  return normalizeComposition(parseComposition(composition));
}

void exitUp;
