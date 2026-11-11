import { type CompositionInput, type LayerInput, parseComposition, normalizeComposition } from "@crewcut/composition";

import {
  CUT,
  DIM,
  FRAME,
  HAIRLINE,
  INK,
  INK_2,
  KIND,
  PAPER,
  SURFACE,
  exitUp,
  fadeIn,
  fadeOut,
  glow,
  kf,
  loadRecording,
  loadVo,
  mark,
  merge,
  OUT,
  pill,
  pop,
  rect,
  rise,
  sfx,
  sfxTracks,
  text,
  voiceAndCaptions,
  words,
} from "./kit";
import { type CameraBeat, type Recording, type Segment, screen } from "./screen";

/**
 * "Vibe-code the app. Crewcut the video." — the launch film, made as an
 * ordinary Crewcut composition: kinetic type, shapes and code layers for the
 * set-up, real screen recordings of the app for the product, and the music,
 * voice and sound effects on their own tracks. Cut to the music: the drop
 * lands at 16.3 s, cuts fall on the beat (≈120 BPM), the close rides the last phrase.
 */

const CODE_BEFORE = `export function Habits() {
  const [habits, setHabits] = useState<Habit[]>([]);
  const streak = longestStreak(habits);

  return (
    <Screen title="Today">
      <HabitList items={habits} onToggle={toggle} />
      <Button accent="#3b82f6" onPress={addHabit}>
        Add habit
      </Button>
      <Streak days={streak} />
    </Screen>
  );
}`;
const CODE_AFTER = CODE_BEFORE.replace("#3b82f6", "#ff5b2e");

interface Clip {
  id: string;
  name: string;
  startMs: number;
  durationMs: number;
  background?: unknown;
  transitionIn?: { type: string; durationMs: number; direction?: string; easing?: unknown };
  layers: LayerInput[];
}

export function promptBar(id: string, value: string, y: number, typeAt: number, staggerMs = 40): LayerInput[] {
  return [
    rect(`${id}-bar`, { x: 69, y, w: 46, h: 8.4 }, SURFACE, { radius: 999, stroke: HAIRLINE, strokeWidth: 1.5, shadow: { color: "#00000080", blur: 50, x: 0, y: 18 }, keyframes: merge(rise(0, 30, 600)) }),
    { id: `${id}-spark`, type: "icon", icon: "sparkle", color: CUT, strokeWidth: 2, transform: { x: 49.4, y, width: 1.6, height: 2.8 }, keyframes: fadeIn(120, 300) } as LayerInput,
    text(`${id}-text`, value, 51.6, y, 30, { font: "Geist", weight: 500, tracking: -0.01, color: PAPER, maxWidth: 40, animation: { unit: "char", preset: "typewriter", delayMs: typeAt, staggerMs, durationMs: 120, easing: "linear" } }),
  ];
}

/** A pointer that glides along `path` ([clip ms, x %, y %]) and presses at `clicks` (clip ms); optionally fades at `hideAt`. */
export function cursorLayer(id: string, path: Array<[number, number, number]>, clicks: number[] = [], hideAt?: number): LayerInput {
  // Keyframe times are relative to the layer, which starts at the first point.
  const first = path[0]!;
  const t0 = first[0];
  const xs = path.map(([at, x], index) => kf(at - t0, x, index === 0 ? "hold" : { bezier: [0.65, 0, 0.35, 1] }));
  const ys = path.map(([at, , y], index) => kf(at - t0, y, index === 0 ? "hold" : { bezier: [0.65, 0, 0.35, 1] }));
  const scale = clicks.flatMap((at) => [kf(at - t0 - 10, 1, "hold"), kf(at - t0 + 70, 0.84, "standard"), kf(at - t0 + 240, 1, "spring-snappy")]);
  const opacity = [kf(0, 0, "hold"), kf(160, 1, "entrance"), ...(hideAt !== undefined ? [kf(hideAt - t0, 1, "hold"), kf(hideAt - t0 + 300, 0, "exit")] : [])];
  return {
    id,
    type: "image",
    src: `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 36"><defs><filter id="s" x="-40%" y="-30%" width="180%" height="170%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.6" flood-color="#000" flood-opacity=".45"/></filter></defs><path filter="url(#s)" d="M3 2.5 L3 27.5 L9.4 21.6 L13.6 31.2 L18.2 29.2 L14.1 19.8 L22.6 19.8 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>`)}`,
    fit: "contain",
    alt: "",
    startMs: first[0],
    transform: { x: first[1], y: first[2], width: 1.5, height: 3.4, anchorX: 0.1, anchorY: 0.07, originX: 0.1, originY: 0.07 },
    keyframes: { x: xs, y: ys, ...(scale.length ? { scale } : {}), opacity },
  } as LayerInput;
}

export function ripple(id: string, x: number, y: number, at: number, size = 3): LayerInput {
  return {
    id,
    type: "shape",
    shape: "ellipse",
    fill: `${CUT}33`,
    stroke: `${CUT}cc`,
    strokeWidth: 3,
    startMs: at,
    durationMs: 520,
    transform: { x, y, width: size, height: (size * FRAME.width) / FRAME.height },
    keyframes: { scale: [kf(0, 0.35, "hold"), kf(480, 1.35, OUT)], opacity: [kf(0, 0.95, "hold"), kf(480, 0, "exit")] },
  } as LayerInput;
}

/** A product moment: the recording in its window, the camera, and a caption pill. */
export function moment(input: {
  id: string;
  recording: Recording;
  segments: Segment[];
  camera?: CameraBeat[];
  pill: string;
  pillAt?: number;
  url?: string;
  extraClicks?: Array<{ t: number; x: number; y: number }>;
  cursorFrom?: number;
}) {
  const shot = screen({ id: `${input.id}-win`, recording: input.recording, segments: input.segments, camera: input.camera, box: { x: 50, y: 46.5, w: 74 }, frame: FRAME, url: input.url, extraClicks: input.extraClicks, cursorFrom: input.cursorFrom, entrance: "none" });
  return {
    shot,
    recording: input.recording,
    segments: input.segments,
    layers: [glow(`${input.id}-glow`, 50, 100, 120, 70, CUT, "1f"), shot.layer, pill(`${input.id}-pill`, input.pill, 9.5, 90.5, 40, { startMs: input.pillAt ?? 250 })],
  };
}

/** Recording times of the clicks a set of segments shows. */
export function clicksIn(recording: Recording, segments: Segment[]): number[] {
  return recording.events.filter((event) => event.type === "down" && segments.some((segment) => event.t >= segment.from && event.t < segment.to)).map((event) => event.t);
}

export function launchFilm(sourceDir: string): CompositionInput {
  const take1 = loadRecording("take1", sourceDir);
  const take2 = loadRecording("take2", sourceDir);
  const vo = loadVo(`${sourceDir}/../audio`);
  const clips: Clip[] = [];
  const sfxClips: ReturnType<typeof sfx>[] = [];

  // ── A · You can vibe-code an app (0–5.6 s) ────────────────────────────────
  clips.push({
    id: "a-vibe",
    name: "You can vibe-code an app",
    startMs: 0,
    durationMs: 5600,
    background: { gradient: { kind: "radial", angle: 0, stops: [{ color: INK_2, at: 0 }, { color: INK, at: 1 }] } },
    layers: [
      glow("a-glow", 70, 60, 70, 100, "#3b82f6", "1a"),
      text("a-h1", "You can\nvibe-code\nan app.", 6.5, 50, 92, { startMs: -500, animation: words({ staggerMs: 70 }), keyframes: exitUp(3050) }),
      text("a-h2", "And you\nstill own\nevery line.", 6.5, 50, 92, { startMs: 3150, animation: words({ staggerMs: 70 }) }),
      ...promptBar("a-prompt", "build me a habit tracker", 20, 250),
      {
        id: "a-code",
        type: "code",
        code: CODE_BEFORE,
        language: "tsx",
        title: "habits.tsx",
        theme: "dark",
        fontSize: 21,
        reveal: "type",
        showLineNumbers: true,
        transform: { x: 69, y: 61, width: 46, height: 60 },
        shadow: { color: "#00000099", blur: 70, x: 0, y: 30 },
        durationMs: 3900,
        keyframes: merge(rise(900, 40, 600), { progress: [kf(1150, 0, "hold"), kf(2700, 1, "linear")] }),
      } as LayerInput,
      {
        id: "a-code-after",
        type: "code",
        code: CODE_AFTER,
        language: "tsx",
        title: "habits.tsx",
        theme: "dark",
        fontSize: 21,
        reveal: "none",
        highlightLines: [8],
        showLineNumbers: true,
        startMs: 3900,
        transform: { x: 69, y: 61, width: 46, height: 60 },
        shadow: { color: "#00000099", blur: 70, x: 0, y: 30 },
        keyframes: fadeIn(0, 160),
      } as LayerInput,
      // The app's button, before and after the one-line change.
      rect("a-btn-blue", { x: 85.5, y: 86, w: 11, h: 6.4 }, "#3b82f6", { radius: 999, startMs: 1900, durationMs: 2300, keyframes: merge(pop(0, 0.92)), shadow: { color: "#3b82f666", blur: 40, x: 0, y: 12 } }),
      rect("a-btn-cut", { x: 85.5, y: 86, w: 11, h: 6.4 }, CUT, { radius: 999, startMs: 4000, keyframes: merge(pop(0, 0.92)), shadow: { color: "#ff5b2e66", blur: 40, x: 0, y: 12 } }),
      text("a-btn-label", "Add habit", 85.5, 86, 26, { align: "center", weight: 600, tracking: -0.01, color: "#ffffff", startMs: 1900, keyframes: fadeIn(100, 200) }),
      cursorLayer("a-cursor", [
        [3150, 96, 98],
        [3750, 64.6, 60.6],
      ], [3800]),
      // Clicks the button's colour in the code: the one line that changes.
      ripple("a-ripple", 64.6, 60.6, 3800),
    ],
  });
  sfxClips.push(sfx("typing", 200, 0.22, 1200), sfx("click", 3780, 0.5, 520), sfx("pop", 4000, 0.35, 520));

  // ── B · Ask AI for a video → a flat file → start over (5.6–12.6 s) ───────
  clips.push({
    id: "b-flat",
    name: "A flat file",
    startMs: 5600,
    durationMs: 7000,
    background: INK,
    transitionIn: { type: "push", durationMs: 520, direction: "left", easing: "move" },
    layers: [
      glow("b-glow", 70, 60, 70, 100, "#8b5cf6", "14"),
      text("b-h1", "Ask AI for\na video,", 6.5, 37, 88, { animation: words({ staggerMs: 60 }), keyframes: exitUp(3900) }),
      text("b-h2", "and you get\n*a flat file.*", 6.5, 62, 88, { startMs: 1900, accent: DIM, animation: words({ staggerMs: 60 }), keyframes: exitUp(3900 - 1900) }),
      text("b-h3", "One wrong\nword?", 6.5, 40, 88, { startMs: 4150, animation: words({ staggerMs: 60 }) }),
      text("b-h4", "*Start over.*", 6.5, 61, 88, { startMs: 4750, accent: DIM, animation: words({ staggerMs: 60 }) }),
      ...promptBar("b-prompt", "make a 30-second video about why we yawn", 20, 150, 26),
      rect("b-progress-track", { x: 69, y: 28, w: 46, h: 0.45 }, "#ffffff14", { radius: 999, startMs: 1250, durationMs: 800, keyframes: fadeIn(0, 150) }),
      rect("b-progress", { x: 46, y: 28, w: 46, h: 0.45 }, PAPER, { radius: 999, anchorX: 0, originX: 0, startMs: 1250, durationMs: 800, keyframes: { scaleX: [kf(0, 0.02, "hold"), kf(650, 1, "standard")] } }),
      {
        id: "b-player",
        type: "group",
        name: "Rendered video",
        startMs: 1950,
        transform: { x: 69, y: 61 },
        keyframes: merge(pop(0, 0.94), {
          // Clicking the burned-in caption does nothing: the file shakes it off.
          offsetX: [kf(2750, 0, "hold"), kf(2810, -14, "standard"), kf(2880, 12, "standard"), kf(2950, -8, "standard"), kf(3020, 5, "standard"), kf(3100, 0, "standard")],
          blur: [kf(3500, 0, "hold"), kf(4100, 12, "standard")],
        }),
        children: [
          { id: "b-photo", type: "image", src: "asset:film-flat-photo", fit: "cover", radius: 22, alt: "A man yawning", filter: { preset: "fade", intensity: 0.35 }, transform: { x: 69, y: 61, width: 46, height: 46 }, shadow: { color: "#000000a6", blur: 70, x: 0, y: 30 } } as LayerInput,
          rect("b-scrim", { x: 69, y: 74, w: 46, h: 20 }, { gradient: { kind: "linear", angle: 180, stops: [{ color: "#00000000", at: 0 }, { color: "#000000b3", at: 1 }] } }),
          text("b-burned", "Yawns spread because\nyou're tired.", 69, 75.5, 30, { align: "center", weight: 700, tracking: -0.01, color: "#ffffff" }),
          rect("b-scrub", { x: 69, y: 82.6, w: 42, h: 0.4 }, "#ffffff40", { radius: 999 }),
          rect("b-scrub-fill", { x: 48, y: 82.6, w: 15, h: 0.4 }, "#ffffff", { radius: 999, anchorX: 0 }),
        ],
      } as LayerInput,
      text("b-file", "yawn_final.mp4  ·  1080p  ·  read-only", 46, 88.5, 24, { font: "Geist Mono", weight: 500, tracking: 0, color: DIM, startMs: 2200, keyframes: fadeIn(0, 300) }),
      cursorLayer("b-cursor", [
        [2400, 98, 96],
        [2700, 72, 75.5],
      ], [2740]),
      ripple("b-ripple", 72, 75.5, 2740),
      { id: "b-lock", type: "icon", icon: "lock", color: PAPER, strokeWidth: 2.2, startMs: 2800, transform: { x: 88, y: 43, width: 2.4, height: 4.3 }, keyframes: pop(0, 0.9) } as LayerInput,
      text("b-regen", "Regenerating…", 69, 61, 30, { align: "center", font: "Geist", weight: 600, tracking: -0.01, background: "#0D0D0Fd9", padding: 22, radius: 999, startMs: 3600, keyframes: pop(0, 0.92) }),
      {
        id: "b-spinner",
        type: "shape",
        shape: "ring",
        stroke: CUT,
        strokeWidth: 3,
        startMs: 3600,
        transform: { x: 69, y: 52.5, width: 1.9, height: 3.4 },
        keyframes: merge(fadeIn(0, 200), { rotation: [kf(0, 0, "hold"), kf(3400, 1080, "linear")] }),
      } as LayerInput,
    ],
  });
  sfxClips.push(sfx("whoosh", 5450, 0.35, 840), sfx("typing", 5800, 0.2, 1300), sfx("pop", 7550, 0.3, 520), sfx("click", 8330, 0.5, 520), sfx("error", 8400, 0.55, 520));

  // ── C · What if your video came with its source? (12.6–15.95 s) ────────────
  clips.push({
    id: "c-source",
    name: "What if it came with its source",
    startMs: 12600,
    durationMs: 3350,
    background: INK,
    transitionIn: { type: "blur-crossfade", durationMs: 450, direction: "left", easing: "move" },
    layers: [
      text("c-q", "What if your video\ncame with its *source*?", 50, 50, 112, {
        align: "center",
        startMs: 300,
        animation: words({ staggerMs: 75, durationMs: 700 }),
        keyframes: { scale: [kf(0, 1, "hold"), kf(3000, 1.05, "linear")], opacity: [kf(2650, 1, "hold"), kf(3050, 0, "exit")], blur: [kf(2650, 0, "hold"), kf(3050, 10, "exit")] },
      }),
    ],
  });
  sfxClips.push(sfx("riser", 14250, 0.55, 2040));

  // ── D · Introducing Crewcut (15.95–20.3 s, drop at 16.3) ─────────────────
  const lockLeft = (1920 - (300 + 46 + 210 * 3.55)) / 2;
  clips.push({
    id: "d-reveal",
    name: "Introducing Crewcut",
    startMs: 15950,
    durationMs: 4350,
    background: INK,
    transitionIn: { type: "slip-cut", durationMs: 700, direction: "right", easing: "move" },
    layers: [
      glow("d-glow", 50, 55, 90, 120, CUT, "26", { keyframes: fadeIn(300, 900) }),
      text("d-eyebrow", "Introducing", ((lockLeft + 346) / 1920) * 100, 34, 58, { font: "Instrument Serif", weight: 400, italic: true, tracking: -0.01, color: DIM, startMs: 700, keyframes: rise(0, 24, 600) }),
      ...mark("d-mark", ((lockLeft + 150) / 1920) * 100, 50, 300, 380),
      text("d-word", "crewcut", ((lockLeft + 346) / 1920) * 100, 50.5, 210, { font: "Geist", weight: 600, tracking: -0.05, leading: 1, startMs: 760, animation: { unit: "char", preset: "mask-rise", delayMs: 0, staggerMs: 38, durationMs: 600, easing: "spring-smooth" } }),
    ],
  });
  sfxClips.push(sfx("whoosh-fast", 15900, 0.5, 520), sfx("impact", 16300, 0.85, 2040));

  // ── E · An AI crew that makes your video. You keep the edit. (20.3–24.3 s) ─
  const rows = [
    { label: "Captions", color: KIND.captions, clips: [[16, 13], [31, 15], [48, 10], [61, 17], [80, 9]] },
    { label: "Main", color: KIND.main, clips: [[16, 20], [38, 25], [65, 24]] },
    { label: "Voice", color: KIND.voice, clips: [[17, 16], [36, 21], [60, 18], [80, 10]] },
    { label: "Music", color: KIND.music, clips: [[16, 74]] },
  ] as const;
  const timeline: LayerInput[] = [];
  rows.forEach((row, rowIndex) => {
    const y = 63 + rowIndex * 7.4;
    timeline.push(text(`e-label-${rowIndex}`, row.label, 4.5, y, 22, { font: "Geist Mono", weight: 500, tracking: 0, color: DIM, startMs: 250 + rowIndex * 70, keyframes: fadeIn(0, 300) }));
    row.clips.forEach(([left, width], index) => {
      timeline.push(
        rect(`e-clip-${rowIndex}-${index}`, { x: left + width / 2 - 0.3, y, w: width - 0.6, h: 5.6 }, row.color, {
          radius: 12,
          startMs: 300 + rowIndex * 90 + index * 60,
          keyframes: merge({ offsetX: [kf(0, 240, "hold"), kf(700, 0, "spring-smooth")] }, fadeIn(0, 260)),
        }),
      );
    });
  });
  clips.push({
    id: "e-pitch",
    name: "Your AI crew, your edit",
    startMs: 20300,
    durationMs: 4000,
    background: INK,
    transitionIn: { type: "blur-crossfade", durationMs: 450, direction: "left", easing: "move" },
    layers: [
      text("e-l1", "An AI crew that makes your video.", 50, 25, 84, { align: "center", startMs: 120, animation: words({ staggerMs: 55 }) }),
      text("e-l2", "*You keep the edit.*", 50, 40, 84, { align: "center", startMs: 1450, animation: words({ staggerMs: 70 }) }),
      ...timeline,
      rect("e-playhead", { x: 15.5, y: 74, w: 0.22, h: 31 }, CUT, { startMs: 900, keyframes: merge(fadeIn(0, 200), { offsetX: [kf(0, 0, "hold"), kf(3100, 1440, "linear")] }) }),
      { id: "e-playhead-cap", type: "shape", shape: "ellipse", fill: CUT, startMs: 900, transform: { x: 15.5, y: 58.5, width: 0.9, height: 1.6 }, keyframes: merge(fadeIn(0, 200), { offsetX: [kf(0, 0, "hold"), kf(3100, 1440, "linear")] }) } as LayerInput,
    ],
  });
  sfxClips.push(sfx("whoosh", 20150, 0.3, 840));

  // ── F–K · The product, recorded live ─────────────────────────────────────
  const recordedAt = 24300;
  const moments: Array<{ name: string; dur: number; build: () => ReturnType<typeof moment> }> = [
    {
      name: "Type an idea",
      dur: 6000,
      build: () =>
        moment({
          id: "f-idea",
          recording: take1,
          segments: [
            { from: 2400, to: 7300, rate: 1.6 },
            { from: 7300, to: 10300, rate: 1 },
            { from: 10300, to: 12800, rate: 3.2 },
          ],
          camera: [
            { at: 0, focus: [760, 235], zoom: 1.5 },
            { at: 9700, focus: [720, 420], zoom: 1, move: 800 },
          ],
          pill: "Type an idea.",
          url: "getcrewcut.app/home",
        }),
    },
    {
      name: "The crew works",
      dur: 6000,
      build: () =>
        moment({
          id: "g-crew",
          recording: take1,
          segments: [
            { from: 17000, to: 31600, rate: 8 },
            { from: 31600, to: 32800, rate: 1 },
            { from: 43400, to: 44700, rate: 1 },
            { from: 49000, to: 63900, rate: 8 },
          ],
          camera: [
            { at: 17000, focus: [560, 330], zoom: 1.12 },
            { at: 49000, focus: [560, 330], zoom: 1.12 },
            { at: 63900, focus: [720, 420], zoom: 1, move: 1500 },
          ],
          pill: "Researched. Written. *Fact-checked.*",
          url: "getcrewcut.app/videos/your-yawn",
          cursorFrom: 31600,
        }),
    },
    {
      name: "Nothing unsourced ships",
      dur: 4000,
      build: () =>
        moment({
          id: "h-check",
          recording: take1,
          segments: [
            { from: 77800, to: 78800, rate: 1 },
            { from: 90000, to: 102000, rate: 8 },
            { from: 102800, to: 104400, rate: 1 },
          ],
          camera: [{ at: 77800, focus: [395, 345], zoom: 1.75 }],
          pill: "Nothing unsourced ships.",
          url: "getcrewcut.app/videos/your-yawn",
          cursorFrom: 200000,
        }),
    },
    {
      name: "A real timeline",
      dur: 6000,
      build: () =>
        moment({
          id: "i-timeline",
          recording: take2,
          segments: [
            { from: 400, to: 3400, rate: 1 },
            { from: 4700, to: 7800, rate: 1 },
          ],
          camera: [
            { at: 400, focus: [520, 760], zoom: 1.55 },
            { at: 3200, focus: [1050, 760], zoom: 1.55, move: 2600 },
            { at: 6600, focus: [760, 330], zoom: 1.25, move: 1500 },
          ],
          pill: "Every layer. Every keyframe. *Yours.*",
          url: "getcrewcut.app/videos/your-yawn/edit",
        }),
    },
    {
      name: "Edit in words",
      dur: 4000,
      build: () =>
        moment({
          id: "j-words",
          recording: take2,
          segments: [
            { from: 20900, to: 22300, rate: 1 },
            { from: 22300, to: 33900, rate: 8 },
            { from: 42200, to: 43400, rate: 1 },
          ],
          camera: [
            { at: 20900, focus: [1260, 400], zoom: 1.6 },
            { at: 33900, focus: [1100, 330], zoom: 1.3, move: 600 },
          ],
          pill: "Edit in plain words…",
          url: "getcrewcut.app/videos/your-yawn/edit",
        }),
    },
    {
      name: "Or by hand",
      dur: 3000,
      build: () =>
        moment({
          id: "k-hand",
          recording: take2,
          segments: [{ from: 207600, to: 211000, rate: 1.13 }],
          camera: [{ at: 207600, focus: [270, 330], zoom: 1.7 }],
          pill: "…or by hand.",
          url: "getcrewcut.app/videos/your-yawn/edit",
        }),
    },
    {
      name: "Export",
      dur: 3000,
      build: () =>
        moment({
          id: "l-export",
          recording: take2,
          segments: [
            { from: 235800, to: 237900, rate: 1 },
            { from: 242700, to: 245300, rate: 2.6 },
          ],
          camera: [
            { at: 235800, focus: [1300, 120], zoom: 1.4 },
            { at: 237700, focus: [720, 480], zoom: 1.55, move: 600 },
          ],
          pill: "Export in *4K*. Send it to YouTube.",
          url: "getcrewcut.app/videos/your-yawn/edit",
        }),
    },
  ];
  let at = recordedAt;
  for (const [index, entry] of moments.entries()) {
    const built = entry.build();
    clips.push({
      id: `m${index}`,
      name: entry.name,
      startMs: at,
      durationMs: entry.dur,
      background: INK,
      transitionIn: index === 0 ? { type: "zoom-through", durationMs: 500, direction: "left", easing: "move" } : { type: "push", durationMs: 480, direction: "left", easing: "move" },
      layers: built.layers,
    });
    sfxClips.push(sfx(index === 0 ? "whoosh-fast" : "whoosh", at - 150, 0.28, 840));
    for (const click of clicksIn(built.recording, built.segments)) {
      const filmAt = at + built.shot.filmTime(click);
      if (filmAt < at + entry.dur - 100) sfxClips.push(sfx("click", filmAt - 20, 0.45, 520));
    }
    at += entry.dur;
  }

  // ── L · Vibe-code the app. Crewcut the video. → Try it free (56.3–63.3 s) ─
  // The tagline lands, moves up, and the film's own cursor clicks the call to
  // action, which opens into the lockup and the address as the voice says it.
  const closeStart = at;
  const closeMs = 7000;
  const ctaVoAt = 3150; // "Try it free, at get crewcut dot app."
  const ctaWords = vo.m16?.words ?? [];
  const wordAt = (word: string, fallback: number) => ctaVoAt + Math.round((ctaWords.find((w) => w.text.toLowerCase().startsWith(word))?.start ?? fallback) * 1000);
  const clickAt = wordAt("free", 0.4); // the press lands on "free"
  const openAt = clickAt + 300; // the button gives way to the lockup
  const urlAt = wordAt("get", 0.95); // the address appears as it's said
  const liftAt = 2850;
  const btnAt = 2900;
  const BTN = { x: 50, y: 64, w: 23, h: 10.5 };
  const lift = (start: number) => ({ offsetY: [kf(liftAt - start, 0, "hold"), kf(liftAt - start + 700, -150, "spring-smooth")] });
  const button = (start: number) =>
    merge(
      { scale: [kf(0, 0.9, "hold"), kf(600, 1, "spring-snappy")], opacity: [kf(0, 0, "hold"), kf(240, 1, "entrance")] },
      // The press, then the button folds away into the lockup.
      { scale: [kf(clickAt - start - 10, 1, "hold"), kf(clickAt - start + 80, 0.94, "standard"), kf(openAt - start, 1, "spring-snappy"), kf(openAt - start + 260, 0.72, "exit")] },
      { opacity: [kf(openAt - start, 1, "hold"), kf(openAt - start + 220, 0, "exit")] },
    );
  const smallLeft = (1920 - (120 + 22 + 84 * 3.55)) / 2;
  clips.push({
    id: "z-close",
    name: "Vibe-code the app. Crewcut the video. Try it free.",
    startMs: closeStart,
    durationMs: closeMs,
    background: INK,
    transitionIn: { type: "slip-cut", durationMs: 650, direction: "right", easing: "move" },
    layers: [
      glow("z-glow", 50, 45, 90, 100, CUT, "1f", { keyframes: fadeIn(200, 900) }),
      text("z-l1", "Vibe-code the app.", 50, 34, 116, { align: "center", startMs: 250, animation: words({ staggerMs: 70 }), keyframes: lift(250) }),
      text("z-l2", "*Crewcut* the video.", 50, 50, 116, { align: "center", startMs: 1250, animation: words({ staggerMs: 70 }), keyframes: lift(1250) }),
      rect("z-btn", BTN, CUT, { radius: 999, startMs: btnAt, durationMs: openAt + 400 - btnAt, shadow: { color: "#ff5b2e73", blur: 60, x: 0, y: 16 }, keyframes: button(btnAt) }),
      text("z-btn-label", "Try Crewcut free  →", BTN.x, BTN.y, 42, { align: "center", weight: 600, tracking: -0.015, color: "#ffffff", startMs: btnAt, durationMs: openAt + 400 - btnAt, keyframes: button(btnAt) }),
      cursorLayer("z-cursor", [
        [btnAt + 150, 86, 99],
        [clickAt - 60, 55.5, 66.5],
      ], [clickAt], openAt + 100),
      ripple("z-ripple", 55.5, 66.5, clickAt, 5),
      ...mark("z-mark", ((smallLeft + 60) / 1920) * 100, 64, 120, openAt),
      text("z-word", "crewcut", ((smallLeft + 142) / 1920) * 100, 64.4, 84, { font: "Geist", weight: 600, tracking: -0.045, leading: 1, startMs: openAt + 300, animation: { unit: "char", preset: "mask-rise", delayMs: 0, staggerMs: 32, durationMs: 520, easing: "spring-smooth" } }),
      text("z-url", "getcrewcut.app", 50, 79, 44, { align: "center", font: "Geist Mono", weight: 500, tracking: -0.01, color: PAPER, startMs: urlAt, keyframes: rise(0, 24, 600) }),
      text("z-beta", "free while in beta", 50, 86, 28, { align: "center", font: "Geist Mono", weight: 500, tracking: 0, color: DIM, startMs: urlAt + 350, keyframes: fadeIn(0, 400) }),
    ],
  });
  sfxClips.push(
    sfx("whoosh-fast", closeStart - 50, 0.45, 520),
    sfx("impact", closeStart + 300, 0.55, 2040),
    sfx("pop", closeStart + btnAt, 0.3, 520),
    sfx("click", closeStart + clickAt - 20, 0.55, 520),
    sfx("success", closeStart + openAt, 0.35, 1500),
    sfx("tick", closeStart + urlAt, 0.25, 520),
  );

  const totalMs = closeStart + closeMs;
  const cues = [
    { id: "m1", atMs: 350 },
    { id: "m2", atMs: 3150 },
    { id: "m3", atMs: 5850 },
    { id: "m4", atMs: 9850 },
    { id: "m5", atMs: 13050 },
    { id: "m6", atMs: 16850 },
    { id: "m7", atMs: 20500 },
    { id: "m8", atMs: 24650 },
    { id: "m9", atMs: 30500 },
    { id: "m10", atMs: 37000 },
    { id: "m11", atMs: 40500 },
    { id: "m12", atMs: 46600 },
    { id: "m13", atMs: 50550 },
    { id: "m14", atMs: 53350 },
    { id: "m15", atMs: closeStart + 350 },
    { id: "m16", atMs: closeStart + ctaVoAt },
  ];
  const { voice, captions } = voiceAndCaptions(vo, cues);

  const composition = {
    schemaVersion: 1,
    id: "film-launch",
    title: "Crewcut — launch film",
    ratio: "16:9",
    width: FRAME.width,
    height: FRAME.height,
    fps: 30,
    durationMs: totalMs,
    seed: 7,
    brief: {
      mood: "Crewcut's own: ink, paper and the cut orange; confident and quick",
      palette: { background: INK, surface: SURFACE, ink: PAPER, muted: DIM, accent: CUT, accent2: "#F5F3EE" },
      typePairing: { display: "Geist", body: "Geist", mono: "Geist Mono" },
      layoutGrid: "asymmetric",
      motionSignature: "kinetic",
      transitionSet: ["slip-cut", "push", "blur-crossfade", "zoom-through"],
      pacing: "brisk",
      notes: "Made in Crewcut. Problem in dim italics, promise in orange; the slip cut (the logo's split) marks the brand moments; cuts on the beat.",
    },
    tracks: [
      { id: "track-main", name: "Main", kind: "visual", clips: clips.map((clip) => ({ ...clip, lineIds: [], timing: "manual" })) },
      { id: "track-voice", name: "Voice", kind: "audio", role: "voice", clips: voice },
      { id: "track-music", name: "Music", kind: "audio", role: "music", volume: 1, clips: [{ id: "music", src: "asset:film-music-launch", startMs: 0, durationMs: Math.min(totalMs, 62500), volume: 0.8, fadeInMs: 0, fadeOutMs: 1200, duckUnderVoice: true, text: "Launch track (ElevenLabs Music)" }] },
      ...sfxTracks(sfxClips),
      { id: "track-captions", name: "Captions", kind: "caption", hidden: true, style: { preset: "clean", size: 40, weight: 600, font: "body", position: "bottom" }, clips: captions },
    ],
    markers: [
      { id: "mk-drop", atMs: 16300, label: "Drop" },
      { id: "mk-product", atMs: recordedAt, label: "Product" },
      { id: "mk-close", atMs: closeStart, label: "Close" },
    ],
  } as unknown as CompositionInput;
  return normalizeComposition(parseComposition(composition));
}
