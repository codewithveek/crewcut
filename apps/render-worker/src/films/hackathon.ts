import { type CompositionInput, type LayerInput, normalizeComposition, parseComposition } from "@crewcut/composition";

import { clicksIn } from "./launch";
import { CUT, DIM, FRAME, INK, INK_2, PAPER, SURFACE, exitUp, fadeIn, glow, kf, loadRecording, loadVo, mark, merge, pop, rect, rise, sfx, sfxTracks, text, voiceAndCaptions, words } from "./kit";
import { type CameraBeat, type Recording, type Segment, screen } from "./screen";

/**
 * The hackathon demo: Autopilot, recorded live. One sentence in, the crew
 * makes the whole video on its own (it even recovers when its run dies), then
 * the same video opens in a real editor. Ends on how Agent-Native makes it work.
 *
 * Takes: auto1 = the autopilot run from the home page (marks: typing,
 * autopilot-on, launched, done = the watchdog's resume), auto3 = the finished
 * project, stage by stage, then the editor (marks named after each stop).
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
  note?: string;
}

const WINDOW = { x: 50, y: 54.5, w: 72 };
const DISCLOSURE = "Recorded live on Crewcut  ·  crew model: GLM 5.3 (Workers AI, through Crewcut AI)  ·  waiting sped up";

/** `demo` is the customer cut: a "how Autopilot works" title in place of the problem, and a "you stay in control" card in place of Agent-Native. */
export function hackathonFilm(sourceDir: string, variant: "hackathon" | "demo" = "hackathon"): CompositionInput {
  const demo = variant === "demo";
  const run = loadRecording("auto1", sourceDir);
  const tour = loadRecording("auto3", sourceDir);
  const vo = loadVo(`${sourceDir}/../audio`);
  const m = (recording: Recording, name: string, fallback: number) => recording.marks[name] ?? fallback;
  const clips: Array<Record<string, unknown>> = [];
  const sfxClips: ReturnType<typeof sfx>[] = [];
  const cues: Array<{ id: string; atMs: number }> = [];
  const extraAudio: Array<Record<string, unknown>> = [];

  // ── Cold open: the video Autopilot made, untouched (0–13.8 s) ────────────
  const open = demo ? 11500 : 13800;
  clips.push({
    id: "open",
    name: "The video Autopilot made",
    startMs: 0,
    durationMs: open,
    background: INK,
    layers: [
      glow("open-glow", 50, 60, 100, 110, "#f0a040", "14"),
      {
        id: "open-video",
        type: "video",
        src: "asset:film-auto-video",
        fit: "cover",
        radius: 22,
        volume: 0,
        transform: { x: 50, y: 45, width: 76, height: 76 },
        shadow: { color: "#000000b3", blur: 90, x: 0, y: 40 },
        keyframes: { scale: [kf(0, 1, "hold"), kf(open, 0.95, "linear")] },
      } as LayerInput,
      text("open-tag", demo ? "MADE BY AUTOPILOT FROM ONE SENTENCE" : "MADE ON AUTOPILOT FROM ONE SENTENCE  ·  UNTOUCHED", 50, 90.5, 24, { align: "center", font: "Geist Mono", weight: 500, tracking: 0.12, color: CUT, startMs: 600, keyframes: fadeIn(0, 500) }),
    ],
  });
  extraAudio.push({ id: "open-audio", src: "asset:film-auto-video-audio", startMs: 0, durationMs: open, volume: 1, fadeOutMs: 600, envelope: [{ atMs: 0, value: 1 }, { atMs: 3600, value: 1 }, { atMs: 4100, value: 0.1 }, { atMs: open, value: 0.08 }], text: "The autopilot video's own voice-over" });
  cues.push({ id: demo ? "p1" : "h1", atMs: 4000 });

  // ── The problem (13.8–21.4 s) ────────────────────────────────────────────
  const problemAt = open;
  const problemMs = demo ? 0 : 7600;
  if (!demo) clips.push({
    id: "problem",
    name: "A flat file",
    startMs: problemAt,
    durationMs: problemMs,
    background: { gradient: { kind: "radial", angle: 0, stops: [{ color: INK_2, at: 0 }, { color: INK, at: 1 }] } },
    transitionIn: { type: "push", durationMs: 480, direction: "left", easing: "move" },
    layers: [
      glow("p-glow", 50, 55, 90, 100, "#8b5cf6", "14"),
      text("p-1", "AI video tools hand you\n*a flat file.*", 50, 40, 100, { align: "center", accent: DIM, startMs: 250, animation: words({ staggerMs: 60 }), keyframes: exitUp(3700 - 250) }),
      text("p-2", "Where did that\nclaim come from?", 50, 40, 100, { align: "center", startMs: 3750, animation: words({ staggerMs: 60 }), keyframes: exitUp(5600 - 3750) }),
      text("p-3", "One wrong word?\n*Start over.*", 50, 40, 100, { align: "center", accent: CUT, startMs: 5650, animation: words({ staggerMs: 60 }) }),
    ],
  });
  if (!demo) {
    cues.push({ id: "h2", atMs: problemAt + 300 });
    sfxClips.push(sfx("whoosh", problemAt - 140, 0.3, 840), sfx("error", problemAt + 5700, 0.35, 520));
  }

  // ── Crewcut (21.4–27.8 s) ────────────────────────────────────────────────
  const introAt = problemAt + problemMs;
  const introMs = demo ? 7400 : 6400;
  const lockLeft = (1920 - (170 + 30 + 120 * 3.55)) / 2;
  if (demo) {
    clips.push({
      id: "intro",
      name: "How Autopilot works",
      startMs: introAt,
      durationMs: introMs,
      background: { gradient: { kind: "radial", angle: 0, stops: [{ color: INK_2, at: 0 }, { color: INK, at: 1 }] } },
      transitionIn: { type: "slip-cut", durationMs: 650, direction: "right", easing: "move" },
      layers: [
        glow("i-glow", 50, 60, 90, 110, CUT, "1f"),
        text("i-eyebrow", "CREWCUT AUTOPILOT  ·  HOW IT WORKS", 50, 33, 26, { align: "center", font: "Geist Mono", weight: 500, tracking: 0.18, color: CUT, startMs: 300, keyframes: fadeIn(0, 400) }),
        text("i-line", "From one sentence to a\n*finished, editable video.*", 50, 53, 96, { align: "center", startMs: 350, animation: words({ staggerMs: 70 }) }),
      ],
    });
    cues.push({ id: "p2", atMs: introAt + 500 });
    sfxClips.push(sfx("whoosh-fast", introAt - 60, 0.4, 520), sfx("pop", introAt + 400, 0.25, 520));
  } else clips.push({
    id: "intro",
    name: "Crewcut",
    startMs: introAt,
    durationMs: introMs,
    background: INK,
    transitionIn: { type: "slip-cut", durationMs: 650, direction: "right", easing: "move" },
    layers: [
      glow("i-glow", 50, 45, 90, 100, CUT, "1f", { keyframes: fadeIn(200, 900) }),
      ...mark("i-mark", ((lockLeft + 85) / 1920) * 100, 38, 170, 250),
      text("i-word", "crewcut", ((lockLeft + 200) / 1920) * 100, 38.6, 120, { font: "Geist", weight: 600, tracking: -0.05, leading: 1, startMs: 600, animation: { unit: "char", preset: "mask-rise", delayMs: 0, staggerMs: 36, durationMs: 560, easing: "spring-smooth" } }),
      text("i-eyebrow", "AN AGENT-NATIVE VIDEO STUDIO", 50, 54, 26, { align: "center", font: "Geist Mono", weight: 500, tracking: 0.18, color: CUT, startMs: 1300, keyframes: fadeIn(0, 400) }),
      text("i-line", "An AI crew makes the video.\n*You keep the edit.*", 50, 68, 64, { align: "center", startMs: 2600, animation: words({ staggerMs: 60 }) }),
    ],
  });
  if (!demo) {
    cues.push({ id: "h3", atMs: introAt + 400 });
    sfxClips.push(sfx("whoosh-fast", introAt - 60, 0.4, 520), sfx("impact", introAt + 250, 0.45, 2040));
  }

  // ── The run, then what it made ──────────────────────────────────────────
  const typing = m(run, "typing", 1700);
  const launched = m(run, "launched", 11260);
  const resumed = m(run, "done", 1042600);
  const steps: Step[] = [
    {
      id: "s1",
      number: "01",
      title: "One sentence. Autopilot on.",
      recording: run,
      segments: [{ from: typing - 900, to: launched + 1600, rate: 1.15 }],
      camera: [
        { at: typing - 900, focus: [930, 230], zoom: 1.7 },
        { at: launched - 2600, focus: [1000, 300], zoom: 1.7, move: 900 },
        { at: launched + 900, focus: [720, 300], zoom: 1.2, move: 700 },
      ],
      url: "getcrewcut.app/home",
      cues: [{ id: "h4", offset: 500 }],
      note: DISCLOSURE,
    },
    {
      id: "s2",
      number: "02",
      title: "The trend agent picks the idea",
      recording: run,
      segments: [
        { from: launched + 1600, to: 74000, rate: 8 },
        { from: 79000, to: 88000, rate: 1.6 },
      ],
      camera: [
        { at: launched + 1600, focus: [560, 230], zoom: 1.55 },
        { at: 82000, focus: [480, 160], zoom: 1.8, move: 900 },
      ],
      url: "getcrewcut.app/videos/time",
      cues: [{ id: "h5", offset: 400 }],
    },
    {
      id: "s3",
      number: "03",
      title: "Research that quotes its sources",
      recording: tour,
      segments: [{ from: m(tour, "research", 20306) - 3200, to: m(tour, "research", 20306) + 7000, rate: 1.2 }],
      camera: [
        { at: m(tour, "research", 20306) - 3200, focus: [560, 560], zoom: 1.4 },
        { at: m(tour, "research", 20306) + 1000, focus: [560, 700], zoom: 1.45, move: 2200 },
      ],
      url: "getcrewcut.app/videos/time",
      cues: [{ id: "h6", offset: 400 }],
    },
    {
      id: "s4",
      number: "04",
      title: "It recovers on its own",
      recording: run,
      segments: [
        { from: 330000, to: 333500, rate: 1 },
        { from: resumed - 5000, to: resumed + 8000, rate: 1.5 },
      ],
      camera: [
        { at: 330000, focus: [520, 190], zoom: 1.7 },
        { at: resumed - 800, focus: [500, 200], zoom: 1.9, move: 900 },
      ],
      url: "getcrewcut.app/videos/time",
      cues: [{ id: "h7", offset: 300 }],
    },
    {
      id: "s5",
      number: "05",
      title: "A source on every line. Fact-check: 100",
      recording: tour,
      segments: [
        { from: m(tour, "script", 50050) - 3200, to: m(tour, "script", 50050) + 4500, rate: 1.2 },
        { from: m(tour, "factcheck", 62329) - 3400, to: m(tour, "factcheck", 62329) + 2500, rate: 1 },
      ],
      camera: [
        { at: m(tour, "script", 50050) - 3200, focus: [560, 600], zoom: 1.4 },
        { at: m(tour, "factcheck", 62329) - 2600, focus: [430, 530], zoom: 1.75, move: 700 },
      ],
      url: "getcrewcut.app/videos/time",
      cues: [{ id: "h8", offset: 400 }],
    },
    {
      id: "s6",
      number: "06",
      title: "Designed, voiced, exported. Every decision logged",
      recording: tour,
      segments: [
        { from: m(tour, "motion", 68029) - 3200, to: m(tour, "motion", 68029) + 2300, rate: 1 },
        { from: m(tour, "voice", 73293) - 3000, to: m(tour, "voice", 73293) + 1500, rate: 1.2 },
        { from: m(tour, "publish", 78366) - 3000, to: m(tour, "publish", 78366) + 2200, rate: 1 },
      ],
      camera: [
        { at: m(tour, "motion", 68029) - 3200, focus: [520, 600], zoom: 1.4 },
        { at: m(tour, "voice", 73293) - 3000, focus: [560, 560], zoom: 1.4 },
        { at: m(tour, "publish", 78366) - 1600, focus: [1180, 600], zoom: 1.45, move: 1200 },
      ],
      url: "getcrewcut.app/videos/time",
      cues: [{ id: "h9", offset: 400 }],
    },
    {
      id: "s7",
      number: "07",
      title: "It opens in a real editor",
      recording: tour,
      segments: [{ from: m(tour, "editor", 86358) - 200, to: m(tour, "play-1", 91437) + 5000, rate: 1 }],
      camera: [
        { at: m(tour, "editor", 86358), focus: [720, 450], zoom: 1 },
        { at: m(tour, "play-1", 91437) - 1500, focus: [620, 760], zoom: 1.5, move: 1800 },
        { at: m(tour, "play-1", 91437) + 2500, focus: [700, 330], zoom: 1.3, move: 1200 },
      ],
      url: "getcrewcut.app/videos/time/edit",
      cues: [{ id: "h10", offset: 400 }],
    },
    {
      id: "s8",
      number: "08",
      title: "Change it in words, or by hand",
      recording: tour,
      segments: [
        { from: m(tour, "edit-asked", 111134) - 2600, to: m(tour, "edit-asked", 111134) + 1200, rate: 1 },
        { from: m(tour, "edit-asked", 111134) + 1200, to: m(tour, "edit-asked", 111134) + 20000, rate: 8 },
        { from: 300000, to: 341000, rate: 8 },
        { from: 341000, to: 345000, rate: 1 },
        { from: m(tour, "trimmed", 512864) - 2600, to: m(tour, "4k", 525256) + 600, rate: 1.4 },
      ],
      camera: [
        { at: m(tour, "edit-asked", 111134) - 2600, focus: [1240, 420], zoom: 1.45 },
        { at: 344500, focus: [1240, 420], zoom: 1.45 },
        { at: m(tour, "trimmed", 512864) - 2600, focus: [640, 700], zoom: 1.35, move: 700 },
        { at: m(tour, "export", 518770) - 300, focus: [720, 450], zoom: 1.15, move: 700 },
      ],
      url: "getcrewcut.app/videos/time/edit",
      cues: [
        { id: "h11", offset: 400 },
        { id: "h12", offset: 15300 },
      ],
      note: "The agent's edit took 3 min 47 s on GLM 5.3  ·  shown 8× faster",
    },
  ];

  let at = introAt + introMs;
  for (const [index, step] of steps.entries()) {
    const shot = screen({ id: `${step.id}-win`, recording: step.recording, segments: step.segments, camera: step.camera, box: WINDOW, frame: FRAME, url: step.url, cursorFrom: step.cursorFrom, entrance: "none" });
    const lineMs = step.cues.reduce((end, cue) => Math.max(end, cue.offset + (vo[cue.id]?.durationMs ?? 0) + 500), 0);
    const duration = Math.round(Math.max(shot.durationMs, Math.min(lineMs, shot.durationMs + 1500)));
    const left = ((1920 - WINDOW.w * 19.2) / 2 / 1920) * 100;
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
        { id: `${step.id}-band`, type: "shape", shape: "rect", fill: { gradient: { kind: "linear", angle: 180, stops: [{ color: `${INK}f2`, at: 0 }, { color: `${INK}c0`, at: 0.55 }, { color: `${INK}00`, at: 1 }] } }, transform: { x: 50, y: 7.5, width: 100, height: 15 } } as LayerInput,
        text(`${step.id}-num`, step.number, left, 6.2, 30, { font: "Geist Mono", weight: 600, tracking: 0, color: CUT, keyframes: rise(150, 16, 500) }),
        text(`${step.id}-title`, step.title, left + 3, 6.2, 40, { font: "Geist", weight: 600, tracking: -0.025, startMs: 120, animation: words({ staggerMs: 40, durationMs: 520 }) }),
        ...(step.note ? [text(`${step.id}-note`, step.note, 50, 97.2, 19, { align: "center", font: "Geist Mono", weight: 500, tracking: 0, color: DIM, startMs: 600, keyframes: fadeIn(0, 400) })] : []),
      ],
    });
    for (const cue of step.cues) cues.push({ id: cue.id, atMs: at + cue.offset });
    sfxClips.push(sfx("whoosh", at - 140, 0.22, 840));
    for (const click of clicksIn(step.recording, step.segments)) sfxClips.push(sfx("click", at + shot.filmTime(click) - 20, 0.4, 520));
    at += duration;
  }

  // ── How Agent-Native makes it work (hackathon) / you stay in control (demo)
  const anMs = demo ? 0 : Math.max(19500, (vo.h13?.durationMs ?? 18000) + 1300);
  const anAt = at;
  let middleMs = anMs;
  if (!demo) {
  const h13Words = vo.h13?.words ?? [];
  const wordAt = (needle: string, fallback: number) => 500 + Math.round((h13Words.find((w) => w.text.toLowerCase().startsWith(needle))?.start ?? fallback) * 1000);
  const cards = [
    { id: "an-actions", big: "86", label: "actions shared by the\ninterface and the agent", at: wordAt("interface", 2.6) },
    { id: "an-skills", big: "9", label: "skills: one for each\ncrew member", at: wordAt("crew", 6.2) },
    { id: "an-gates", big: "19", label: "people-only actions,\nenforced on the server", at: wordAt("people", 8.0) },
    { id: "an-runs", big: "24/7", label: "background runs that\noutlive the tab", at: wordAt("background", 12.5) },
  ];
  clips.push({
    id: "agent-native",
    name: "Built on Agent-Native",
    startMs: anAt,
    durationMs: anMs,
    background: { gradient: { kind: "radial", angle: 0, stops: [{ color: INK_2, at: 0 }, { color: INK, at: 1 }] } },
    transitionIn: { type: "slip-cut", durationMs: 650, direction: "right", easing: "move" },
    layers: [
      glow("an-glow", 50, 50, 100, 100, CUT, "14"),
      text("an-eyebrow", "HOW IT WORKS", 50, 17, 26, { align: "center", font: "Geist Mono", weight: 500, tracking: 0.18, color: CUT, startMs: 200, keyframes: fadeIn(0, 400) }),
      text("an-title", "Built on *Agent-Native*", 50, 26, 84, { align: "center", startMs: 300, animation: words({ staggerMs: 70 }) }),
      ...cards.flatMap((card, index) => {
        const x = 17 + index * 22;
        return [
          rect(`${card.id}-card`, { x, y: 60, w: 19.5, h: 34 }, SURFACE, { radius: 28, stroke: "#ffffff1f", strokeWidth: 1.5, startMs: card.at, shadow: { color: "#00000080", blur: 50, x: 0, y: 18 }, keyframes: pop(0, 0.9) }),
          text(`${card.id}-big`, card.big, x, 53, 110, { align: "center", font: "Geist", weight: 600, tracking: -0.04, color: CUT, startMs: card.at + 80, keyframes: rise(0, 20, 500) }),
          text(`${card.id}-label`, card.label, x, 68, 30, { align: "center", font: "Geist", weight: 500, tracking: -0.01, color: PAPER, startMs: card.at + 200, keyframes: fadeIn(0, 400) }),
        ];
      }),
      text("an-foot", "The crew's every step goes through the same actions, skills and gates as the person's.", 50, 88, 26, { align: "center", color: DIM, startMs: wordAt("tab", 16.5), keyframes: fadeIn(0, 500) }),
    ],
  });
  cues.push({ id: "h13", atMs: anAt + 500 });
  sfxClips.push(sfx("whoosh-fast", anAt - 60, 0.4, 520), ...cards.map((card) => sfx("pop", anAt + card.at, 0.3, 520)));
  }

  if (demo) {
    // ── You stay in control (demo) ──────────────────────────────────────────
    const ctlAt = at;
    const ctlMs = (vo.p3?.durationMs ?? 6300) + 1600;
    middleMs = ctlMs;
    const p3Words = vo.p3?.words ?? [];
    const p3At = (needle: string, fallback: number) => 500 + Math.round((p3Words.find((w) => w.text.toLowerCase().startsWith(needle))?.start ?? fallback) * 1000);
    const controls = [
      { id: "ctl-take", big: "Take over", label: "at any step: the steps\nwait for you again", at: p3At("take", 1.6) },
      { id: "ctl-resume", big: "Resume", label: "whenever you like, from\nwhere it stopped", at: p3At("resume", 3.0) },
      { id: "ctl-publish", big: "You publish", label: "Autopilot never posts.\nThat step is yours.", at: p3At("nothing", 4.4) },
    ];
    clips.push({
      id: "control",
      name: "You stay in control",
      startMs: ctlAt,
      durationMs: ctlMs,
      background: { gradient: { kind: "radial", angle: 0, stops: [{ color: INK_2, at: 0 }, { color: INK, at: 1 }] } },
      transitionIn: { type: "slip-cut", durationMs: 650, direction: "right", easing: "move" },
      layers: [
        glow("ctl-glow", 50, 50, 100, 100, CUT, "14"),
        text("ctl-title", "You stay *in control.*", 50, 24, 84, { align: "center", startMs: 300, animation: words({ staggerMs: 70 }) }),
        ...controls.flatMap((card, index) => {
          const x = 22 + index * 28;
          return [
            rect(`${card.id}-card`, { x, y: 60, w: 25, h: 32 }, SURFACE, { radius: 28, stroke: "#ffffff1f", strokeWidth: 1.5, startMs: card.at, shadow: { color: "#00000080", blur: 50, x: 0, y: 18 }, keyframes: pop(0, 0.9) }),
            text(`${card.id}-big`, card.big, x, 54, 62, { align: "center", font: "Geist", weight: 600, tracking: -0.03, color: CUT, startMs: card.at + 80, keyframes: rise(0, 20, 500) }),
            text(`${card.id}-label`, card.label, x, 66, 28, { align: "center", font: "Geist", weight: 500, tracking: -0.01, color: PAPER, startMs: card.at + 200, keyframes: fadeIn(0, 400) }),
          ];
        }),
      ],
    });
    cues.push({ id: "p3", atMs: ctlAt + 500 });
    sfxClips.push(sfx("whoosh-fast", ctlAt - 60, 0.4, 520), ...controls.map((card) => sfx("pop", ctlAt + card.at, 0.3, 520)));

  }
  // ── Close ───────────────────────────────────────────────────────────────
  const endAt = anAt + middleMs;
  const closeLine = demo ? "p4" : "h14";
  const endMs = Math.max(9000, (vo[closeLine]?.durationMs ?? 6700) + 2600);
  const smallLeft = (1920 - (120 + 22 + 84 * 3.55)) / 2;
  const getAt = 400 + Math.round((vo[closeLine]?.words.find((w) => w.text.toLowerCase() === "get")?.start ?? 5.4) * 1000);
  clips.push({
    id: "end",
    name: "One sentence in. A fact-checked, editable video out.",
    startMs: endAt,
    durationMs: endMs,
    background: INK,
    transitionIn: { type: "slip-cut", durationMs: 650, direction: "right", easing: "move" },
    layers: [
      glow("end-glow", 50, 45, 90, 100, CUT, "1f", { keyframes: fadeIn(200, 900) }),
      text("end-l1", "One sentence in.", 50, 30, 108, { align: "center", startMs: 250, animation: words({ staggerMs: 70 }) }),
      text("end-l2", demo ? "*A finished, editable video out.*" : "*A fact-checked, editable video out.*", 50, 45, 84, { align: "center", startMs: 1100, animation: words({ staggerMs: 60 }) }),
      ...mark("end-mark", ((smallLeft + 60) / 1920) * 100, 66, 120, getAt - 900),
      text("end-word", "crewcut", ((smallLeft + 142) / 1920) * 100, 66.4, 84, { font: "Geist", weight: 600, tracking: -0.045, leading: 1, startMs: getAt - 600, animation: { unit: "char", preset: "mask-rise", delayMs: 0, staggerMs: 32, durationMs: 520, easing: "spring-smooth" } }),
      text("end-url", "getcrewcut.app", 50, 80, 44, { align: "center", font: "Geist Mono", weight: 500, tracking: -0.01, color: PAPER, startMs: getAt, keyframes: rise(0, 24, 600) }),
      text("end-beta", demo ? "Autopilot on Creator and Studio plans" : "free while in beta", 50, 86.5, 28, { align: "center", font: "Geist Mono", weight: 500, tracking: 0, color: DIM, startMs: getAt + 350, keyframes: fadeIn(0, 400) }),
      text("end-note", DISCLOSURE, 50, 96.5, 19, { align: "center", font: "Geist Mono", weight: 500, tracking: 0, color: "#6E6E78", startMs: 1500, keyframes: fadeIn(0, 500) }),
    ],
  });
  cues.push({ id: closeLine, atMs: endAt + 400 });
  sfxClips.push(sfx("whoosh-fast", endAt - 60, 0.4, 520), sfx("impact", endAt + getAt - 900, 0.4, 2040), sfx("tick", endAt + getAt, 0.25, 520));
  const totalMs = endAt + endMs;

  const { voice, captions: allCaptions } = voiceAndCaptions(vo, cues, { captionsMaxWords: 8 });
  // Title cards say their lines on screen; captions cover the screen-recording steps and the cold open.
  const captions = allCaptions.filter((caption) => !/^cap-(h2|h3|h14|p2|p3|p4)-/.test(caption.id));
  const composition = {
    schemaVersion: 1,
    id: demo ? "film-autopilot-demo" : "film-hackathon",
    title: demo ? "Crewcut Autopilot — how it works" : "Crewcut — Autopilot, recorded live (Agent-Native Hackathon demo)",
    ratio: "16:9",
    width: FRAME.width,
    height: FRAME.height,
    fps: 30,
    durationMs: totalMs,
    seed: 13,
    brief: {
      mood: "Studio: a dark stage, the real app, a calm guide",
      palette: { background: INK, surface: SURFACE, ink: PAPER, muted: DIM, accent: CUT, accent2: PAPER },
      typePairing: { display: "Geist", body: "Geist", mono: "Geist Mono" },
      layoutGrid: "centered",
      motionSignature: "ease-glide",
      transitionSet: ["push", "slip-cut", "zoom-through"],
      pacing: "measured",
      notes: "Made in Crewcut from a live Autopilot run (GLM 5.3 through Crewcut AI). Every screen is the real app; waiting is sped up.",
    },
    tracks: [
      { id: "track-main", name: "Main", kind: "visual", clips: clips.map((clip) => ({ ...clip, lineIds: [], timing: "manual" })) },
      { id: "track-voice", name: "Voice", kind: "audio", role: "voice", clips: voice },
      { id: "track-source-audio", name: "Video audio", kind: "audio", role: "sfx", clips: extraAudio },
      { id: "track-music", name: "Music", kind: "audio", role: "music", clips: [{ id: "music", src: "asset:film-music-hack", startMs: 0, durationMs: Math.min(totalMs, 175000), volume: 0.4, fadeInMs: 1500, fadeOutMs: 2500, duckUnderVoice: true, text: "Hackathon bed (ElevenLabs Music)" }] },
      ...sfxTracks(sfxClips),
      {
        id: "track-captions",
        name: "Captions",
        kind: "caption",
        style: { preset: "boxed", size: 34, weight: 600, font: "body", color: "#F5F3EE", highlightColor: "#FF5B2E", highlightStyle: "color", background: "#0D0D0Fd9", positionY: 91, maxWidth: 66 },
        clips: captions,
      },
    ],
    markers: [],
  } as unknown as CompositionInput;
  return normalizeComposition(parseComposition(composition));
}

void merge;
