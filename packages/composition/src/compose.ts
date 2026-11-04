import { createSeededRandom } from "@proofcut/motion";

import { type RecipeContext, type SceneSpec, expandRecipe } from "./recipes";
import {
  type ArtDirectionBrief,
  type CaptionStyle,
  type Composition,
  type Fill,
  type LayerInput,
  type Transition,
  type TransitionType,
  compositionSchema,
} from "./schema";
import { type AspectRatio, FRAME_SIZE } from "./units";
import { parseComposition } from "./validate";

export const TRACK_IDS = {
  scenes: "track-scenes",
  overlays: "track-overlays",
  captions: "track-captions",
  voice: "track-voice",
  music: "track-music",
  sfx: "track-sfx",
} as const;

export interface ComposeSceneInput {
  id?: string;
  name?: string;
  durationMs: number;
  beatId?: string;
  lineIds?: string[];
  claimIds?: string[];
  transition?: Partial<Transition> | null;
  timing?: "narration" | "manual";
  /** Start from a recipe… */
  recipe?: SceneSpec;
  /** …and/or compose freeform layers (drawn above the recipe's layers). */
  layers?: LayerInput[];
  background?: Fill;
}

export interface ComposeVoiceClip {
  lineId: string;
  startMs: number;
  durationMs: number;
  src: string;
  text: string;
  peaks?: number[];
  assetId?: string;
}

export interface ComposeCaption {
  startMs: number;
  durationMs: number;
  text: string;
  words: Array<{ text: string; startMs: number; endMs: number }>;
  emphasis?: number[];
}

export interface ComposeVideoInput {
  id: string;
  title: string;
  ratio: AspectRatio;
  fps?: 24 | 25 | 30 | 50 | 60;
  seed: number;
  brief: ArtDirectionBrief;
  scenes: ComposeSceneInput[];
  voice?: ComposeVoiceClip[];
  captions?: ComposeCaption[];
  captionStyle?: Partial<CaptionStyle>;
  music?: { src: string; label: string; volume?: number; assetId?: string };
}

const CAMERA_SIGNATURES = new Set(["cinematic-slow", "floaty"]);

/**
 * Frame 0 is the thumbnail and the first impression: never start on an empty
 * frame (vid-skills' audit). The first scene's recipe layers start this far
 * before the clip, so they are already mid-entrance at frame 0.
 */
export const FIRST_FRAME_LEAD_MS = 450;

function pickTransition(brief: ArtDirectionBrief, index: number, seed: number): Transition {
  const random = createSeededRandom(seed * 97 + index);
  const type = brief.transitionSet[Math.floor(random() * brief.transitionSet.length)] ?? "crossfade";
  const durations: Record<TransitionType, number> = {
    cut: 0,
    crossfade: 400,
    "blur-crossfade": 500,
    push: 560,
    slide: 560,
    "zoom-through": 600,
    wipe: 520,
    "scale-fade": 480,
  };
  const directions = ["left", "up", "right", "down"] as const;
  return {
    type,
    durationMs: brief.pacing === "slow" ? Math.round(durations[type] * 1.3) : durations[type],
    direction: directions[index % directions.length] ?? "left",
    easing: type === "slide" ? "spring-smooth" : "move",
  };
}

function isLightColor(hex: string): boolean {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  return 0.299 * ((value >> 16) & 255) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255) >= 150;
}

/** Captions stay readable on any palette: light backgrounds get a dark box. */
export function defaultCaptionStyle(brief: ArtDirectionBrief): Partial<CaptionStyle> {
  return isLightColor(brief.palette.background)
    ? { preset: "boxed", background: "#0b0b0cd9", color: "#ffffff", highlightColor: isLightColor(brief.palette.accent) ? brief.palette.accent : "#ffd400" }
    : { preset: "karaoke", highlightColor: "#ffd400" };
}

/** Builds a complete composition: scenes, overlays, captions, voice, music and SFX tracks. */
export function composeVideo(input: ComposeVideoInput): Composition {
  const { width, height } = FRAME_SIZE[input.ratio];
  let cursor = 0;
  const sceneClips = input.scenes.map((scene, index) => {
    const id = scene.id ?? `scene-${index + 1}`;
    const context: RecipeContext = {
      brief: input.brief,
      ratio: input.ratio,
      seed: input.seed,
      index,
      durationMs: scene.durationMs,
      claimIds: scene.claimIds ?? [],
      idPrefix: id,
    };
    const recipe = scene.recipe ? expandRecipe(scene.recipe, context) : undefined;
    const recipeLayers = (recipe?.layers ?? []).map((layer) => (index === 0 ? { ...layer, startMs: (layer.startMs ?? 0) - FIRST_FRAME_LEAD_MS } : layer));
    const layers: LayerInput[] = [...recipeLayers, ...(scene.layers ?? [])];
    if (CAMERA_SIGNATURES.has(input.brief.motionSignature) && !layers.some((layer) => layer.type === "camera")) {
      layers.push({
        id: `${id}-camera`,
        type: "camera",
        name: "Camera",
        keyframes: { scale: [{ atMs: 0, value: 1, easing: "hold" }, { atMs: scene.durationMs, value: 1.05, easing: "linear" }] },
      });
    }
    const transition =
      index === 0 ? undefined : scene.transition === null ? undefined : { ...pickTransition(input.brief, index, input.seed), ...scene.transition };
    const clip = {
      id,
      name: scene.name ?? scene.recipe?.kind ?? `Scene ${index + 1}`,
      startMs: cursor,
      durationMs: scene.durationMs,
      layers,
      lineIds: scene.lineIds ?? [],
      timing: scene.timing ?? "narration",
      ...(scene.beatId ? { beatId: scene.beatId } : {}),
      ...(scene.recipe ? { recipe: scene.recipe.kind } : {}),
      ...(transition ? { transitionIn: transition } : {}),
      ...((scene.background ?? recipe?.background) ? { background: scene.background ?? recipe?.background } : {}),
    };
    cursor += scene.durationMs;
    return clip;
  });

  const draft = compositionSchema.parse({
    schemaVersion: 1,
    id: input.id,
    title: input.title,
    ratio: input.ratio,
    width,
    height,
    fps: input.fps ?? 30,
    durationMs: Math.max(1, cursor),
    brief: input.brief,
    seed: input.seed,
    markers: [],
    tracks: [
      { id: TRACK_IDS.scenes, name: "Scenes", kind: "visual", clips: sceneClips },
      { id: TRACK_IDS.overlays, name: "Overlays", kind: "visual", clips: [] },
      {
        id: TRACK_IDS.captions,
        name: "Captions",
        kind: "caption",
        style: { font: "body", ...defaultCaptionStyle(input.brief), ...(input.captionStyle ?? {}) },
        clips: (input.captions ?? []).map((caption, index) => ({ id: `caption-${index + 1}`, ...caption })),
      },
      {
        id: TRACK_IDS.voice,
        name: "Voice",
        kind: "audio",
        role: "voice",
        clips: (input.voice ?? []).map((voice) => ({
          id: `voice-${voice.lineId}`,
          startMs: voice.startMs,
          durationMs: voice.durationMs,
          src: voice.src,
          text: voice.text,
          lineId: voice.lineId,
          peaks: voice.peaks ?? [],
          ...(voice.assetId ? { assetId: voice.assetId } : {}),
        })),
      },
      {
        id: TRACK_IDS.music,
        name: "Music",
        kind: "audio",
        role: "music",
        clips: input.music
          ? [
              {
                id: "music-bed",
                startMs: 0,
                durationMs: Math.max(1, cursor),
                src: input.music.src,
                text: input.music.label,
                volume: input.music.volume ?? 0.5,
                fadeInMs: 800,
                fadeOutMs: 1500,
                duckUnderVoice: true,
                ...(input.music.assetId ? { assetId: input.music.assetId } : {}),
              },
            ]
          : [],
      },
      { id: TRACK_IDS.sfx, name: "SFX", kind: "audio", role: "sfx", clips: [] },
    ],
  });
  return parseComposition(draft);
}

/** An empty composition with the standard track layout. */
export function createEmptyComposition(input: { id: string; title: string; ratio: AspectRatio; brief: ArtDirectionBrief; seed?: number }): Composition {
  return composeVideo({ ...input, seed: input.seed ?? 1, scenes: [{ durationMs: 3000, layers: [] }] });
}
