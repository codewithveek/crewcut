import { type CompositionInput, type LayerInput, normalizeComposition, parseComposition } from "@crewcut/composition";

import { clicksIn } from "./launch";
import { CUT, DIM, FRAME, INK, INK_2, PAPER, SURFACE, fadeIn, glow, kf, loadRecording, loadVo, mark, merge, rect, rise, sfx, sfxTracks, text, voiceAndCaptions, words } from "./kit";
import { type CameraBeat, type Recording, type Segment, screen } from "./screen";

/**
 * The demo: one sentence in, an editable video out — the agent run recorded
 * live, step by step, narrated. Studio look: a dark stage, the whole app in a
 * window, the camera following the action, captions for muted viewing.
 */

interface Step {
  id: string;
  number: string;
  title: string;
  recording: Recording;
  segments: Segment[];
  camera?: CameraBeat[];
  url: string;
  cues: Array<{ id: string; offset: number }>;
  cursorFrom?: number;
}

const WINDOW = { x: 50, y: 54.5, w: 72 };

export function demoFilm(sourceDir: string): CompositionInput {
  const take1 = loadRecording("take1", sourceDir);
  const take2 = loadRecording("take2", sourceDir);
  const vo = loadVo(`${sourceDir}/../audio`);
  const clips: Array<Record<string, unknown>> = [];
  const sfxClips: ReturnType<typeof sfx>[] = [];
  const cues: Array<{ id: string; atMs: number }> = [];
  const extraAudio: Array<Record<string, unknown>> = [];

  // ── Cold open: the finished video, made by the agents (0–11.5 s) ─────────
  const open = 11500;
  clips.push({
    id: "open",
    name: "The finished video",
    startMs: 0,
    durationMs: open,
    background: INK,
    layers: [
      glow("open-glow", 50, 60, 100, 110, "#ffb547", "14"),
      {
        id: "open-video",
        type: "video",
        src: "asset:film-yawn",
        fit: "cover",
        radius: 22,
        volume: 0,
        transform: { x: 50, y: 44, width: 76, height: 76 },
        shadow: { color: "#000000b3", blur: 90, x: 0, y: 40 },
        keyframes: { scale: [kf(0, 1, "hold"), kf(open, 0.95, "linear")] },
      } as LayerInput,
    ],
  });
  // The video's own voice-over plays first, then dips under the narrator.
  extraAudio.push({ id: "open-audio", src: "asset:film-yawn-audio", startMs: 0, durationMs: open, volume: 1, fadeOutMs: 600, envelope: [{ atMs: 0, value: 1 }, { atMs: 4000, value: 1 }, { atMs: 4500, value: 0.12 }, { atMs: open, value: 0.1 }], text: "The yawn video's own voice-over" });
  cues.push({ id: "d1", atMs: 4600 });

  // ── Title (11.5–15 s) ───────────────────────────────────────────────────
  clips.push({
    id: "title",
    name: "Title",
    startMs: open,
    durationMs: 3500,
    background: { gradient: { kind: "radial", angle: 0, stops: [{ color: INK_2, at: 0 }, { color: INK, at: 1 }] } },
    transitionIn: { type: "slip-cut", durationMs: 650, direction: "right", easing: "move" },
    layers: [
      glow("title-glow", 50, 60, 90, 110, CUT, "1f"),
      text("title-eyebrow", "CREWCUT  ·  HOW IT WORKS", 50, 33, 26, { align: "center", font: "Geist Mono", weight: 500, tracking: 0.18, color: CUT, startMs: 300, keyframes: fadeIn(0, 400) }),
      text("title-text", "From one sentence\nto an editable video.", 50, 52, 104, { align: "center", startMs: 350, animation: words({ staggerMs: 70 }) }),
    ],
  });
  sfxClips.push(sfx("whoosh-fast", open - 80, 0.4, 520), sfx("pop", open + 450, 0.25, 520));

  const steps: Step[] = [
    {
      id: "s1",
      number: "01",
      title: "Start with one sentence",
      recording: take1,
      segments: [
        { from: 2400, to: 7300, rate: 1.4 },
        { from: 7300, to: 10300, rate: 1 },
      ],
      camera: [
        { at: 2400, focus: [760, 235], zoom: 1.45 },
        { at: 9900, focus: [720, 420], zoom: 1, move: 700 },
      ],
      url: "getcrewcut.app/home",
      cues: [{ id: "d2", offset: 600 }],
    },
    {
      id: "s2",
      number: "02",
      title: "Ranked ideas, each with its evidence",
      recording: take1,
      segments: [
        { from: 10300, to: 31469, rate: 5 },
        { from: 31469, to: 43000, rate: 2.2 },
        { from: 43000, to: 45500, rate: 1 },
      ],
      camera: [
        { at: 11000, focus: [1180, 330], zoom: 1.45 },
        { at: 31469, focus: [1180, 330], zoom: 1.45 },
        { at: 33500, focus: [330, 470], zoom: 1.45, move: 1600 },
        { at: 43800, focus: [300, 600], zoom: 1.5, move: 1200 },
      ],
      url: "getcrewcut.app/videos/why-we-yawn",
      cues: [
        { id: "d3", offset: 400 },
        { id: "d4", offset: 9200 },
      ],
      cursorFrom: 31469,
    },
    {
      id: "s3",
      number: "03",
      title: "Research that quotes its sources",
      recording: take1,
      segments: [{ from: 44700, to: 63900, rate: 2.2 }],
      camera: [
        { at: 44700, focus: [1240, 420], zoom: 1.5 },
        { at: 58000, focus: [1240, 520], zoom: 1.5, move: 3000 },
        { at: 63500, focus: [860, 400], zoom: 1.6, move: 1400 },
      ],
      url: "getcrewcut.app/videos/your-yawn",
      cues: [{ id: "d5", offset: 400 }],
    },
    {
      id: "s4",
      number: "04",
      title: "A script with a source on every line",
      recording: take1,
      segments: [{ from: 63900, to: 70500, rate: 1.1 }],
      camera: [
        { at: 63900, focus: [560, 440], zoom: 1.4 },
        { at: 68500, focus: [560, 560], zoom: 1.4, move: 1800 },
      ],
      url: "getcrewcut.app/videos/your-yawn",
      cues: [{ id: "d6", offset: 400 }],
    },
    {
      id: "s5",
      number: "05",
      title: "The fact-check blocks what isn't supported",
      recording: take1,
      segments: [{ from: 72500, to: 82500, rate: 1.35 }],
      camera: [
        { at: 72500, focus: [400, 820], zoom: 1.35 },
        { at: 77400, focus: [395, 360], zoom: 1.65, move: 900 },
      ],
      url: "getcrewcut.app/videos/your-yawn",
      cues: [{ id: "d7", offset: 400 }],
    },
    {
      id: "s6",
      number: "06",
      title: "The agent fixes it, honestly",
      recording: take1,
      segments: [
        { from: 83000, to: 102000, rate: 2.6 },
        { from: 102000, to: 105400, rate: 1 },
      ],
      camera: [
        { at: 83000, focus: [1240, 430], zoom: 1.45 },
        { at: 96000, focus: [1240, 560], zoom: 1.45, move: 2400 },
        { at: 102900, focus: [330, 320], zoom: 1.7, move: 800 },
      ],
      url: "getcrewcut.app/videos/your-yawn",
      cues: [{ id: "d8", offset: 400 }],
    },
    {
      id: "s7",
      number: "07",
      title: "The motion director designs it",
      recording: take1,
      segments: [
        { from: 105400, to: 109000, rate: 1.6 },
        { from: 109000, to: 133445, rate: 5 },
        { from: 133445, to: 135000, rate: 1 },
      ],
      camera: [
        { at: 105400, focus: [594, 304], zoom: 1.35 },
        { at: 110000, focus: [1240, 450], zoom: 1.45, move: 1200 },
        { at: 132000, focus: [560, 330], zoom: 1.35, move: 1500 },
      ],
      url: "getcrewcut.app/videos/your-yawn",
      cues: [{ id: "d9", offset: 600 }],
    },
    {
      id: "s8",
      number: "08",
      title: "It lands in a real editor",
      recording: take2,
      segments: [
        { from: 0, to: 3400, rate: 1 },
        { from: 4650, to: 9300, rate: 1 },
      ],
      camera: [
        { at: 0, focus: [720, 450], zoom: 1 },
        { at: 2600, focus: [600, 760], zoom: 1.6, move: 2000 },
        { at: 5600, focus: [1000, 760], zoom: 1.6, move: 1600 },
        { at: 8600, focus: [760, 300], zoom: 1.3, move: 1200 },
      ],
      url: "getcrewcut.app/videos/your-yawn/edit",
      cues: [{ id: "d10", offset: 500 }],
    },
    {
      id: "s9",
      number: "09",
      title: "Edit it in plain words",
      recording: take2,
      segments: [
        { from: 15500, to: 22300, rate: 1.5 },
        { from: 22300, to: 33900, rate: 5 },
        { from: 42162, to: 45000, rate: 1 },
      ],
      camera: [
        { at: 15500, focus: [1260, 300], zoom: 1.45 },
        { at: 33600, focus: [1260, 350], zoom: 1.45 },
        { at: 42162, focus: [760, 300], zoom: 1.45, move: 700 },
      ],
      url: "getcrewcut.app/videos/your-yawn/edit",
      cues: [{ id: "d11", offset: 400 }],
    },
    {
      id: "s10",
      number: "10",
      title: "Ask for a voice-over",
      recording: take2,
      segments: [
        { from: 52000, to: 57500, rate: 1.4 },
        { from: 57500, to: 63000, rate: 4 },
        { from: 175000, to: 182100, rate: 4 },
        { from: 182100, to: 188500, rate: 2.5 },
        { from: 188500, to: 196500, rate: 1 },
      ],
      camera: [
        { at: 52000, focus: [1260, 420], zoom: 1.45 },
        { at: 182100, focus: [1260, 420], zoom: 1.45 },
        { at: 189500, focus: [720, 520], zoom: 1.12, move: 1200 },
      ],
      url: "getcrewcut.app/videos/your-yawn/edit",
      cues: [{ id: "d12", offset: 400 }],
    },
  ];

  let at = open + 3500;
  for (const [index, step] of steps.entries()) {
    const shot = screen({ id: `${step.id}-win`, recording: step.recording, segments: step.segments, camera: step.camera, box: WINDOW, frame: FRAME, url: step.url, cursorFrom: step.cursorFrom, entrance: "none" });
    const duration = Math.round(shot.durationMs);
    clips.push({
      id: step.id,
      name: `${step.number} · ${step.title}`,
      startMs: at,
      durationMs: duration,
      background: { gradient: { kind: "radial", angle: 0, stops: [{ color: INK_2, at: 0 }, { color: INK, at: 1 }] } },
      transitionIn: index === 0 ? { type: "zoom-through", durationMs: 500, direction: "left", easing: "move" } : { type: "push", durationMs: 450, direction: "left", easing: "move" },
      layers: [
        glow(`${step.id}-glow`, 50, 105, 120, 60, CUT, "1a"),
        shot.layer,
        // The step header sits above the window, over a soft band so it reads when the camera is in close.
        { id: `${step.id}-band`, type: "shape", shape: "rect", fill: { gradient: { kind: "linear", angle: 180, stops: [{ color: `${INK}f2`, at: 0 }, { color: `${INK}c0`, at: 0.55 }, { color: `${INK}00`, at: 1 }] } }, transform: { x: 50, y: 7.5, width: 100, height: 15 } } as LayerInput,
        text(`${step.id}-num`, step.number, ((1920 - WINDOW.w * 19.2) / 2 / 1920) * 100, 6.2, 30, { font: "Geist Mono", weight: 600, tracking: 0, color: CUT, keyframes: rise(150, 16, 500) }),
        text(`${step.id}-title`, step.title, ((1920 - WINDOW.w * 19.2) / 2 / 1920) * 100 + 3, 6.2, 40, { font: "Geist", weight: 600, tracking: -0.025, startMs: 120, animation: words({ staggerMs: 40, durationMs: 520 }) }),
      ],
    });
    for (const cue of step.cues) cues.push({ id: cue.id, atMs: at + cue.offset });
    sfxClips.push(sfx("whoosh", at - 140, 0.22, 840));
    for (const click of clicksIn(step.recording, step.segments)) sfxClips.push(sfx("click", at + shot.filmTime(click) - 20, 0.4, 520));
    if (step.id === "s10") {
      // The editor's preview plays the voice-over in the recording: let it be heard.
      const playAt = at + shot.filmTime(189826);
      extraAudio.push({ id: "editor-audio", src: "asset:film-yawn-audio", startMs: Math.round(playAt), durationMs: Math.round(at + duration - playAt), trimStartMs: 290, volume: 1, fadeOutMs: 400, text: "The voice-over playing in the editor" });
    }
    at += duration;
  }

  // ── End card: the loop closes on an empty prompt, waiting for yours ─────
  const endAt = at;
  const endMs = 8000;
  const askAt = 3100; // "What's yours?"
  const ctaAt = askAt + (vo.d14?.durationMs ?? 900) + 450; // "Try it free, at get crewcut dot app."
  const getAt = ctaAt + Math.round((vo.m16?.words.find((w) => w.text.toLowerCase() === "get")?.start ?? 0.95) * 1000);
  const liftAt = 2750;
  const lift = (start: number) => ({ offsetY: [kf(liftAt - start, 0, "hold"), kf(liftAt - start + 700, -170, "spring-smooth")] });
  // The home page's prompt box, as the app draws it: placeholder, focus ring, Generate.
  const BOX = { x: 50, y: 52, w: 56, h: 15 };
  const boxIn = (start: number) => rise(2950 - start, 30, 600);
  const caretBlink = Array.from({ length: 9 }, (_, i) => kf(i * 530, i % 2 ? 0 : 1, "hold"));
  const smallLeft = (1920 - (110 + 20 + 78 * 3.55)) / 2;
  clips.push({
    id: "end",
    name: "One sentence in. An editable video out. What's yours?",
    startMs: endAt,
    durationMs: endMs,
    background: INK,
    transitionIn: { type: "slip-cut", durationMs: 650, direction: "right", easing: "move" },
    layers: [
      glow("end-glow", 50, 45, 90, 100, CUT, "1f", { keyframes: fadeIn(200, 900) }),
      text("end-l1", "One sentence in.", 50, 33, 108, { align: "center", startMs: 250, animation: words({ staggerMs: 70 }), keyframes: lift(250) }),
      text("end-l2", "*An editable video out.*", 50, 48, 108, { align: "center", startMs: 1150, animation: words({ staggerMs: 70 }), keyframes: merge(lift(1150), { opacity: [kf(liftAt - 1150, 1, "hold"), kf(liftAt - 1150 + 400, 0, "exit")] }) }),
      rect("end-box", BOX, SURFACE, { radius: 28, stroke: CUT, strokeWidth: 2.5, startMs: 2950, shadow: { color: "#00000099", blur: 70, x: 0, y: 24 }, keyframes: boxIn(2950) }),
      text("end-placeholder", "An idea, a link, or a few notes", BOX.x - BOX.w / 2 + 2.6, BOX.y - 3.2, 34, { anchorX: 0, font: "Geist", weight: 500, tracking: -0.01, color: "#6E6E78", startMs: 2950, keyframes: boxIn(2950) }),
      rect("end-caret", { x: BOX.x - BOX.w / 2 + 2.1, y: BOX.y - 3.2, w: 0.16, h: 4.6 }, CUT, { radius: 2, startMs: 3300, keyframes: { opacity: caretBlink } }),
      rect("end-generate", { x: BOX.x + BOX.w / 2 - 7.6, y: BOX.y + 3.6, w: 11, h: 5.6 }, CUT, { radius: 14, startMs: 2950, keyframes: boxIn(2950) }),
      { id: "end-generate-icon", type: "icon", icon: "sparkle", color: "#ffffff", strokeWidth: 2.2, startMs: 2950, transform: { x: BOX.x + BOX.w / 2 - 11, y: BOX.y + 3.6, width: 1.3, height: 2.3 }, keyframes: boxIn(2950) } as LayerInput,
      text("end-generate-label", "Generate", BOX.x + BOX.w / 2 - 6.9, BOX.y + 3.6, 26, { align: "center", weight: 600, tracking: -0.01, color: "#ffffff", startMs: 2950, keyframes: boxIn(2950) }),
      ...mark("end-mark", ((smallLeft + 55) / 1920) * 100, 74, 110, getAt - 250),
      text("end-word", "crewcut", ((smallLeft + 130) / 1920) * 100, 74.4, 78, { font: "Geist", weight: 600, tracking: -0.045, leading: 1, startMs: getAt + 50, animation: { unit: "char", preset: "mask-rise", delayMs: 0, staggerMs: 32, durationMs: 520, easing: "spring-smooth" } }),
      text("end-url", "getcrewcut.app  ·  free while in beta", 50, 86, 30, { align: "center", font: "Geist Mono", weight: 500, tracking: 0, color: PAPER, startMs: getAt + 300, keyframes: fadeIn(0, 400) }),
    ],
  });
  cues.push({ id: "d13", atMs: endAt + 400 }, { id: "d14", atMs: endAt + askAt }, { id: "m16", atMs: endAt + ctaAt });
  sfxClips.push(
    sfx("whoosh-fast", endAt - 60, 0.4, 520),
    sfx("pop", endAt + 2950, 0.3, 520),
    sfx("impact", endAt + getAt - 250, 0.4, 2040),
  );
  const totalMs = endAt + endMs;

  const { voice, captions: allCaptions } = voiceAndCaptions(vo, cues, { captionsMaxWords: 8 });
  // The end card says its lines on screen; no captions over it.
  const captions = allCaptions.filter((caption) => !/^cap-(d13|d14|m16)-/.test(caption.id));
  const composition = {
    schemaVersion: 1,
    id: "film-demo",
    title: "Crewcut — demo: one sentence to an editable video",
    ratio: "16:9",
    width: FRAME.width,
    height: FRAME.height,
    fps: 30,
    durationMs: totalMs,
    seed: 11,
    brief: {
      mood: "Studio: a dark stage, the real app, a calm guide",
      palette: { background: INK, surface: SURFACE, ink: PAPER, muted: DIM, accent: CUT, accent2: PAPER },
      typePairing: { display: "Geist", body: "Geist", mono: "Geist Mono" },
      layoutGrid: "centered",
      motionSignature: "ease-glide",
      transitionSet: ["push", "slip-cut", "zoom-through"],
      pacing: "measured",
      notes: "Made in Crewcut from a live agent run. Every screen is the real app; waiting is sped up and marked by the step numbers.",
    },
    tracks: [
      { id: "track-main", name: "Main", kind: "visual", clips: clips.map((clip) => ({ ...clip, lineIds: [], timing: "manual" })) },
      { id: "track-voice", name: "Voice", kind: "audio", role: "voice", clips: voice },
      { id: "track-source-audio", name: "Video audio", kind: "audio", role: "sfx", clips: extraAudio },
      { id: "track-music", name: "Music", kind: "audio", role: "music", clips: [{ id: "music", src: "asset:film-music-demo", startMs: 0, durationMs: Math.min(totalMs, 160000), volume: 0.42, fadeInMs: 1500, fadeOutMs: 2500, duckUnderVoice: true, text: "Demo bed (ElevenLabs Music)" }] },
      ...sfxTracks(sfxClips),
      {
        id: "track-captions",
        name: "Captions",
        kind: "caption",
        style: { preset: "boxed", size: 34, weight: 600, font: "body", color: "#F5F3EE", highlightColor: "#FF5B2E", highlightStyle: "color", background: "#0D0D0Fd9", positionY: 91, maxWidth: 66 },
        clips: captions,
      },
    ],
    markers: steps.map((step, index) => ({ id: `mk-${step.id}`, atMs: 0, label: `${index + 1}` })).slice(0, 0),
  } as unknown as CompositionInput;
  return normalizeComposition(parseComposition(composition));
}

void merge;
void PAPER;
