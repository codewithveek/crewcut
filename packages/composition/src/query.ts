import type {
  AudioTrack,
  CaptionTrack,
  Composition,
  Layer,
  LeafLayer,
  Track,
  VisualClip,
  VisualTrack,
} from "./schema";

export class CompositionEditError extends Error {
  override readonly name = "CompositionEditError";
  constructor(
    readonly code:
      | "clip_not_found"
      | "layer_not_found"
      | "track_not_found"
      | "overlap"
      | "out_of_range"
      | "locked"
      | "invalid",
    message: string,
  ) {
    super(message);
  }
}

export type AnyClip = Track["clips"][number];

export interface ClipLocation<T extends Track = Track> {
  track: T;
  trackIndex: number;
  clip: T["clips"][number];
  clipIndex: number;
}

export function isVisualTrack(track: Track): track is VisualTrack {
  return track.kind === "visual";
}
export function isAudioTrack(track: Track): track is AudioTrack {
  return track.kind === "audio";
}
export function isCaptionTrack(track: Track): track is CaptionTrack {
  return track.kind === "caption";
}

export function visualTracks(composition: Composition): VisualTrack[] {
  return composition.tracks.filter(isVisualTrack);
}

export function clipEndMs(clip: { startMs: number; durationMs: number }): number {
  return clip.startMs + clip.durationMs;
}

/** How far a clip's edge can be trimmed without running into its neighbours on the track. */
export function trimBounds(clips: ReadonlyArray<{ id: string; startMs: number; durationMs: number }>, clipId: string): { minStartMs: number; maxEndMs: number } {
  const clip = clips.find((candidate) => candidate.id === clipId);
  if (!clip) return { minStartMs: 0, maxEndMs: Number.POSITIVE_INFINITY };
  let minStartMs = 0;
  let maxEndMs = Number.POSITIVE_INFINITY;
  for (const other of clips) {
    if (other.id === clipId) continue;
    const end = clipEndMs(other);
    if (end <= clip.startMs + 0.5) minStartMs = Math.max(minStartMs, end);
    if (other.startMs >= clipEndMs(clip) - 0.5) maxEndMs = Math.min(maxEndMs, other.startMs);
  }
  return { minStartMs, maxEndMs };
}

export function computeDurationMs(composition: Composition): number {
  let end = 0;
  for (const track of composition.tracks) {
    for (const clip of track.clips) end = Math.max(end, clipEndMs(clip));
  }
  return Math.max(1, Math.round(end));
}

export function findTrack(composition: Composition, trackId: string): { track: Track; trackIndex: number } | null {
  const trackIndex = composition.tracks.findIndex((track) => track.id === trackId);
  const track = composition.tracks[trackIndex];
  return track ? { track, trackIndex } : null;
}

export function findClip(composition: Composition, clipId: string): ClipLocation | null {
  for (let trackIndex = 0; trackIndex < composition.tracks.length; trackIndex += 1) {
    const track = composition.tracks[trackIndex];
    if (!track) continue;
    const clipIndex = track.clips.findIndex((clip) => clip.id === clipId);
    const clip = track.clips[clipIndex];
    if (clip) return { track, trackIndex, clip, clipIndex };
  }
  return null;
}

export function requireClip(composition: Composition, clipId: string): ClipLocation {
  const location = findClip(composition, clipId);
  if (!location) throw new CompositionEditError("clip_not_found", `No clip "${clipId}"`);
  return location;
}

export function requireVisualClip(composition: Composition, clipId: string): ClipLocation<VisualTrack> & { clip: VisualClip } {
  const location = requireClip(composition, clipId);
  if (location.track.kind !== "visual") {
    throw new CompositionEditError("invalid", `Clip "${clipId}" is on a ${location.track.kind} track, not a visual track`);
  }
  return location as ClipLocation<VisualTrack> & { clip: VisualClip };
}

export interface LayerLocation {
  clip: VisualClip;
  layer: Layer | LeafLayer;
  /** Set when the layer is a child of a group. */
  parent?: Layer;
}

export function findLayer(clip: VisualClip, layerId: string): LayerLocation | null {
  for (const layer of clip.layers) {
    if (layer.id === layerId) return { clip, layer };
    if (layer.type === "group") {
      const child = layer.children.find((candidate) => candidate.id === layerId);
      if (child) return { clip, layer: child, parent: layer };
    }
  }
  return null;
}

export function* iterateLayers(composition: Composition): Generator<LayerLocation & { track: VisualTrack }> {
  for (const track of visualTracks(composition)) {
    for (const clip of track.clips) {
      for (const layer of clip.layers) {
        yield { track, clip, layer };
        if (layer.type === "group") {
          for (const child of layer.children) yield { track, clip, layer: child, parent: layer };
        }
      }
    }
  }
}

/** Absolute window of a layer on the composition timeline. */
export function layerWindow(clip: VisualClip, layer: { startMs: number; durationMs?: number | undefined }): {
  startMs: number;
  endMs: number;
} {
  const startMs = clip.startMs + Math.max(0, layer.startMs);
  const naturalEnd = layer.durationMs === undefined ? clipEndMs(clip) : clip.startMs + layer.startMs + layer.durationMs;
  return { startMs, endMs: Math.min(clipEndMs(clip), naturalEnd) };
}

export function clipsAtTime(composition: Composition, timeMs: number): Array<ClipLocation> {
  const hits: ClipLocation[] = [];
  composition.tracks.forEach((track, trackIndex) => {
    track.clips.forEach((clip, clipIndex) => {
      if (timeMs >= clip.startMs && timeMs < clipEndMs(clip)) hits.push({ track, trackIndex, clip, clipIndex });
    });
  });
  return hits;
}

/** Every id used in the composition (tracks, clips, layers, markers). */
export function collectIds(composition: Composition): Set<string> {
  const ids = new Set<string>();
  for (const track of composition.tracks) {
    ids.add(track.id);
    for (const clip of track.clips) {
      ids.add(clip.id);
      if ("layers" in clip) {
        for (const layer of clip.layers) {
          ids.add(layer.id);
          if (layer.type === "group") for (const child of layer.children) ids.add(child.id);
        }
      }
    }
  }
  for (const marker of composition.markers) ids.add(marker.id);
  return ids;
}

/** Deterministic unique id: `${prefix}-${n}` not already used. */
export function uniqueId(used: Set<string>, prefix: string): string {
  const base = prefix.replace(/[^A-Za-z0-9_.:-]/g, "-").slice(0, 60) || "id";
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  for (let index = 2; ; index += 1) {
    const candidate = `${base}-${index}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}
