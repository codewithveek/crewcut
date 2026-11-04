import { z } from "zod";

import { FONT_FAMILIES, FONT_ROLES } from "./fonts";
import { ICON_NAMES } from "./icons";
import { ASPECT_RATIOS } from "./units";

/**
 * The layer composition schema: a video is tracks of clips; a visual clip holds
 * layers; every numeric layer property can carry keyframes. The model writes
 * this JSON (never JSX); one renderer draws it; QA reads it.
 */

export const idSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_.:-]+$/, "Use letters, digits, _ . : -");

export const hexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "Expected #rrggbb or #rrggbbaa");

export const aspectRatioSchema = z.enum(ASPECT_RATIOS);
export const fontFamilySchema = z.enum(FONT_FAMILIES);
export const fontRefSchema = z.union([z.enum(FONT_ROLES), fontFamilySchema]);
export const iconNameSchema = z.enum(ICON_NAMES);

// ── Easing ──────────────────────────────────────────────────────────────────

export const namedEasingSchema = z.enum([
  "linear",
  "hold",
  "entrance",
  "move",
  "exit",
  "standard",
  "spring-snappy",
  "spring-smooth",
  "spring-gentle",
  "spring-momentum",
  "spring-bouncy",
]);

export const easingSchema = z.union([
  namedEasingSchema,
  z.object({ bezier: z.tuple([z.number().min(0).max(1), z.number(), z.number().min(0).max(1), z.number()]) }),
  z.object({
    spring: z.object({
      dampingRatio: z.number().min(0.1).max(3),
      response: z.number().min(0.05).max(3),
    }),
  }),
]);
export type EasingSpec = z.infer<typeof easingSchema>;

// ── Keyframes ───────────────────────────────────────────────────────────────

export const ANIMATABLE_PROPERTIES = [
  "x",
  "y",
  "width",
  "height",
  "scale",
  "scaleX",
  "scaleY",
  "rotation",
  "rotateX",
  "rotateY",
  "opacity",
  "blur",
  "offsetX",
  "offsetY",
  "clipTop",
  "clipRight",
  "clipBottom",
  "clipLeft",
  "progress",
] as const;
export const animatablePropertySchema = z.enum(ANIMATABLE_PROPERTIES);
export type AnimatableProperty = (typeof ANIMATABLE_PROPERTIES)[number];

export const keyframeSchema = z.object({
  /** Milliseconds from the layer's start. */
  atMs: z.number().min(-600_000).max(3_600_000),
  value: z.number(),
  /** Shapes the segment arriving at this keyframe. */
  easing: easingSchema.default("move"),
});
export type Keyframe = z.infer<typeof keyframeSchema>;

export const keyframeMapSchema = z.partialRecord(animatablePropertySchema, z.array(keyframeSchema));
export type KeyframeMap = z.infer<typeof keyframeMapSchema>;

// ── Transform ───────────────────────────────────────────────────────────────

export const transformSchema = z.object({
  /** Anchor position, % of frame width/height. */
  x: z.number().default(50),
  y: z.number().default(50),
  /** Box size, % of frame. Text layers size to content when omitted. */
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  /** Which point of the layer box sits at (x, y): 0..1. */
  anchorX: z.number().min(0).max(1).default(0.5),
  anchorY: z.number().min(0).max(1).default(0.5),
  /** Transform origin for scale/rotation (origin-aware motion): 0..1. */
  originX: z.number().min(0).max(1).default(0.5),
  originY: z.number().min(0).max(1).default(0.5),
  scale: z.number().default(1),
  scaleX: z.number().default(1),
  scaleY: z.number().default(1),
  rotation: z.number().default(0),
  rotateX: z.number().default(0),
  rotateY: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),
  /** Design px; Emil's ceiling is 20. */
  blur: z.number().min(0).max(40).default(0),
  /** Design px offsets layered on top of x/y (entrances use these). */
  offsetX: z.number().default(0),
  offsetY: z.number().default(0),
  /** Inset clip-path in % of the layer box (mask and wipe reveals). */
  clipTop: z.number().min(0).max(100).default(0),
  clipRight: z.number().min(0).max(100).default(0),
  clipBottom: z.number().min(0).max(100).default(0),
  clipLeft: z.number().min(0).max(100).default(0),
  /** 0..1, drives charts, typewriter and draw-on effects. */
  progress: z.number().min(0).max(1).default(1),
});
export type Transform = z.infer<typeof transformSchema>;

export const fillSchema = z.union([
  hexColorSchema,
  z.object({
    gradient: z.object({
      kind: z.enum(["linear", "radial"]).default("linear"),
      angle: z.number().default(135),
      stops: z
        .array(z.object({ color: hexColorSchema, at: z.number().min(0).max(1) }))
        .min(2)
        .max(6),
    }),
  }),
]);
export type Fill = z.infer<typeof fillSchema>;

export const shadowSchema = z.object({
  color: hexColorSchema.default("#00000066"),
  blur: z.number().min(0).max(200).default(40),
  x: z.number().default(0),
  y: z.number().default(16),
});

export const ambientSchema = z.object({
  kind: z.enum(["float", "drift", "pulse", "sway"]),
  amplitude: z.number().min(0).max(80),
  periodMs: z.number().min(500).max(30_000),
});

// ── Layers ──────────────────────────────────────────────────────────────────

const layerBaseShape = {
  id: idSchema,
  name: z.string().max(80).optional(),
  /** Relative to the clip start. Negative = already running when the clip begins. */
  startMs: z.number().default(0),
  /** Defaults to the rest of the clip. */
  durationMs: z.number().positive().optional(),
  transform: transformSchema.prefault({}),
  keyframes: keyframeMapSchema.default({}),
  ambient: ambientSchema.optional(),
  /** Parallax depth for camera moves: 0 = locked to frame, 1 = full camera motion. */
  depth: z.number().min(0).max(2).default(1),
  blendMode: z.enum(["normal", "multiply", "screen", "overlay", "lighten", "difference"]).default("normal"),
  shadow: shadowSchema.optional(),
  hidden: z.boolean().default(false),
  locked: z.boolean().default(false),
  /** Claim ids (from the script) that this layer shows on screen. */
  claimIds: z.array(z.string()).default([]),
};

export const textAnimationSchema = z.object({
  unit: z.enum(["word", "line", "char"]).default("word"),
  preset: z.enum(["fade-rise", "mask-rise", "blur-in", "scale-in", "typewriter", "highlight"]).default("fade-rise"),
  /** Delay from layer start. */
  delayMs: z.number().min(0).default(0),
  staggerMs: z.number().min(0).max(400).default(60),
  durationMs: z.number().min(50).max(3000).default(560),
  easing: easingSchema.default("entrance"),
});
export type TextAnimation = z.infer<typeof textAnimationSchema>;

export const textStyleSchema = z.object({
  font: fontRefSchema.default("display"),
  /** Design px against a 1080px short side. */
  size: z.number().min(8).max(600).default(96),
  weight: z.number().int().min(100).max(900).default(700),
  color: hexColorSchema.optional(),
  /** Colour for *starred* spans. */
  accentColor: hexColorSchema.optional(),
  align: z.enum(["left", "center", "right"]).default("center"),
  /** em */
  tracking: z.number().min(-0.2).max(0.5).default(-0.02),
  leading: z.number().min(0.7).max(2.5).default(1.08),
  uppercase: z.boolean().default(false),
  italic: z.boolean().default(false),
  /** % of frame width before wrapping. */
  maxWidth: z.number().min(5).max(100).default(80),
  /** Optional highlight box behind *starred* spans. */
  highlight: hexColorSchema.optional(),
  background: hexColorSchema.optional(),
  padding: z.number().min(0).max(200).default(0),
  radius: z.number().min(0).max(200).default(0),
});
export type TextStyle = z.infer<typeof textStyleSchema>;

export const textLayerSchema = z.object({
  ...layerBaseShape,
  type: z.literal("text"),
  /** Wrap words in *stars* to accent them. Newlines break lines. */
  text: z.string().min(1).max(600),
  style: textStyleSchema.prefault({}),
  animation: textAnimationSchema.optional(),
});

export const shapeLayerSchema = z.object({
  ...layerBaseShape,
  type: z.literal("shape"),
  shape: z.enum(["rect", "ellipse", "line", "ring", "triangle"]),
  fill: fillSchema.optional(),
  stroke: hexColorSchema.optional(),
  strokeWidth: z.number().min(0).max(200).default(0),
  /** Corner radius, design px. */
  radius: z.number().min(0).max(2000).default(0),
});

export const imageLayerSchema = z.object({
  ...layerBaseShape,
  type: z.literal("image"),
  /** Asset id (`asset:<id>`) or an https URL the asset store resolved. */
  src: z.string().min(1).max(2000),
  fit: z.enum(["cover", "contain"]).default("cover"),
  radius: z.number().min(0).max(2000).default(0),
  alt: z.string().max(200).optional(),
});

export const videoLayerSchema = z.object({
  ...layerBaseShape,
  type: z.literal("video"),
  src: z.string().min(1).max(2000),
  fit: z.enum(["cover", "contain"]).default("cover"),
  radius: z.number().min(0).max(2000).default(0),
  trimStartMs: z.number().min(0).default(0),
  playbackRate: z.number().min(0.1).max(8).default(1),
  volume: z.number().min(0).max(2).default(0),
  loop: z.boolean().default(false),
});

export const codeLayerSchema = z.object({
  ...layerBaseShape,
  type: z.literal("code"),
  code: z.string().min(1).max(4000),
  language: z.string().min(1).max(24).default("ts"),
  title: z.string().max(80).optional(),
  theme: z.enum(["dark", "light"]).default("dark"),
  fontSize: z.number().min(10).max(80).default(30),
  highlightLines: z.array(z.number().int().positive()).default([]),
  /** "lines" staggers lines; "type" types characters with `progress`. */
  reveal: z.enum(["none", "lines", "type"]).default("lines"),
  showLineNumbers: z.boolean().default(true),
  /** Where the excerpt came from, for the claim audit. */
  source: z
    .object({ path: z.string(), lineStart: z.number().int().positive(), lineEnd: z.number().int().positive() })
    .optional(),
});

export const chartLayerSchema = z.object({
  ...layerBaseShape,
  type: z.literal("chart"),
  chart: z.enum(["bar", "line", "donut", "number"]),
  data: z
    .array(z.object({ label: z.string().max(40), value: z.number() }))
    .min(1)
    .max(24),
  prefix: z.string().max(6).default(""),
  suffix: z.string().max(8).default(""),
  decimals: z.number().int().min(0).max(4).default(0),
  colors: z.array(hexColorSchema).max(8).default([]),
  showLabels: z.boolean().default(true),
  /** Design px for labels and numbers. */
  fontSize: z.number().min(10).max(600).default(36),
});

export const iconLayerSchema = z.object({
  ...layerBaseShape,
  type: z.literal("icon"),
  icon: iconNameSchema,
  color: hexColorSchema.optional(),
  strokeWidth: z.number().min(0.5).max(4).default(2),
});

export const cameraLayerSchema = z.object({
  ...layerBaseShape,
  type: z.literal("camera"),
  /** Perspective distance in design px for rotateX/rotateY tilts. */
  perspective: z.number().min(200).max(10_000).default(1600),
});

const leafLayerSchemas = [
  textLayerSchema,
  shapeLayerSchema,
  imageLayerSchema,
  videoLayerSchema,
  codeLayerSchema,
  chartLayerSchema,
  iconLayerSchema,
] as const;

export const leafLayerSchema = z.discriminatedUnion("type", leafLayerSchemas);

export const groupLayerSchema = z.object({
  ...layerBaseShape,
  type: z.literal("group"),
  children: z.array(leafLayerSchema).max(40),
});

export const layerSchema = z.discriminatedUnion("type", [...leafLayerSchemas, groupLayerSchema, cameraLayerSchema]);

export type Layer = z.infer<typeof layerSchema>;
export type LayerInput = z.input<typeof layerSchema>;
export type LeafLayer = z.infer<typeof leafLayerSchema>;
export type TextLayer = z.infer<typeof textLayerSchema>;
export type ShapeLayer = z.infer<typeof shapeLayerSchema>;
export type ImageLayer = z.infer<typeof imageLayerSchema>;
export type VideoLayer = z.infer<typeof videoLayerSchema>;
export type CodeLayer = z.infer<typeof codeLayerSchema>;
export type ChartLayer = z.infer<typeof chartLayerSchema>;
export type IconLayer = z.infer<typeof iconLayerSchema>;
export type GroupLayer = z.infer<typeof groupLayerSchema>;
export type CameraLayer = z.infer<typeof cameraLayerSchema>;
export type LayerType = Layer["type"];

// ── Clips and tracks ────────────────────────────────────────────────────────

export const TRANSITION_TYPES = [
  "cut",
  "crossfade",
  "blur-crossfade",
  "push",
  "slide",
  "zoom-through",
  "wipe",
  "scale-fade",
] as const;
export const transitionTypeSchema = z.enum(TRANSITION_TYPES);
export type TransitionType = (typeof TRANSITION_TYPES)[number];

export const transitionSchema = z.object({
  type: transitionTypeSchema,
  durationMs: z.number().min(0).max(3000).default(500),
  direction: z.enum(["left", "right", "up", "down"]).default("left"),
  easing: easingSchema.default("move"),
});
export type Transition = z.infer<typeof transitionSchema>;

const clipTimingShape = {
  id: idSchema,
  name: z.string().max(80).optional(),
  startMs: z.number().min(0),
  durationMs: z.number().min(1),
};

export const visualClipSchema = z.object({
  ...clipTimingShape,
  background: fillSchema.optional(),
  layers: z.array(layerSchema).max(120).default([]),
  transitionIn: transitionSchema.optional(),
  /** Script beat and narration lines this clip covers. */
  beatId: z.string().optional(),
  lineIds: z.array(z.string()).default([]),
  /** "narration" clips re-time from the voice; trimming unlocks them to "manual". */
  timing: z.enum(["narration", "manual"]).default("manual"),
  /** Which preset recipe seeded this clip, if any (editable afterwards). */
  recipe: z.string().optional(),
});
export type VisualClip = z.infer<typeof visualClipSchema>;

export const envelopePointSchema = z.object({
  atMs: z.number().min(0),
  /** Linear gain, 0..2. */
  value: z.number().min(0).max(2),
});

export type EnvelopePoint = z.infer<typeof envelopePointSchema>;

export const audioClipSchema = z.object({
  ...clipTimingShape,
  src: z.string().min(1).max(2000),
  /** Offset into the source file. */
  trimStartMs: z.number().min(0).default(0),
  volume: z.number().min(0).max(2).default(1),
  fadeInMs: z.number().min(0).max(10_000).default(0),
  fadeOutMs: z.number().min(0).max(10_000).default(0),
  /** Clip-relative gain automation, multiplied with `volume`. */
  envelope: z.array(envelopePointSchema).max(512).default([]),
  /** Music: duck under voice clips automatically. */
  duckUnderVoice: z.boolean().default(false),
  lineId: z.string().optional(),
  /** Transcript for voice clips; label for music and SFX. */
  text: z.string().max(2000).optional(),
  /** Precomputed peaks (0..1) for the timeline waveform. */
  peaks: z.array(z.number().min(0).max(1)).max(4000).default([]),
  /** Voice/music provenance shown in the Proof report. */
  assetId: z.string().optional(),
});
export type AudioClip = z.infer<typeof audioClipSchema>;

export const captionWordSchema = z.object({
  text: z.string().min(1),
  /** Absolute composition time. */
  startMs: z.number().min(0),
  endMs: z.number().min(0),
});
export type CaptionWord = z.infer<typeof captionWordSchema>;

export const captionClipSchema = z.object({
  ...clipTimingShape,
  text: z.string().min(1).max(400),
  words: z.array(captionWordSchema).default([]),
  /** Word indices to highlight. */
  emphasis: z.array(z.number().int().min(0)).default([]),
});
export type CaptionClip = z.infer<typeof captionClipSchema>;

export const captionStyleSchema = z.object({
  preset: z.enum(["karaoke", "clean", "pop", "boxed"]).default("karaoke"),
  position: z.enum(["bottom", "middle", "top"]).default("bottom"),
  font: fontRefSchema.default("body"),
  size: z.number().min(16).max(160).default(54),
  weight: z.number().int().min(100).max(900).default(800),
  color: hexColorSchema.default("#ffffff"),
  highlightColor: hexColorSchema.default("#ffd400"),
  background: hexColorSchema.optional(),
  uppercase: z.boolean().default(false),
});
export type CaptionStyle = z.infer<typeof captionStyleSchema>;

const trackBaseShape = {
  id: idSchema,
  name: z.string().max(60),
  hidden: z.boolean().default(false),
  locked: z.boolean().default(false),
};

export const visualTrackSchema = z.object({
  ...trackBaseShape,
  kind: z.literal("visual"),
  clips: z.array(visualClipSchema).default([]),
});

export const audioTrackSchema = z.object({
  ...trackBaseShape,
  kind: z.literal("audio"),
  role: z.enum(["voice", "music", "sfx"]),
  muted: z.boolean().default(false),
  volume: z.number().min(0).max(2).default(1),
  clips: z.array(audioClipSchema).default([]),
});

export const captionTrackSchema = z.object({
  ...trackBaseShape,
  kind: z.literal("caption"),
  style: captionStyleSchema.prefault({}),
  clips: z.array(captionClipSchema).default([]),
});

export const trackSchema = z.discriminatedUnion("kind", [visualTrackSchema, audioTrackSchema, captionTrackSchema]);
export type VisualTrack = z.infer<typeof visualTrackSchema>;
export type AudioTrack = z.infer<typeof audioTrackSchema>;
export type CaptionTrack = z.infer<typeof captionTrackSchema>;
export type Track = z.infer<typeof trackSchema>;
export type TrackKind = Track["kind"];

// ── Art direction ───────────────────────────────────────────────────────────

export const LAYOUT_GRIDS = [
  "centered",
  "left-rail",
  "split",
  "asymmetric",
  "full-bleed",
  "grid-3",
  "editorial-columns",
  "stacked",
] as const;
export const MOTION_SIGNATURES = [
  "spring-snappy",
  "spring-soft",
  "ease-glide",
  "kinetic",
  "staccato",
  "floaty",
  "cinematic-slow",
] as const;

export const paletteSchema = z.object({
  background: hexColorSchema,
  surface: hexColorSchema,
  ink: hexColorSchema,
  muted: hexColorSchema,
  accent: hexColorSchema,
  accent2: hexColorSchema.optional(),
  positive: hexColorSchema.default("#3ccf7f"),
  negative: hexColorSchema.default("#ff5d5d"),
});
export type Palette = z.infer<typeof paletteSchema>;

export const artDirectionBriefSchema = z.object({
  /** One line: the feeling. "Calm lab notebook", "Neon terminal at 2am". */
  mood: z.string().min(2).max(160),
  palette: paletteSchema,
  typePairing: z.object({ display: fontFamilySchema, body: fontFamilySchema, mono: fontFamilySchema }),
  layoutGrid: z.enum(LAYOUT_GRIDS),
  motionSignature: z.enum(MOTION_SIGNATURES),
  transitionSet: z.array(transitionTypeSchema).min(1).max(4),
  pacing: z.enum(["brisk", "measured", "slow"]).default("measured"),
  /** Free notes the user can edit like the script. */
  notes: z.string().max(1200).default(""),
  /** Set when the brief started from a preset or a reference video. */
  basedOn: z.string().max(80).optional(),
});
export type ArtDirectionBrief = z.infer<typeof artDirectionBriefSchema>;
export type ArtDirectionBriefInput = z.input<typeof artDirectionBriefSchema>;

// ── Composition ─────────────────────────────────────────────────────────────

export const markerSchema = z.object({
  id: idSchema,
  atMs: z.number().min(0),
  label: z.string().max(60).default(""),
  color: hexColorSchema.optional(),
});
export type Marker = z.infer<typeof markerSchema>;

export const compositionSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: idSchema,
  title: z.string().min(1).max(120),
  ratio: aspectRatioSchema.default("16:9"),
  width: z.number().int().min(240).max(4096),
  height: z.number().int().min(240).max(4096),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(50), z.literal(60)]).default(30),
  /** Kept in sync by `normalizeComposition` (max clip end). */
  durationMs: z.number().min(1),
  brief: artDirectionBriefSchema,
  tracks: z.array(trackSchema).min(1).max(24),
  markers: z.array(markerSchema).default([]),
  /** Seeds every pseudo-random choice so renders are deterministic. */
  seed: z.number().int().nonnegative().default(1),
});
export type Composition = z.infer<typeof compositionSchema>;
export type CompositionInput = z.input<typeof compositionSchema>;
