import { verifyQuote } from "@proofcut/claim-audit";
import { type Composition, VIDEO_PRESETS, composeVideo, requireVisualClip } from "@proofcut/composition";
import {
  type Dossier,
  type Idea,
  type Metrics,
  type MetricWindow,
  type Script,
  dossierSchema,
  ideaSchema,
  metricsSchema,
  scriptSchema,
} from "@proofcut/contracts";

import { draftScenes } from "./director";
import { applyNarration, estimateLineAudio } from "./timing";

/**
 * Demo workspace seed. Everything here is labelled as sample data in the UI.
 * The research source is real: the motion section of the Proofcut masterplan,
 * stored as plain text. Every fact quotes it verbatim and is verified
 * mechanically; one script line is deliberately unsourced so QA has a real
 * flag to show.
 */
export const DEMO_SOURCE = {
  id: "s1",
  title: "Proofcut Masterplan — Motion system",
  publisher: "Proofcut masterplan (Nov 2026)",
  text: `Proofcut's motion follows Emil Kowalski's emil-design-eng, apple-design and animation-vocabulary skills, applied in two places: the rendered video and the editor UI. The agent loads these skills before composing, and the QA agent reviews motion against them.

Rules for the video
Springs first. Think in Apple's two parameters: damping ratio (1.0 = no overshoot) and response (seconds to reach the target). Default to critically damped, response 0.35–0.5 s. Use damping about 0.8 only where the motion implies momentum, such as a card thrown in.
Nothing appears from nothing. Enter from scale 0.9–0.95 with opacity, never from scale 0.
Ease-out for entrances, ease-in-out for moves. Entrances use cubic-bezier(0.23, 1, 0.32, 1); elements already on screen moving from A to B use cubic-bezier(0.77, 0, 0.175, 1). Never ease-in for an entrance.
Symmetric paths. An element leaves the way it came, and grows from the thing that caused it (origin-aware).
Stagger lists by 40–80 ms per item so they read as one motion.
Blur bridges crossfades. A 2–8 px blur during a crossfade makes two states read as one change; Emil's ceiling is 20 px.
Video is slower than UI. Emil's under-300 ms rule is for interfaces. Viewers must read on screen, so Proofcut's default entrance is 400–700 ms; tune it with real renders.
Reduced-motion render. An export option swaps slides and springs for short crossfades.`,
} as const;

export function demoIdeas(): Idea[] {
  return [
    {
      id: "idea-1",
      title: "Why good motion feels physical",
      angle: "Curves fake motion; springs model it. Six numbers that make any edit feel real.",
      format: "short",
      score: 86,
      whyNow: "Extends your best-retaining video's topic with a concrete, checkable list.",
      evidence: [
        { kind: "own-winner", label: "Sample: 'Easing curves, explained' kept 61% of viewers to 30 s", metric: "1.8× channel median" },
        { kind: "source", label: "Masterplan motion rules give exact, citable numbers" },
        { kind: "learning", label: "Learning: hooks under 3 s hold better on this channel" },
      ],
    },
    {
      id: "idea-2",
      title: "The 300 ms rule doesn't apply to video",
      angle: "UI timing rules break when people have to read. What to use instead.",
      format: "short",
      score: 74,
      evidence: [
        { kind: "question", label: "Sample: viewers asked 'how long should text stay on screen?' 14 times" },
        { kind: "source", label: "Masterplan: default entrance is 400–700 ms for video" },
      ],
    },
    {
      id: "idea-3",
      title: "Blur is the secret to smooth crossfades",
      angle: "A few pixels of blur turn two states into one change.",
      format: "short",
      score: 63,
      evidence: [{ kind: "source", label: "Masterplan: 2–8 px blur bridges crossfades" }],
    },
    {
      id: "idea-4",
      title: "Stop animating from scale zero",
      angle: "Nothing in the real world appears from nothing.",
      format: "short",
      score: 58,
      evidence: [{ kind: "source", label: "Masterplan: enter from 0.9–0.95, never 0" }],
    },
    {
      id: "idea-5",
      title: "How we fact-check every frame",
      angle: "A behind-the-scenes look at claim audits in an agent-made video.",
      format: "long",
      score: 49,
      evidence: [{ kind: "learning", label: "Learning: process videos earn subscribers, not views" }],
    },
  ].map((idea) => ideaSchema.parse(idea));
}

export function demoDossier(retrievedAt: string): Dossier {
  const facts = [
    { id: "f1", statement: "Apple describes springs with two parameters: damping ratio and response", quote: "Think in Apple's two parameters: damping ratio (1.0 = no overshoot) and response (seconds to reach the target).", confidence: "high" },
    { id: "f2", statement: "Default to a critically damped spring with a response of 0.35–0.5 s", quote: "Default to critically damped, response 0.35–0.5 s.", confidence: "high" },
    { id: "f3", statement: "Elements should enter from scale 0.9–0.95 with opacity, never from 0", quote: "Enter from scale 0.9–0.95 with opacity, never from scale 0.", confidence: "high" },
    { id: "f4", statement: "Entrances use the ease-out curve cubic-bezier(0.23, 1, 0.32, 1)", quote: "Entrances use cubic-bezier(0.23, 1, 0.32, 1)", confidence: "high" },
    { id: "f5", statement: "List items stagger by 40–80 ms so they read as one motion", quote: "Stagger lists by 40–80 ms per item so they read as one motion.", confidence: "high" },
    { id: "f6", statement: "A 2–8 px blur bridges a crossfade into one change; the ceiling is 20 px", quote: "A 2–8 px blur during a crossfade makes two states read as one change; Emil's ceiling is 20 px.", confidence: "high" },
    { id: "f7", statement: "Video entrances (400–700 ms) are slower than UI animation (under 300 ms)", quote: "Viewers must read on screen, so Proofcut's default entrance is 400–700 ms", confidence: "high" },
    { id: "f8", statement: "Underdamped springs (about 0.8) are for motion that implies momentum", quote: "Use damping about 0.8 only where the motion implies momentum, such as a card thrown in.", confidence: "medium" },
  ].map((fact) => ({ ...fact, sourceId: DEMO_SOURCE.id, verified: verifyQuote(fact.quote, DEMO_SOURCE.text).found }));

  return dossierSchema.parse({
    topic: "Why good motion feels physical",
    angle: "Curves fake motion; springs model it — and the numbers are specific.",
    summary: "Motion rules for video from Proofcut's masterplan (after Emil Kowalski's skills and Apple's fluid interfaces): springs with damping ratio and response, entrances from 0.9–0.95, staggered lists, blur-bridged crossfades and slower video timing.",
    sources: [{ id: DEMO_SOURCE.id, kind: "document", title: DEMO_SOURCE.title, publisher: DEMO_SOURCE.publisher, retrievedAt, length: DEMO_SOURCE.text.length }],
    facts,
    analogies: ["A door closer: it never slams, never bounces — that's critical damping."],
    openQuestions: ["Do viewers notice springs, or only their absence? No data in the source."],
  });
}

export function demoScript(): Script {
  return scriptSchema.parse({
    headline: "Why good motion feels physical",
    targetSeconds: 45,
    wordsPerMinute: 160,
    cta: "Steal these numbers",
    beats: [
      { id: "b1", kind: "hook", lines: [{ id: "l1", text: "Most animations feel fake for one reason.", emphasis: ["fake"] }] },
      { id: "b2", kind: "stakes", lines: [{ id: "l2", text: "They follow a curve, but real things move like springs.", factIds: ["f1"], emphasis: ["springs"] }] },
      {
        id: "b3",
        kind: "mechanism",
        lines: [
          { id: "l3", text: "Apple describes a spring with two numbers: damping ratio and response.", factIds: ["f1"], emphasis: ["two numbers"], onScreen: "Damping ratio · Response" },
          { id: "l4", text: "A damping ratio of 1.0 means no overshoot.", factIds: ["f1"], emphasis: ["no overshoot"] },
          { id: "l5", text: "Start critically damped, with a response of 0.35 to 0.5 seconds.", factIds: ["f2"], emphasis: ["0.35"] },
        ],
      },
      {
        id: "b4",
        kind: "proof",
        lines: [
          { id: "l6", text: "Nothing should appear from nothing: enter from 0.9, never from zero.", factIds: ["f3"], emphasis: ["0.9"] },
          { id: "l7", text: "Stagger lists by 40 to 80 milliseconds so they read as one motion.", factIds: ["f5"], emphasis: ["one motion"] },
        ],
      },
      {
        id: "b5",
        kind: "twist",
        lines: [
          { id: "l8", text: "But video is slower than UI: entrances run 400 to 700 milliseconds.", factIds: ["f7"], emphasis: ["slower"] },
          { id: "l9", text: "Spring motion makes viewers watch 3x longer.", emphasis: ["3x"] },
        ],
      },
      { id: "b6", kind: "payoff", lines: [{ id: "l10", text: "A blur of 2 to 8 pixels turns a crossfade into one change.", factIds: ["f6"], emphasis: ["one change"] }] },
      { id: "b7", kind: "cta", lines: [{ id: "l11", text: "Steal these numbers for your next edit.", emphasis: ["Steal"] }] },
    ],
  });
}

/** A previously published sample video, with metrics, for the analytics demo. */
export function demoPublishedScript(): Script {
  return scriptSchema.parse({
    headline: "Easing curves, explained",
    targetSeconds: 60,
    beats: [
      { id: "b1", kind: "hook", lines: [{ id: "l1", text: "Every animation you've ever loved is secretly one curve, and today I want to show you exactly which one it is." }] },
      { id: "b2", kind: "mechanism", lines: [
        { id: "l2", text: "Here's the curve in code." },
        { id: "l3", text: "Four numbers decide how it starts and stops." },
        { id: "l4", text: "Change one and the whole feel changes." },
      ] },
      { id: "b3", kind: "proof", lines: [{ id: "l5", text: "Ease-out feels fast because the motion front-loads." }, { id: "l6", text: "Ease-in feels sluggish for entrances." }] },
      { id: "b4", kind: "payoff", lines: [{ id: "l7", text: "Pick the curve for the job, not the default." }] },
      { id: "b5", kind: "cta", lines: [{ id: "l8", text: "Follow for the spring version." }] },
    ],
  });
}

function defaultDropAt(): number {
  const composition = demoPublishedComposition();
  const code = requireVisualClip(composition, "scene-2").clip;
  return (code.startMs + 400) / composition.durationMs;
}

function retentionCurve(points: Array<[number, number]>): Array<{ at: number; ratio: number }> {
  const curve: Array<{ at: number; ratio: number }> = [];
  for (let index = 0; index <= 50; index += 1) {
    const at = index / 50;
    const right = points.findIndex(([x]) => x >= at);
    const [x1, y1] = points[Math.max(0, right - 1)] ?? [0, 1];
    const [x2, y2] = points[right] ?? points[points.length - 1] ?? [1, 0];
    const t = x2 === x1 ? 0 : (at - x1) / (x2 - x1);
    curve.push({ at, ratio: Math.round((y1 + (y2 - y1) * t) * 1000) / 1000 });
  }
  return curve;
}

/**
 * The sample published video: a long hook, then a code card — the classic
 * place viewers leave. Built explicitly so the analytics demo maps the drop to it.
 */
export function demoPublishedComposition(): Composition {
  const script = demoPublishedScript();
  const lineAudio = estimateLineAudio(script);
  const scenes = draftScenes(script, null, lineAudio);
  const mechanism = scenes[1];
  if (mechanism) {
    mechanism.recipe = {
      kind: "code",
      language: "css",
      title: "ease-out.css",
      code: ".card {\n  transition: transform 300ms\n    cubic-bezier(0.23, 1, 0.32, 1);\n}",
      caption: "Four numbers decide the feel",
    };
  }
  const composition = composeVideo({
    id: "sample-published",
    title: script.headline,
    ratio: "9:16",
    seed: 21,
    brief: VIDEO_PRESETS.studio?.brief ?? (() => { throw new Error("studio preset missing"); })(),
    scenes,
  });
  return applyNarration(composition, lineAudio);
}

/** Retention for the sample video, dropping where its code card starts (`dropAt`, 0..1). */
export function demoMetrics(options: { dropAt?: number } = {}): Record<MetricWindow, Metrics> {
  const dropAt = Math.min(0.6, Math.max(0.06, options.dropAt ?? defaultDropAt()));
  const retention = retentionCurve([
    [0, 1],
    [dropAt - 0.05, 0.9],
    [dropAt, 0.86],
    [dropAt + 0.08, 0.54],
    [Math.max(dropAt + 0.2, 0.5), 0.45],
    [0.8, 0.38],
    [1, 0.32],
  ]);
  const base = {
    retention,
    trafficSources: [
      { source: "Shorts feed", share: 0.58 },
      { source: "Browse", share: 0.21 },
      { source: "Search", share: 0.14 },
      { source: "External", share: 0.07 },
    ],
    comments: [
      { text: "What curve do you use for modals?", likes: 41 },
      { text: "The code part lost me, went too fast", likes: 33 },
      { text: "Please do springs next!", likes: 28 },
      { text: "Isn't ease-in-out better for everything?", likes: 9 },
    ],
  };
  return {
    "48h": metricsSchema.parse({ ...base, views: 4_120, impressions: 61_000, ctr: 0.067, averageViewDurationSec: 27, averagePercentViewed: 0.46, subscribersGained: 38, likes: 310 }),
    "7d": metricsSchema.parse({ ...base, views: 12_400, impressions: 205_000, ctr: 0.061, averageViewDurationSec: 26, averagePercentViewed: 0.44, subscribersGained: 112, likes: 880 }),
    "28d": metricsSchema.parse({ ...base, views: 19_800, impressions: 360_000, ctr: 0.055, averageViewDurationSec: 25, averagePercentViewed: 0.42, subscribersGained: 171, likes: 1_320 }),
  };
}
