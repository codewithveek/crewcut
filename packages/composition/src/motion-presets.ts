import { DEFAULT_ENTER_SCALE, DEFAULT_ENTRANCE_MS, upsertKeyframe } from "@crewcut/motion";

import { CompositionEditError, findLayer, requireVisualClip } from "./query";
import type {
  AnimatableProperty,
  Composition,
  EasingSpec,
  Keyframe,
  KeyframeMap,
  Layer,
  LayerType,
  LeafLayer,
  TextAnimation,
  Transition,
} from "./schema";
import { normalizeComposition } from "./validate";

/**
 * The motion preset library. Each preset is a keyframe recipe with spring
 * settings; applying one writes ordinary keyframes (or a text animation /
 * ambient / transition setting) that stay editable afterwards.
 *
 * Rules baked in (masterplan "Motion system"):
 * - enter from scale 0.9–0.95, never 0
 * - ease-out (entrance) or critically damped springs for entrances, never ease-in
 * - exits mirror their entrance (symmetric paths)
 * - default entrance 400–700 ms; stagger 40–80 ms; blur ≤ 20 px
 */

export type PresetGroup = "enter" | "text" | "emphasis" | "camera" | "ambient" | "transition";
export type PresetDirection = "left" | "right" | "up" | "down";

export interface PresetContext {
  /** Layer-local time where the motion starts. */
  atMs: number;
  durationMs: number;
  mode: "enter" | "exit";
  direction: PresetDirection;
  layer: Layer | LeafLayer;
  clipDurationMs: number;
}

export interface PresetResult {
  keyframes?: Partial<Record<AnimatableProperty, Keyframe[]>>;
  animation?: TextAnimation;
  ambient?: Layer["ambient"];
  transition?: Transition;
}

export interface MotionPreset {
  id: string;
  label: string;
  group: PresetGroup;
  description: string;
  appliesTo: readonly LayerType[] | "any";
  defaultDurationMs: number;
  supportsExit: boolean;
  build(context: PresetContext): PresetResult;
}

const key = (atMs: number, value: number, easing: EasingSpec = "move"): Keyframe => ({ atMs, value, easing });

/** Enter: from → to. Exit: to → from (the way it came), eased in. */
function symmetric(
  context: PresetContext,
  property: AnimatableProperty,
  from: number,
  to: number,
  easing: EasingSpec,
): Keyframe[] {
  const { atMs, durationMs, mode } = context;
  if (mode === "enter") return [key(atMs, from, "hold"), key(atMs + durationMs, to, easing)];
  return [key(atMs, to, "hold"), key(atMs + durationMs, from, "exit")];
}

function directionVector(direction: PresetDirection, distance: number): { x: number; y: number } {
  switch (direction) {
    case "left":
      return { x: -distance, y: 0 };
    case "right":
      return { x: distance, y: 0 };
    case "up":
      return { x: 0, y: -distance };
    case "down":
      return { x: 0, y: distance };
  }
}

export const MOTION_PRESETS: readonly MotionPreset[] = [
  // ── Enter / exit ──────────────────────────────────────────────────────────
  {
    id: "fade-rise",
    label: "Fade rise",
    group: "enter",
    description: "Opacity in while rising 36px on a critically damped spring.",
    appliesTo: "any",
    defaultDurationMs: DEFAULT_ENTRANCE_MS,
    supportsExit: true,
    build: (c) => ({
      keyframes: {
        opacity: symmetric(c, "opacity", 0, 1, "entrance"),
        offsetY: symmetric(c, "offsetY", 36, 0, "spring-smooth"),
      },
    }),
  },
  {
    id: "scale-in",
    label: "Scale in (0.95)",
    group: "enter",
    description: "Grows from 0.95 with opacity — nothing appears from nothing.",
    appliesTo: "any",
    defaultDurationMs: 520,
    supportsExit: true,
    build: (c) => ({
      keyframes: {
        opacity: symmetric(c, "opacity", 0, 1, "entrance"),
        scale: symmetric(c, "scale", 0.95, 1, "spring-smooth"),
      },
    }),
  },
  {
    id: "blur-in",
    label: "Blur in",
    group: "enter",
    description: "Comes into focus from an 8px blur with a slight scale.",
    appliesTo: "any",
    defaultDurationMs: 640,
    supportsExit: true,
    build: (c) => ({
      keyframes: {
        opacity: symmetric(c, "opacity", 0, 1, "entrance"),
        blur: symmetric(c, "blur", 8, 0, "entrance"),
        scale: symmetric(c, "scale", DEFAULT_ENTER_SCALE + 0.02, 1, "entrance"),
      },
    }),
  },
  {
    id: "mask-reveal",
    label: "Mask reveal",
    group: "enter",
    description: "Revealed from the bottom edge through an inset mask.",
    appliesTo: "any",
    defaultDurationMs: 600,
    supportsExit: true,
    build: (c) => ({
      keyframes: {
        clipTop: symmetric(c, "clipTop", 100, 0, "entrance"),
        offsetY: symmetric(c, "offsetY", 24, 0, "entrance"),
      },
    }),
  },
  {
    id: "clip-wipe",
    label: "Clip-path wipe",
    group: "enter",
    description: "Wipes on in the chosen direction.",
    appliesTo: "any",
    defaultDurationMs: 640,
    supportsExit: true,
    build: (c) => {
      const property: AnimatableProperty =
        c.direction === "left" ? "clipRight" : c.direction === "right" ? "clipLeft" : c.direction === "up" ? "clipBottom" : "clipTop";
      return { keyframes: { [property]: symmetric(c, property, 100, 0, "move") } };
    },
  },
  {
    id: "spring-slide",
    label: "Spring slide",
    group: "enter",
    description: "Slides in from the edge with momentum (ζ 0.8) — for things thrown in.",
    appliesTo: "any",
    defaultDurationMs: 700,
    supportsExit: true,
    build: (c) => {
      const from = directionVector(c.direction, -160);
      return {
        keyframes: {
          opacity: symmetric(c, "opacity", 0, 1, "entrance"),
          ...(from.x !== 0 ? { offsetX: symmetric(c, "offsetX", from.x, 0, "spring-momentum") } : {}),
          ...(from.y !== 0 ? { offsetY: symmetric(c, "offsetY", from.y, 0, "spring-momentum") } : {}),
        },
      };
    },
  },
  {
    id: "pop-in",
    label: "Pop in",
    group: "enter",
    description: "Scale 0.9 → 1 on a bouncy spring. Use sparingly.",
    appliesTo: "any",
    defaultDurationMs: 600,
    supportsExit: true,
    build: (c) => ({
      keyframes: {
        opacity: symmetric(c, "opacity", 0, 1, "entrance"),
        scale: symmetric(c, "scale", 0.9, 1, "spring-bouncy"),
      },
    }),
  },
  // ── Text ──────────────────────────────────────────────────────────────────
  {
    id: "word-stagger",
    label: "Word stagger",
    group: "text",
    description: "Words fade and rise one after another (60ms stagger).",
    appliesTo: ["text"],
    defaultDurationMs: 520,
    supportsExit: false,
    build: (c) => ({ animation: textAnimation(c, { unit: "word", preset: "fade-rise", staggerMs: 60 }) }),
  },
  {
    id: "line-rise",
    label: "Line rise",
    group: "text",
    description: "Each line rises out of a mask.",
    appliesTo: ["text"],
    defaultDurationMs: 640,
    supportsExit: false,
    build: (c) => ({ animation: textAnimation(c, { unit: "line", preset: "mask-rise", staggerMs: 80 }) }),
  },
  {
    id: "char-cascade",
    label: "Text morph cascade",
    group: "text",
    description: "Characters resolve from a soft blur in quick succession.",
    appliesTo: ["text"],
    defaultDurationMs: 420,
    supportsExit: false,
    build: (c) => ({ animation: textAnimation(c, { unit: "char", preset: "blur-in", staggerMs: 40 }) }),
  },
  {
    id: "typewriter",
    label: "Typewriter",
    group: "text",
    description: "Characters type on in order.",
    appliesTo: ["text", "code"],
    defaultDurationMs: 1400,
    supportsExit: false,
    build: (c) =>
      c.layer.type === "code"
        ? { keyframes: { progress: [key(c.atMs, 0, "hold"), key(c.atMs + c.durationMs, 1, "linear")] } }
        : { animation: textAnimation(c, { unit: "char", preset: "typewriter", staggerMs: 40 }) },
  },
  {
    id: "kinetic-headline",
    label: "Kinetic headline",
    group: "text",
    description: "Words punch in from 0.9 on a snappy spring, accents land last.",
    appliesTo: ["text"],
    defaultDurationMs: 480,
    supportsExit: false,
    build: (c) => ({ animation: textAnimation(c, { unit: "word", preset: "scale-in", staggerMs: 70, easing: "spring-snappy" }) }),
  },
  {
    id: "highlight-sweep",
    label: "Highlight sweep",
    group: "text",
    description: "A highlight sweeps behind *starred* words.",
    appliesTo: ["text"],
    defaultDurationMs: 700,
    supportsExit: false,
    build: (c) => ({ animation: textAnimation(c, { unit: "word", preset: "highlight", staggerMs: 60 }) }),
  },
  // ── Emphasis ──────────────────────────────────────────────────────────────
  {
    id: "number-ticker",
    label: "Number ticker",
    group: "emphasis",
    description: "Counts a number or chart up from zero.",
    appliesTo: ["chart"],
    defaultDurationMs: 1200,
    supportsExit: false,
    build: (c) => ({ keyframes: { progress: [key(c.atMs, 0, "hold"), key(c.atMs + c.durationMs, 1, "entrance")] } }),
  },
  {
    id: "pulse",
    label: "Pulse",
    group: "emphasis",
    description: "One gentle 1.06 pulse to draw the eye.",
    appliesTo: "any",
    defaultDurationMs: 600,
    supportsExit: false,
    build: (c) => ({
      keyframes: {
        scale: [
          key(c.atMs, 1, "hold"),
          key(c.atMs + c.durationMs * 0.4, 1.06, "entrance"),
          key(c.atMs + c.durationMs, 1, "spring-smooth"),
        ],
      },
    }),
  },
  {
    id: "underline-draw",
    label: "Underline draw",
    group: "emphasis",
    description: "Draws a line or shape on from the left.",
    appliesTo: ["shape"],
    defaultDurationMs: 560,
    supportsExit: true,
    build: (c) => ({ keyframes: { clipRight: symmetric(c, "clipRight", 100, 0, "move") } }),
  },
  {
    id: "focus-pull",
    label: "Focus pull",
    group: "emphasis",
    description: "Blurs this layer back (apply to the layers that should recede).",
    appliesTo: "any",
    defaultDurationMs: 500,
    supportsExit: false,
    build: (c) => ({
      keyframes: {
        blur: [key(c.atMs, 0, "hold"), key(c.atMs + c.durationMs, 6, "move")],
        opacity: [key(c.atMs, 1, "hold"), key(c.atMs + c.durationMs, 0.55, "move")],
      },
    }),
  },
  {
    id: "shake",
    label: "Shake",
    group: "emphasis",
    description: "A short horizontal shake for errors and warnings.",
    appliesTo: "any",
    defaultDurationMs: 420,
    supportsExit: false,
    build: (c) => {
      const step = c.durationMs / 6;
      const values = [0, -14, 12, -8, 5, -2, 0];
      return { keyframes: { offsetX: values.map((value, index) => key(c.atMs + step * index, value, index === 0 ? "hold" : "standard")) } };
    },
  },
  // ── Camera (apply to a camera layer) ─────────────────────────────────────
  {
    id: "dolly-zoom",
    label: "Dolly zoom",
    group: "camera",
    description: "Slow push in across the clip.",
    appliesTo: ["camera"],
    defaultDurationMs: 4000,
    supportsExit: false,
    build: (c) => ({ keyframes: { scale: [key(c.atMs, 1, "hold"), key(c.atMs + c.durationMs, 1.12, "move")] } }),
  },
  {
    id: "pan",
    label: "Pan",
    group: "camera",
    description: "Pans across in the chosen direction.",
    appliesTo: ["camera"],
    defaultDurationMs: 4000,
    supportsExit: false,
    build: (c) => {
      const to = directionVector(c.direction, 120);
      return {
        keyframes: {
          offsetX: [key(c.atMs, 0, "hold"), key(c.atMs + c.durationMs, to.x, "move")],
          offsetY: [key(c.atMs, 0, "hold"), key(c.atMs + c.durationMs, to.y, "move")],
        },
      };
    },
  },
  {
    id: "parallax",
    label: "Parallax layers",
    group: "camera",
    description: "Lateral camera drift; layers move by their depth.",
    appliesTo: ["camera"],
    defaultDurationMs: 5000,
    supportsExit: false,
    build: (c) => ({ keyframes: { offsetX: [key(c.atMs, -60, "hold"), key(c.atMs + c.durationMs, 60, "linear")] } }),
  },
  {
    id: "tilt-3d",
    label: "3D tilt",
    group: "camera",
    description: "Settles from a 10° tilt into flat.",
    appliesTo: ["camera"],
    defaultDurationMs: 1200,
    supportsExit: false,
    build: (c) => ({
      keyframes: {
        rotateX: [key(c.atMs, 10, "hold"), key(c.atMs + c.durationMs, 0, "spring-gentle")],
        scale: [key(c.atMs, 1.06, "hold"), key(c.atMs + c.durationMs, 1, "spring-gentle")],
      },
    }),
  },
  // ── Ambient ───────────────────────────────────────────────────────────────
  {
    id: "float",
    label: "Float",
    group: "ambient",
    description: "Slow vertical bob.",
    appliesTo: "any",
    defaultDurationMs: 4000,
    supportsExit: false,
    build: () => ({ ambient: { kind: "float", amplitude: 10, periodMs: 4200 } }),
  },
  {
    id: "slow-drift",
    label: "Slow drift",
    group: "ambient",
    description: "Lazy two-axis drift for background shapes.",
    appliesTo: "any",
    defaultDurationMs: 8000,
    supportsExit: false,
    build: () => ({ ambient: { kind: "drift", amplitude: 18, periodMs: 9000 } }),
  },
  {
    id: "idle-loop",
    label: "Idle loop",
    group: "ambient",
    description: "A barely-there breathing pulse.",
    appliesTo: "any",
    defaultDurationMs: 3000,
    supportsExit: false,
    build: () => ({ ambient: { kind: "pulse", amplitude: 0.025, periodMs: 3200 } }),
  },
];

/** Clip transitions (applied to a clip's `transitionIn`). */
function textAnimation(
  context: PresetContext,
  options: { unit: TextAnimation["unit"]; preset: TextAnimation["preset"]; staggerMs: number; easing?: EasingSpec },
): TextAnimation {
  return {
    unit: options.unit,
    preset: options.preset,
    delayMs: Math.max(0, context.atMs),
    staggerMs: options.staggerMs,
    durationMs: context.durationMs,
    easing: options.easing ?? "entrance",
  };
}

export function getMotionPreset(presetId: string): MotionPreset {
  const preset = MOTION_PRESETS.find((candidate) => candidate.id === presetId);
  if (!preset) throw new CompositionEditError("invalid", `Unknown motion preset "${presetId}"`);
  return preset;
}

function mergeKeyframes(existing: KeyframeMap, additions: PresetResult["keyframes"]): KeyframeMap {
  const merged: KeyframeMap = { ...existing };
  for (const [property, keyframes] of Object.entries(additions ?? {})) {
    if (!keyframes) continue;
    let track = merged[property as AnimatableProperty] ?? [];
    for (const keyframe of keyframes) track = upsertKeyframe(track, keyframe);
    merged[property as AnimatableProperty] = track;
  }
  return merged;
}

export interface ApplyMotionPresetInput {
  clipId: string;
  layerIds: string[];
  presetId: string;
  mode?: "enter" | "exit";
  /** Layer-local start. Exits default to the end of the clip. */
  atMs?: number;
  durationMs?: number;
  direction?: PresetDirection;
  /** Offsets each target layer by this much (40–80 ms reads as one motion). */
  staggerMs?: number;
}

export function applyMotionPreset(composition: Composition, input: ApplyMotionPresetInput): Composition {
  const preset = getMotionPreset(input.presetId);
  const mode = input.mode ?? "enter";
  if (mode === "exit" && !preset.supportsExit) {
    throw new CompositionEditError("invalid", `"${preset.label}" has no exit version`);
  }
  const draft = structuredClone(composition);
  const { clip } = requireVisualClip(draft, input.clipId);
  const durationMs = input.durationMs ?? preset.defaultDurationMs;

  input.layerIds.forEach((layerId, index) => {
    const location = findLayer(clip, layerId);
    if (!location) throw new CompositionEditError("layer_not_found", `No layer "${layerId}" in clip "${clip.id}"`);
    const layer = location.layer;
    if (preset.appliesTo !== "any" && !preset.appliesTo.includes(layer.type)) {
      throw new CompositionEditError("invalid", `"${preset.label}" applies to ${preset.appliesTo.join("/")} layers, not ${layer.type}`);
    }
    const layerVisibleMs = (layer.durationMs ?? clip.durationMs - layer.startMs) || clip.durationMs;
    const defaultAt = mode === "exit" ? Math.max(0, layerVisibleMs - durationMs) : 0;
    const atMs = (input.atMs ?? defaultAt) + index * (input.staggerMs ?? 0);
    const result = preset.build({
      atMs,
      durationMs,
      mode,
      direction: input.direction ?? "up",
      layer,
      clipDurationMs: clip.durationMs,
    });
    if (result.transition) clip.transitionIn = result.transition;
    const updated = {
      ...layer,
      keyframes: mergeKeyframes(layer.keyframes, result.keyframes),
      ...(result.animation && layer.type === "text" ? { animation: result.animation } : {}),
      ...(result.ambient ? { ambient: result.ambient } : {}),
    };
    if (location.parent?.type === "group") {
      location.parent.children = location.parent.children.map((child) => (child.id === layerId ? (updated as LeafLayer) : child));
    } else {
      clip.layers = clip.layers.map((candidate) => (candidate.id === layerId ? (updated as Layer) : candidate));
    }
  });
  return normalizeComposition(draft);
}
