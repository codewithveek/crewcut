import { normalizeKeyframes } from "@proofcut/motion";

import { clipEndMs, computeDurationMs } from "./query";
import { type Composition, type CompositionInput, compositionSchema, type Layer, type LeafLayer } from "./schema";

export interface CompositionIssue {
  path: string;
  message: string;
  severity: "error" | "warning";
}

export class CompositionValidationError extends Error {
  override readonly name = "CompositionValidationError";
  constructor(readonly issues: CompositionIssue[]) {
    super(
      `Composition is invalid:\n${issues
        .slice(0, 12)
        .map((issue) => `- ${issue.path}: ${issue.message}`)
        .join("\n")}`,
    );
  }
}

/** Parses untrusted JSON (from the model, the DB, or an action) into a normalized composition. */
export function parseComposition(input: unknown): Composition {
  const result = compositionSchema.safeParse(input);
  if (!result.success) {
    throw new CompositionValidationError(
      result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
        severity: "error" as const,
      })),
    );
  }
  const composition = normalizeComposition(result.data);
  const errors = validateComposition(composition).filter((issue) => issue.severity === "error");
  if (errors.length > 0) throw new CompositionValidationError(errors);
  return composition;
}

export function safeParseComposition(
  input: unknown,
): { ok: true; composition: Composition; warnings: CompositionIssue[] } | { ok: false; issues: CompositionIssue[] } {
  try {
    const composition = parseComposition(input);
    return { ok: true, composition, warnings: validateComposition(composition) };
  } catch (error) {
    if (error instanceof CompositionValidationError) return { ok: false, issues: error.issues };
    throw error;
  }
}

export function toCompositionInput(composition: Composition): CompositionInput {
  return composition;
}

/** Sorts clips and keyframes, rounds times to 0.1 ms and recomputes the duration. */
export function normalizeComposition(composition: Composition): Composition {
  const next = structuredClone(composition);
  for (const track of next.tracks) {
    track.clips.sort((a, b) => a.startMs - b.startMs);
    for (const clip of track.clips) {
      clip.startMs = round(clip.startMs);
      clip.durationMs = round(clip.durationMs);
      if (track.kind === "visual" && "layers" in clip) {
        for (const layer of clip.layers) {
          normalizeLayerKeyframes(layer);
          if (layer.type === "group") for (const child of layer.children) normalizeLayerKeyframes(child);
        }
      }
    }
  }
  next.markers.sort((a, b) => a.atMs - b.atMs);
  next.durationMs = computeDurationMs(next);
  return next;
}

function normalizeLayerKeyframes(layer: Layer | LeafLayer): void {
  for (const [property, keyframes] of Object.entries(layer.keyframes)) {
    if (!keyframes) continue;
    const normalized = normalizeKeyframes(keyframes.map((keyframe) => ({ ...keyframe, atMs: round(keyframe.atMs) })));
    (layer.keyframes as Record<string, typeof normalized>)[property] = normalized;
  }
}

/** Semantic checks Zod can't express: overlaps, unique ids, sane layer windows. */
export function validateComposition(composition: Composition): CompositionIssue[] {
  const issues: CompositionIssue[] = [];
  const seen = new Map<string, string>();
  const claim = (id: string, path: string) => {
    const previous = seen.get(id);
    if (previous) issues.push({ path, message: `Duplicate id "${id}" (also at ${previous})`, severity: "error" });
    else seen.set(id, path);
  };

  composition.tracks.forEach((track, trackIndex) => {
    const trackPath = `tracks.${trackIndex}`;
    claim(track.id, trackPath);
    const sorted = [...track.clips].sort((a, b) => a.startMs - b.startMs);
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      if (previous && current && current.startMs < clipEndMs(previous) - 0.5) {
        issues.push({
          path: trackPath,
          message: `Clips "${previous.id}" and "${current.id}" overlap on track "${track.name}"`,
          severity: "error",
        });
      }
    }
    track.clips.forEach((clip, clipIndex) => {
      const clipPath = `${trackPath}.clips.${clipIndex}`;
      claim(clip.id, clipPath);
      if (track.kind !== "visual" || !("layers" in clip)) return;
      if (clip.transitionIn && clip.transitionIn.durationMs > clip.durationMs) {
        issues.push({ path: clipPath, message: "Transition is longer than the clip", severity: "warning" });
      }
      clip.layers.forEach((layer, layerIndex) => {
        const layerPath = `${clipPath}.layers.${layerIndex}`;
        claim(layer.id, layerPath);
        if (layer.startMs >= clip.durationMs) {
          issues.push({ path: layerPath, message: `Layer "${layer.id}" starts after its clip ends`, severity: "warning" });
        }
        if (layer.type === "group") {
          layer.children.forEach((child, childIndex) => claim(child.id, `${layerPath}.children.${childIndex}`));
        }
      });
      const cameras = clip.layers.filter((layer) => layer.type === "camera");
      if (cameras.length > 1) {
        issues.push({ path: clipPath, message: "A clip can have at most one camera layer", severity: "error" });
      }
    });
  });
  composition.markers.forEach((marker, index) => claim(marker.id, `markers.${index}`));
  if (!composition.tracks.some((track) => track.kind === "visual")) {
    issues.push({ path: "tracks", message: "A composition needs at least one visual track", severity: "error" });
  }
  return issues;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
