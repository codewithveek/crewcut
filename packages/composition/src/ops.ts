import { upsertKeyframe } from "@crewcut/motion";

import {
  type AnyClip,
  CompositionEditError,
  clipEndMs,
  collectIds,
  findLayer,
  findTrack,
  requireClip,
  requireVisualClip,
  uniqueId,
} from "./query";
import {
  type AnimatableProperty,
  type ArtDirectionBriefInput,
  type AudioClip,
  type AudioTrack,
  type CaptionClip,
  type CaptionStyle,
  type Composition,
  type EasingSpec,
  type EnvelopePoint,
  type Layer,
  type LayerDraft,
  type LayerInput,
  type LeafLayer,
  type Track,
  type Transition,
  type VisualClip,
  artDirectionBriefSchema,
  audioClipSchema,
  audioTrackSchema,
  captionClipSchema,
  captionStyleSchema,
  captionTrackSchema,
  visualTrackSchema,
  layerSchema,
  leafLayerSchema,
  transitionSchema,
  visualClipSchema,
} from "./schema";
import { type AspectRatio, FRAME_SIZE, designScale } from "./units";
import { normalizeComposition } from "./validate";

/** Smallest clip a trim or split may leave behind. */
export const MIN_CLIP_MS = 40;

function edit(composition: Composition, mutate: (draft: Composition) => void): Composition {
  const draft = structuredClone(composition);
  mutate(draft);
  return normalizeComposition(draft);
}

function assertTrackEditable(track: Track): void {
  if (track.locked) throw new CompositionEditError("locked", `Track "${track.name}" is locked`);
}

function assertFree(track: Track, startMs: number, durationMs: number, ignoreIds: ReadonlySet<string>): void {
  const endMs = startMs + durationMs;
  for (const other of track.clips) {
    if (ignoreIds.has(other.id)) continue;
    if (startMs < clipEndMs(other) - 0.5 && endMs > other.startMs + 0.5) {
      throw new CompositionEditError(
        "overlap",
        `That would overlap "${other.name ?? other.id}" on ${track.name} (${Math.round(other.startMs)}–${Math.round(clipEndMs(other))} ms)`,
      );
    }
  }
}

// ── Clips ───────────────────────────────────────────────────────────────────

export type ClipInput = Record<string, unknown> & { id?: string; startMs: number; durationMs: number };

export function parseClipForTrack(track: Track, clip: ClipInput): AnyClip {
  if (track.kind === "visual") return visualClipSchema.parse(clip);
  if (track.kind === "audio") return audioClipSchema.parse(clip);
  return captionClipSchema.parse(clip);
}

export function addClip(
  composition: Composition,
  input: { trackId: string; clip: ClipInput; ripple?: boolean },
): { composition: Composition; clipId: string } {
  let clipId = "";
  const next = edit(composition, (draft) => {
    const found = findTrack(draft, input.trackId);
    if (!found) throw new CompositionEditError("track_not_found", `No track "${input.trackId}"`);
    assertTrackEditable(found.track);
    const used = collectIds(draft);
    clipId = input.clip.id && !used.has(input.clip.id) ? input.clip.id : uniqueId(used, input.clip.id ?? "clip");
    const clip = parseClipForTrack(found.track, { ...input.clip, id: clipId });
    if (input.ripple) {
      for (const other of found.track.clips) if (other.startMs >= clip.startMs) other.startMs += clip.durationMs;
    } else {
      assertFree(found.track, clip.startMs, clip.durationMs, new Set());
    }
    (found.track.clips as AnyClip[]).push(clip);
  });
  return { composition: next, clipId };
}

export function moveClip(
  composition: Composition,
  input: { clipId: string; startMs: number; trackId?: string },
): Composition {
  return edit(composition, (draft) => {
    const location = requireClip(draft, input.clipId);
    assertTrackEditable(location.track);
    const startMs = Math.max(0, input.startMs);
    let target = location.track;
    if (input.trackId && input.trackId !== location.track.id) {
      const found = findTrack(draft, input.trackId);
      if (!found) throw new CompositionEditError("track_not_found", `No track "${input.trackId}"`);
      if (found.track.kind !== location.track.kind) {
        throw new CompositionEditError("invalid", `A ${location.track.kind} clip can't move to a ${found.track.kind} track`);
      }
      assertTrackEditable(found.track);
      target = found.track;
    }
    assertFree(target, startMs, location.clip.durationMs, new Set([location.clip.id]));
    const delta = startMs - location.clip.startMs;
    location.clip.startMs = startMs;
    if ("words" in location.clip) {
      for (const word of location.clip.words) {
        word.startMs += delta;
        word.endMs += delta;
      }
    }
    if (target !== location.track) {
      (location.track.clips as AnyClip[]).splice(location.clipIndex, 1);
      (target.clips as AnyClip[]).push(location.clip);
    }
  });
}

/**
 * Trims a clip edge to `toMs` (absolute). With `ripple`, later clips on the
 * same track shift to keep the gap closed. Narration-timed clips unlock.
 */
export function trimClip(
  composition: Composition,
  input: { clipId: string; edge: "start" | "end"; toMs: number; ripple?: boolean },
): Composition {
  return edit(composition, (draft) => {
    const location = requireClip(draft, input.clipId);
    assertTrackEditable(location.track);
    const { clip, track } = location;
    const oldEnd = clipEndMs(clip);
    if (input.edge === "end") {
      const newEnd = Math.max(clip.startMs + MIN_CLIP_MS, input.toMs);
      const delta = newEnd - oldEnd;
      if (input.ripple) {
        for (const other of track.clips) if (other.id !== clip.id && other.startMs >= oldEnd - 0.5) other.startMs += delta;
      } else if (delta > 0) {
        assertFree(track, clip.startMs, newEnd - clip.startMs, new Set([clip.id]));
      }
      clip.durationMs = newEnd - clip.startMs;
    } else {
      const newStart = Math.min(oldEnd - MIN_CLIP_MS, Math.max(0, input.toMs));
      const delta = newStart - clip.startMs;
      if (delta < 0 && !input.ripple) assertFree(track, newStart, oldEnd - newStart, new Set([clip.id]));
      shiftClipContent(clip, delta);
      clip.durationMs = oldEnd - newStart;
      if (input.ripple) {
        // The clip keeps its position; it and everything after it close the gap.
        for (const other of track.clips) if (other.id !== clip.id && other.startMs >= oldEnd - 0.5) other.startMs -= delta;
      } else {
        clip.startMs = newStart;
      }
    }
    if ("timing" in clip) clip.timing = "manual";
  });
}

/** Moves a clip's internal content so the frame at absolute time t stays the same after its start moves by delta. */
function shiftClipContent(clip: AnyClip, deltaMs: number): void {
  if ("layers" in clip) {
    for (const layer of clip.layers) layer.startMs -= deltaMs;
  } else if ("src" in clip) {
    clip.trimStartMs = Math.max(0, clip.trimStartMs + deltaMs);
    clip.envelope = clip.envelope
      .map((point) => ({ ...point, atMs: point.atMs - deltaMs }))
      .filter((point) => point.atMs >= 0);
  } else if ("words" in clip) {
    const cutoff = clip.startMs + deltaMs;
    clip.words = clip.words.filter((word) => word.endMs > cutoff);
  }
}

export function splitClip(
  composition: Composition,
  input: { clipId: string; atMs: number },
): { composition: Composition; leftId: string; rightId: string } {
  let rightId = "";
  const next = edit(composition, (draft) => {
    const location = requireClip(draft, input.clipId);
    assertTrackEditable(location.track);
    const { clip } = location;
    const offset = input.atMs - clip.startMs;
    if (offset < MIN_CLIP_MS || clipEndMs(clip) - input.atMs < MIN_CLIP_MS) {
      throw new CompositionEditError("out_of_range", "Split point must be inside the clip (at least 40 ms from each edge)");
    }
    const used = collectIds(draft);
    const right = structuredClone(clip) as AnyClip;
    rightId = uniqueId(used, `${clip.id}-b`);
    right.id = rightId;
    right.startMs = input.atMs;
    right.durationMs = clipEndMs(clip) - input.atMs;
    clip.durationMs = offset;
    if ("layers" in right && "layers" in clip) {
      right.transitionIn = undefined;
      right.layers = right.layers.map((layer) => renameLayerIds(layer, used, offset));
      clip.timing = "manual";
      right.timing = "manual";
    } else if ("src" in right && "src" in clip) {
      right.trimStartMs = clip.trimStartMs + offset;
      right.envelope = right.envelope.filter((p) => p.atMs >= offset).map((p) => ({ ...p, atMs: p.atMs - offset }));
      clip.envelope = clip.envelope.filter((p) => p.atMs <= offset);
      right.fadeInMs = 0;
      clip.fadeOutMs = 0;
    } else if ("words" in right && "words" in clip) {
      clip.words = clip.words.filter((word) => word.startMs < input.atMs);
      right.words = right.words.filter((word) => word.startMs >= input.atMs);
      clip.text = clip.words.map((word) => word.text).join(" ") || clip.text;
      right.text = right.words.map((word) => word.text).join(" ") || right.text;
    }
    (location.track.clips as AnyClip[]).push(right);
  });
  return { composition: next, leftId: input.clipId, rightId };
}

function renameLayerIds(layer: Layer, used: Set<string>, offsetMs: number): Layer {
  const renamed = { ...layer, id: uniqueId(used, `${layer.id}-b`), startMs: layer.startMs - offsetMs };
  if (renamed.type === "group") {
    renamed.children = renamed.children.map((child) => ({ ...child, id: uniqueId(used, `${child.id}-b`) }));
  }
  return renamed as Layer;
}

export function deleteClips(composition: Composition, input: { clipIds: string[]; ripple?: boolean }): Composition {
  return edit(composition, (draft) => {
    const targets = new Set(input.clipIds);
    for (const clipId of input.clipIds) requireClip(draft, clipId);
    for (const track of draft.tracks) {
      const removed = track.clips.filter((clip) => targets.has(clip.id));
      if (removed.length === 0) continue;
      assertTrackEditable(track);
      (track as { clips: AnyClip[] }).clips = track.clips.filter((clip) => !targets.has(clip.id));
      if (!input.ripple) continue;
      // Close each gap: later clips move left by the removed durations before them.
      for (const clip of track.clips) {
        const shift = removed.filter((gone) => clipEndMs(gone) <= clip.startMs + 0.5).reduce((sum, gone) => sum + gone.durationMs, 0);
        clip.startMs = Math.max(0, clip.startMs - shift);
      }
    }
  });
}

export type ClipPatch = Partial<Pick<VisualClip, "name" | "background" | "beatId" | "lineIds" | "timing" | "adjust" | "filter">> &
  Partial<Pick<AudioClip, "volume" | "fadeInMs" | "fadeOutMs" | "duckUnderVoice" | "text" | "playbackRate">> &
  Partial<Pick<CaptionClip, "text" | "emphasis">> &
  Record<string, unknown>;

/** Merges a patch into a clip and re-validates it; `null` values remove optional fields (e.g. filter: null). */
export function updateClip(composition: Composition, input: { clipId: string; patch: ClipPatch }): Composition {
  return edit(composition, (draft) => {
    const location = requireClip(draft, input.clipId);
    assertTrackEditable(location.track);
    const merged: Record<string, unknown> = { ...location.clip, ...input.patch };
    for (const [key, value] of Object.entries(input.patch)) if (value === null) delete merged[key];
    (location.track.clips as AnyClip[])[location.clipIndex] = parseClipForTrack(location.track, merged as ClipInput);
  });
}

export function setTransition(composition: Composition, input: { clipId: string; transition: Partial<Transition> | null }): Composition {
  return edit(composition, (draft) => {
    const { clip } = requireVisualClip(draft, input.clipId);
    clip.transitionIn = input.transition ? transitionSchema.parse({ ...clip.transitionIn, ...input.transition }) : undefined;
  });
}

// ── Layers ──────────────────────────────────────────────────────────────────

export function addLayer(
  composition: Composition,
  input: { clipId: string; layer: LayerInput; index?: number },
): { composition: Composition; layerId: string } {
  let layerId = "";
  const next = edit(composition, (draft) => {
    const { clip, track } = requireVisualClip(draft, input.clipId);
    assertTrackEditable(track);
    const used = collectIds(draft);
    layerId = input.layer.id && !used.has(input.layer.id) ? input.layer.id : uniqueId(used, input.layer.id ?? input.layer.type);
    const layer = layerSchema.parse({ ...input.layer, id: layerId });
    const index = input.index ?? clip.layers.length;
    clip.layers.splice(Math.max(0, Math.min(index, clip.layers.length)), 0, layer);
  });
  return { composition: next, layerId };
}

export function removeLayers(composition: Composition, input: { clipId: string; layerIds: string[] }): Composition {
  return edit(composition, (draft) => {
    const { clip, track } = requireVisualClip(draft, input.clipId);
    assertTrackEditable(track);
    const targets = new Set(input.layerIds);
    clip.layers = clip.layers
      .filter((layer) => !targets.has(layer.id))
      .map((layer) => (layer.type === "group" ? { ...layer, children: layer.children.filter((child) => !targets.has(child.id)) } : layer));
  });
}

export function reorderLayer(composition: Composition, input: { clipId: string; layerId: string; toIndex: number }): Composition {
  return edit(composition, (draft) => {
    const { clip } = requireVisualClip(draft, input.clipId);
    const from = clip.layers.findIndex((layer) => layer.id === input.layerId);
    if (from < 0) throw new CompositionEditError("layer_not_found", `No layer "${input.layerId}"`);
    const [layer] = clip.layers.splice(from, 1);
    if (layer) clip.layers.splice(Math.max(0, Math.min(input.toIndex, clip.layers.length)), 0, layer);
  });
}

export type LayerPatch = Record<string, unknown> & {
  transform?: Record<string, unknown>;
  style?: Record<string, unknown>;
};

/** Shallow-merges a patch into a layer (nested `transform`/`style`/`animation` merge too) and re-validates it. */
export function updateLayer(composition: Composition, input: { clipId: string; layerId: string; patch: LayerPatch }): Composition {
  return edit(composition, (draft) => {
    const { clip, track } = requireVisualClip(draft, input.clipId);
    assertTrackEditable(track);
    replaceLayer(clip, input.layerId, (layer) => mergeLayer(layer, input.patch));
  });
}

function mergeLayer<L extends Layer | LeafLayer>(layer: L, patch: LayerPatch): L {
  const merged: Record<string, unknown> = { ...layer, ...patch, id: layer.id, type: layer.type };
  for (const nested of ["transform", "style", "animation", "keyframes", "adjust"] as const) {
    const base = (layer as Record<string, unknown>)[nested];
    const extra = patch[nested];
    if (base && typeof base === "object" && extra && typeof extra === "object") merged[nested] = { ...base, ...extra };
  }
  // null removes an optional field (filter: null, animation: null, shadow: null…).
  for (const [key, value] of Object.entries(patch)) if (value === null) delete merged[key];
  return (layer.type === "group" || layer.type === "camera" ? layerSchema : leafLayerSchema).parse(merged) as L;
}

function replaceLayer(clip: VisualClip, layerId: string, replace: (layer: Layer | LeafLayer) => Layer | LeafLayer): void {
  const location = findLayer(clip, layerId);
  if (!location) throw new CompositionEditError("layer_not_found", `No layer "${layerId}" in clip "${clip.id}"`);
  if (location.parent && location.parent.type === "group") {
    const parent = location.parent;
    parent.children = parent.children.map((child) => (child.id === layerId ? (replace(child) as LeafLayer) : child));
    return;
  }
  clip.layers = clip.layers.map((layer) => (layer.id === layerId ? (replace(layer) as Layer) : layer));
}

export function setKeyframe(
  composition: Composition,
  input: { clipId: string; layerId: string; property: AnimatableProperty; atMs: number; value: number; easing?: EasingSpec },
): Composition {
  return edit(composition, (draft) => {
    const { clip, track } = requireVisualClip(draft, input.clipId);
    assertTrackEditable(track);
    replaceLayer(clip, input.layerId, (layer) => {
      const existing = layer.keyframes[input.property] ?? [];
      const easing = input.easing ?? existing.find((k) => Math.abs(k.atMs - input.atMs) < 0.5)?.easing ?? "move";
      return {
        ...layer,
        keyframes: { ...layer.keyframes, [input.property]: upsertKeyframe(existing, { atMs: input.atMs, value: input.value, easing }) },
      };
    });
  });
}

export function removeKeyframe(
  composition: Composition,
  input: { clipId: string; layerId: string; property: AnimatableProperty; atMs: number },
): Composition {
  return edit(composition, (draft) => {
    const { clip } = requireVisualClip(draft, input.clipId);
    replaceLayer(clip, input.layerId, (layer) => {
      const remaining = (layer.keyframes[input.property] ?? []).filter((k) => Math.abs(k.atMs - input.atMs) > 0.5);
      const keyframes = { ...layer.keyframes };
      if (remaining.length > 0) keyframes[input.property] = remaining;
      else delete keyframes[input.property];
      return { ...layer, keyframes };
    });
  });
}

/** Moves every keyframe at `fromMs` (any property) to `toMs` — dragging a keyframe diamond. */
export function moveKeyframes(
  composition: Composition,
  input: { clipId: string; layerId: string; fromMs: number; toMs: number; property?: AnimatableProperty },
): Composition {
  return edit(composition, (draft) => {
    const { clip } = requireVisualClip(draft, input.clipId);
    replaceLayer(clip, input.layerId, (layer) => {
      const keyframes = { ...layer.keyframes };
      for (const [property, list] of Object.entries(keyframes)) {
        if (!list || (input.property && property !== input.property)) continue;
        keyframes[property as AnimatableProperty] = list
          .map((k) => (Math.abs(k.atMs - input.fromMs) < 0.5 ? { ...k, atMs: input.toMs } : k))
          .sort((a, b) => a.atMs - b.atMs);
      }
      return { ...layer, keyframes };
    });
  });
}

export interface LayerTarget {
  clipId: string;
  layerId: string;
}

/** Nudges by design px (1 px or 10 px with Shift in the editor). */
export function nudgeLayers(composition: Composition, input: { targets: LayerTarget[]; dxPx: number; dyPx: number }): Composition {
  const scale = designScale(composition.width, composition.height);
  const dxPercent = ((input.dxPx * scale) / composition.width) * 100;
  const dyPercent = ((input.dyPx * scale) / composition.height) * 100;
  return edit(composition, (draft) => {
    for (const target of input.targets) {
      const { clip } = requireVisualClip(draft, target.clipId);
      replaceLayer(clip, target.layerId, (layer) => ({
        ...layer,
        transform: { ...layer.transform, x: layer.transform.x + dxPercent, y: layer.transform.y + dyPercent },
        keyframes: {
          ...layer.keyframes,
          ...(layer.keyframes.x ? { x: layer.keyframes.x.map((k) => ({ ...k, value: k.value + dxPercent })) } : {}),
          ...(layer.keyframes.y ? { y: layer.keyframes.y.map((k) => ({ ...k, value: k.value + dyPercent })) } : {}),
        },
      }));
    }
  });
}

export type AlignEdge = "left" | "center" | "right" | "top" | "middle" | "bottom";

function layerBounds(layer: Layer | LeafLayer): { left: number; right: number; top: number; bottom: number } {
  const width = layer.transform.width ?? 0;
  const height = layer.transform.height ?? 0;
  const left = layer.transform.x - width * layer.transform.anchorX;
  const top = layer.transform.y - height * layer.transform.anchorY;
  return { left, right: left + width, top, bottom: top + height };
}

/** Aligns layers to the selection's bounds (or the frame when one layer is selected). */
export function alignLayers(composition: Composition, input: { targets: LayerTarget[]; edge: AlignEdge }): Composition {
  return edit(composition, (draft) => {
    const layers = input.targets.map((target) => {
      const { clip } = requireVisualClip(draft, target.clipId);
      const location = findLayer(clip, target.layerId);
      if (!location) throw new CompositionEditError("layer_not_found", `No layer "${target.layerId}"`);
      return { clip, layer: location.layer };
    });
    const bounds = layers.map(({ layer }) => layerBounds(layer));
    const frame = layers.length === 1;
    const minLeft = frame ? 0 : Math.min(...bounds.map((b) => b.left));
    const maxRight = frame ? 100 : Math.max(...bounds.map((b) => b.right));
    const minTop = frame ? 0 : Math.min(...bounds.map((b) => b.top));
    const maxBottom = frame ? 100 : Math.max(...bounds.map((b) => b.bottom));
    layers.forEach(({ clip, layer }, index) => {
      const box = bounds[index];
      if (!box) return;
      const width = box.right - box.left;
      const height = box.bottom - box.top;
      let { x, y } = layer.transform;
      const anchorX = layer.transform.anchorX;
      const anchorY = layer.transform.anchorY;
      if (input.edge === "left") x = minLeft + width * anchorX;
      if (input.edge === "right") x = maxRight - width * (1 - anchorX);
      if (input.edge === "center") x = (minLeft + maxRight) / 2 + width * (anchorX - 0.5);
      if (input.edge === "top") y = minTop + height * anchorY;
      if (input.edge === "bottom") y = maxBottom - height * (1 - anchorY);
      if (input.edge === "middle") y = (minTop + maxBottom) / 2 + height * (anchorY - 0.5);
      replaceLayer(clip, layer.id, (current) => ({ ...current, transform: { ...current.transform, x, y } }));
    });
  });
}

export function distributeLayers(composition: Composition, input: { targets: LayerTarget[]; axis: "horizontal" | "vertical" }): Composition {
  if (input.targets.length < 3) return composition;
  return edit(composition, (draft) => {
    const entries = input.targets.map((target) => {
      const { clip } = requireVisualClip(draft, target.clipId);
      const location = findLayer(clip, target.layerId);
      if (!location) throw new CompositionEditError("layer_not_found", `No layer "${target.layerId}"`);
      return { clip, layer: location.layer };
    });
    const key = input.axis === "horizontal" ? "x" : "y";
    entries.sort((a, b) => a.layer.transform[key] - b.layer.transform[key]);
    const first = entries[0]?.layer.transform[key] ?? 0;
    const last = entries[entries.length - 1]?.layer.transform[key] ?? 0;
    const step = (last - first) / (entries.length - 1);
    entries.forEach(({ clip, layer }, index) => {
      replaceLayer(clip, layer.id, (current) => ({ ...current, transform: { ...current.transform, [key]: first + step * index } }));
    });
  });
}

export function groupLayers(
  composition: Composition,
  input: { clipId: string; layerIds: string[]; name?: string },
): { composition: Composition; groupId: string } {
  let groupId = "";
  const next = edit(composition, (draft) => {
    const { clip } = requireVisualClip(draft, input.clipId);
    const targets = new Set(input.layerIds);
    const members = clip.layers.filter((layer) => targets.has(layer.id));
    if (members.length < 2) throw new CompositionEditError("invalid", "Select at least two layers to group");
    const nonLeaf = members.find((layer) => layer.type === "group" || layer.type === "camera");
    if (nonLeaf) throw new CompositionEditError("invalid", `"${nonLeaf.id}" can't go inside a group`);
    groupId = uniqueId(collectIds(draft), "group");
    const firstIndex = clip.layers.findIndex((layer) => targets.has(layer.id));
    const group = layerSchema.parse({
      id: groupId,
      type: "group",
      name: input.name ?? "Group",
      startMs: Math.min(...members.map((layer) => layer.startMs)),
      children: members.map((layer) => ({ ...layer, startMs: layer.startMs - Math.min(...members.map((m) => m.startMs)) })),
    });
    clip.layers = clip.layers.filter((layer) => !targets.has(layer.id));
    clip.layers.splice(firstIndex, 0, group);
  });
  return { composition: next, groupId };
}

// ── Markers, audio, art direction ───────────────────────────────────────────

export function setMarker(composition: Composition, input: { id?: string; atMs: number; label?: string; color?: string }): Composition {
  return edit(composition, (draft) => {
    const existing = input.id ? draft.markers.find((marker) => marker.id === input.id) : undefined;
    if (existing) {
      existing.atMs = input.atMs;
      if (input.label !== undefined) existing.label = input.label;
      if (input.color !== undefined) existing.color = input.color;
      return;
    }
    draft.markers.push({
      id: uniqueId(collectIds(draft), input.id ?? "marker"),
      atMs: Math.max(0, input.atMs),
      label: input.label ?? "",
      ...(input.color ? { color: input.color } : {}),
    });
  });
}

export function removeMarker(composition: Composition, input: { id: string }): Composition {
  return edit(composition, (draft) => {
    draft.markers = draft.markers.filter((marker) => marker.id !== input.id);
  });
}

export function setVolumeEnvelope(composition: Composition, input: { clipId: string; points: EnvelopePoint[] }): Composition {
  return edit(composition, (draft) => {
    const location = requireClip(draft, input.clipId);
    if (location.track.kind !== "audio" || !("envelope" in location.clip)) {
      throw new CompositionEditError("invalid", "Volume envelopes apply to audio clips");
    }
    location.clip.envelope = [...input.points].sort((a, b) => a.atMs - b.atMs).filter((p) => p.atMs <= location.clip.durationMs);
  });
}

export function setArtDirection(composition: Composition, input: { brief: Partial<ArtDirectionBriefInput> }): Composition {
  return edit(composition, (draft) => {
    draft.brief = artDirectionBriefSchema.parse({ ...draft.brief, ...input.brief, palette: { ...draft.brief.palette, ...input.brief.palette } });
  });
}

export function setTrackState(
  composition: Composition,
  input: { trackId: string; patch: { hidden?: boolean; locked?: boolean; muted?: boolean; volume?: number; name?: string } },
): Composition {
  return edit(composition, (draft) => {
    const found = findTrack(draft, input.trackId);
    if (!found) throw new CompositionEditError("track_not_found", `No track "${input.trackId}"`);
    const { muted, volume, ...common } = input.patch;
    Object.assign(found.track, common);
    if (found.track.kind === "audio") {
      if (muted !== undefined) found.track.muted = muted;
      if (volume !== undefined) found.track.volume = volume;
    } else if (found.track.kind === "visual" && muted !== undefined) {
      found.track.muted = muted;
    }
  });
}

// ── Tracks ──────────────────────────────────────────────────────────────────

export type TrackSpec = { kind: "visual" } | { kind: "audio"; role: AudioTrack["role"] } | { kind: "caption" };

const TRACK_NAMES = { visual: "Overlay", voice: "Voice", music: "Music", sfx: "Sound FX", caption: "Captions" } as const;

/** Creates a track in place (draft mutation). Visual tracks go above the topmost visual track; audio after its role's last track. */
function createTrack(draft: Composition, spec: TrackSpec & { id?: string | undefined; name?: string | undefined; index?: number | undefined }): Track {
  const used = collectIds(draft);
  const key = spec.kind === "audio" ? spec.role : spec.kind;
  const id = spec.id && !used.has(spec.id) ? spec.id : uniqueId(used, `track-${key}`);
  const sameKind = draft.tracks.filter((track) => matchesSpec(track, spec));
  const name = spec.name ?? (sameKind.length ? `${TRACK_NAMES[key]} ${sameKind.length + 1}` : TRACK_NAMES[key]);
  const track: Track =
    spec.kind === "visual"
      ? visualTrackSchema.parse({ id, name, kind: "visual", clips: [] })
      : spec.kind === "audio"
        ? audioTrackSchema.parse({ id, name, kind: "audio", role: spec.role, clips: [] })
        : captionTrackSchema.parse({ id, name, kind: "caption", clips: [] });
  let index = spec.index;
  if (index === undefined) {
    const positions = draft.tracks.map((candidate, at) => ({ candidate, at }));
    const lastSame = positions.filter(({ candidate }) => sameKind.includes(candidate)).pop();
    const lastKind = positions.filter(({ candidate }) => candidate.kind === spec.kind).pop();
    const anchor = lastSame ?? lastKind;
    index = anchor ? anchor.at + 1 : draft.tracks.length;
  }
  draft.tracks.splice(Math.max(0, Math.min(index, draft.tracks.length)), 0, track);
  return track;
}

export function addTrack(composition: Composition, input: TrackSpec & { id?: string; name?: string; index?: number }): { composition: Composition; trackId: string } {
  let trackId = "";
  const next = edit(composition, (draft) => {
    if (draft.tracks.length >= 24) throw new CompositionEditError("invalid", "A composition holds at most 24 tracks");
    if (input.kind === "caption" && draft.tracks.some((track) => track.kind === "caption")) {
      throw new CompositionEditError("invalid", "There is already a captions track");
    }
    trackId = createTrack(draft, input).id;
  });
  return { composition: next, trackId };
}

export function removeTrack(composition: Composition, input: { trackId: string }): Composition {
  return edit(composition, (draft) => {
    const found = findTrack(draft, input.trackId);
    if (!found) throw new CompositionEditError("track_not_found", `No track "${input.trackId}"`);
    assertTrackEditable(found.track);
    if (found.track.kind === "visual" && draft.tracks.filter((track) => track.kind === "visual").length === 1) {
      throw new CompositionEditError("invalid", "The main track can't be removed");
    }
    draft.tracks.splice(found.trackIndex, 1);
  });
}

export function reorderTrack(composition: Composition, input: { trackId: string; toIndex: number }): Composition {
  return edit(composition, (draft) => {
    const found = findTrack(draft, input.trackId);
    if (!found) throw new CompositionEditError("track_not_found", `No track "${input.trackId}"`);
    const [track] = draft.tracks.splice(found.trackIndex, 1);
    if (track) draft.tracks.splice(Math.max(0, Math.min(input.toIndex, draft.tracks.length)), 0, track);
  });
}

function isFree(track: Track, startMs: number, durationMs: number, ignoreIds: ReadonlySet<string> = new Set()): boolean {
  const endMs = startMs + durationMs;
  return !track.clips.some((other) => !ignoreIds.has(other.id) && startMs < clipEndMs(other) - 0.5 && endMs > other.startMs + 0.5);
}

function matchesSpec(track: Track, spec: TrackSpec): boolean {
  return track.kind === spec.kind && (spec.kind !== "audio" || (track.kind === "audio" && track.role === spec.role));
}

/** First unlocked track of the kind with room at [start, start+duration), else a new one. */
function freeTrackFor(draft: Composition, spec: TrackSpec, startMs: number, durationMs: number, preferredId?: string): Track {
  const preferred = preferredId ? findTrack(draft, preferredId)?.track : undefined;
  if (preferred && matchesSpec(preferred, spec) && !preferred.locked && isFree(preferred, startMs, durationMs)) return preferred;
  if (spec.kind === "caption") {
    const captions = draft.tracks.find((track) => track.kind === "caption");
    if (captions) {
      if (!isFree(captions, startMs, durationMs)) throw new CompositionEditError("overlap", "Captions can't overlap; move the playhead to a gap");
      return captions;
    }
    return createTrack(draft, spec);
  }
  // Never auto-fill the main (first visual) track; overlays sit above it.
  const firstVisual = draft.tracks.find((track) => track.kind === "visual");
  const found = draft.tracks.find(
    (track) => matchesSpec(track, spec) && !track.locked && (spec.kind !== "visual" || track !== firstVisual) && isFree(track, startMs, durationMs),
  );
  return found ?? createTrack(draft, spec);
}

function specOf(track: Track): TrackSpec {
  return track.kind === "audio" ? { kind: "audio", role: track.role } : { kind: track.kind };
}

// ── Copy, paste, duplicate ──────────────────────────────────────────────────

function freshLayer<L extends Layer | LeafLayer>(layer: L, used: Set<string>): L {
  const copy = structuredClone(layer) as L;
  copy.id = uniqueId(used, layer.id.replace(/-\d+$/, ""));
  if (copy.type === "group") copy.children = copy.children.map((child) => freshLayer(child, used));
  return copy;
}

/** A deep copy of a clip with new ids for it and every layer inside. */
export function cloneClipWithFreshIds(clip: AnyClip, used: Set<string>): AnyClip {
  const copy = structuredClone(clip) as AnyClip;
  copy.id = uniqueId(used, clip.id.replace(/-\d+$/, ""));
  if ("layers" in copy) copy.layers = copy.layers.map((layer) => freshLayer(layer, used));
  return copy;
}

function shiftClipTo(clip: AnyClip, startMs: number): void {
  const delta = startMs - clip.startMs;
  clip.startMs = startMs;
  if ("words" in clip) {
    for (const word of clip.words) {
      word.startMs += delta;
      word.endMs += delta;
    }
  }
}

export function duplicateClips(composition: Composition, input: { clipIds: string[] }): { composition: Composition; clipIds: string[] } {
  const clipIds: string[] = [];
  const next = edit(composition, (draft) => {
    const used = collectIds(draft);
    for (const id of input.clipIds) {
      const location = requireClip(draft, id);
      const copy = cloneClipWithFreshIds(location.clip, used);
      const at = clipEndMs(location.clip);
      shiftClipTo(copy, at);
      if ("timing" in copy) copy.timing = "manual";
      const mainTrack = draft.tracks.find((track) => track.kind === "visual");
      let target = location.track;
      if (!isFree(location.track, at, copy.durationMs)) {
        if (location.track === mainTrack) {
          assertTrackEditable(location.track);
          // The main track is magnetic: make room after the original.
          for (const other of location.track.clips) if (other.startMs >= at - 0.5) shiftClipTo(other, other.startMs + copy.durationMs);
        } else {
          target = freeTrackFor(draft, specOf(location.track), at, copy.durationMs);
        }
      }
      assertTrackEditable(target);
      (target.clips as AnyClip[]).push(copy);
      clipIds.push(copy.id);
    }
  });
  return { composition: next, clipIds };
}

export interface ClipboardClip {
  trackId?: string | undefined;
  track: TrackSpec;
  clip: ClipInput;
}

/** Pastes clips at `atMs`, keeping their relative offsets; each lands on its old track when free, else a free or new track. */
export function pasteClips(composition: Composition, input: { items: ClipboardClip[]; atMs: number }): { composition: Composition; clipIds: string[] } {
  const clipIds: string[] = [];
  const next = edit(composition, (draft) => {
    if (input.items.length === 0) return;
    const used = collectIds(draft);
    const earliest = Math.min(...input.items.map((item) => item.clip.startMs));
    for (const item of input.items) {
      const startMs = Math.max(0, input.atMs + (item.clip.startMs - earliest));
      const target = freeTrackFor(draft, item.track, startMs, item.clip.durationMs, item.trackId);
      const parsed = parseClipForTrack(target, { ...item.clip, id: item.clip.id ?? "clip" });
      const copy = cloneClipWithFreshIds(parsed, used);
      shiftClipTo(copy, startMs);
      if ("timing" in copy) copy.timing = "manual";
      (target.clips as AnyClip[]).push(copy);
      clipIds.push(copy.id);
    }
  });
  return { composition: next, clipIds };
}

export function duplicateLayers(composition: Composition, input: { clipId: string; layerIds: string[] }): { composition: Composition; layerIds: string[] } {
  const layerIds: string[] = [];
  const next = edit(composition, (draft) => {
    const { clip, track } = requireVisualClip(draft, input.clipId);
    assertTrackEditable(track);
    const used = collectIds(draft);
    for (const id of input.layerIds) {
      const index = clip.layers.findIndex((layer) => layer.id === id);
      const original = clip.layers[index];
      if (!original) throw new CompositionEditError("layer_not_found", `No layer "${id}"`);
      const copy = freshLayer(original, used);
      copy.transform = { ...copy.transform, x: copy.transform.x + 2, y: copy.transform.y + 2 };
      clip.layers.splice(index + 1, 0, copy);
      layerIds.push(copy.id);
    }
  });
  return { composition: next, layerIds };
}

export function pasteLayers(composition: Composition, input: { clipId: string; layers: LayerDraft[] }): { composition: Composition; layerIds: string[] } {
  const layerIds: string[] = [];
  const next = edit(composition, (draft) => {
    const { clip, track } = requireVisualClip(draft, input.clipId);
    assertTrackEditable(track);
    const used = collectIds(draft);
    for (const layerInput of input.layers) {
      const parsed = layerSchema.parse({ ...layerInput, id: layerInput.id ?? layerInput.type });
      const copy = freshLayer(parsed, used);
      clip.layers.push(copy);
      layerIds.push(copy.id);
    }
  });
  return { composition: next, layerIds };
}

// ── Format ──────────────────────────────────────────────────────────────────

/** Changes the frame format. Layout is in % of the frame, so layers reflow; type stays in design px. */
export function setFormat(composition: Composition, input: { ratio?: AspectRatio | undefined; fps?: Composition["fps"] | undefined; title?: string | undefined }): Composition {
  return edit(composition, (draft) => {
    if (input.ratio) {
      draft.ratio = input.ratio;
      draft.width = FRAME_SIZE[input.ratio].width;
      draft.height = FRAME_SIZE[input.ratio].height;
    }
    if (input.fps) draft.fps = input.fps;
    if (input.title !== undefined && input.title.trim()) draft.title = input.title.trim().slice(0, 120);
  });
}

// ── Captions ────────────────────────────────────────────────────────────────

export function setCaptionStyle(composition: Composition, input: { trackId?: string | undefined; style: Partial<CaptionStyle> | Record<string, unknown> }): Composition {
  return edit(composition, (draft) => {
    const track = input.trackId ? findTrack(draft, input.trackId)?.track : draft.tracks.find((candidate) => candidate.kind === "caption");
    if (!track || track.kind !== "caption") throw new CompositionEditError("track_not_found", "No captions track");
    const merged: Record<string, unknown> = { ...track.style, ...input.style };
    for (const [key, value] of Object.entries(input.style)) if (value === null) delete merged[key];
    track.style = captionStyleSchema.parse(merged);
  });
}

/** Re-times words for edited caption text: the same word count keeps timings; otherwise words share the cue by length. */
export function retimeCaptionWords(clip: CaptionClip, text: string): CaptionClip["words"] {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  if (clip.words.length === tokens.length) return clip.words.map((word, index) => ({ ...word, text: tokens[index] ?? word.text }));
  const weights = tokens.map((token) => Math.max(1, token.length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = clip.startMs;
  return tokens.map((token, index) => {
    const duration = (clip.durationMs * (weights[index] ?? 1)) / total;
    const word = { text: token, startMs: Math.round(cursor), endMs: Math.round(cursor + duration) };
    cursor += duration;
    return word;
  });
}

export function updateCaption(composition: Composition, input: { clipId: string; text: string }): Composition {
  return edit(composition, (draft) => {
    const location = requireClip(draft, input.clipId);
    if (location.track.kind !== "caption" || !("words" in location.clip)) throw new CompositionEditError("invalid", "Not a caption");
    assertTrackEditable(location.track);
    const text = input.text.trim().replace(/\s+/g, " ");
    if (!text) throw new CompositionEditError("invalid", "A caption needs some text (delete it instead)");
    const clip = location.clip;
    clip.words = retimeCaptionWords(clip, text);
    clip.text = text.slice(0, 400);
    clip.emphasis = clip.emphasis.filter((index) => index < clip.words.length);
  });
}

/** Adds a caption cue at a time (on the captions track, created if missing). */
export function addCaption(composition: Composition, input: { atMs: number; durationMs?: number; text: string; clipId?: string }): { composition: Composition; clipId: string } {
  let clipId = "";
  const next = edit(composition, (draft) => {
    const used = collectIds(draft);
    clipId = input.clipId && !used.has(input.clipId) ? input.clipId : uniqueId(used, "caption");
    const startMs = Math.max(0, Math.round(input.atMs));
    const durationMs = Math.max(MIN_CLIP_MS * 5, Math.round(input.durationMs ?? 2000));
    const track = freeTrackFor(draft, { kind: "caption" }, startMs, durationMs);
    const text = input.text.trim() || "Caption";
    const clip = captionClipSchema.parse({ id: clipId, startMs, durationMs, text, words: [] });
    clip.words = retimeCaptionWords(clip, text);
    (track.clips as AnyClip[]).push(clip);
  });
  return { composition: next, clipId };
}

// ── Media ───────────────────────────────────────────────────────────────────

export interface MediaRef {
  assetId: string;
  mediaType: "image" | "video" | "audio";
  durationMs?: number | null | undefined;
  label?: string | undefined;
  /** Library kind (music, sfx, voice…) decides which audio track it lands on. */
  kind?: string | undefined;
}

export const DEFAULT_IMAGE_MS = 5000;

function audioRoleFor(media: MediaRef): AudioTrack["role"] {
  if (media.kind === "voice" || media.kind === "music" || media.kind === "sfx") return media.kind;
  return (media.durationMs ?? 0) > 15_000 ? "music" : "sfx";
}

/**
 * Adds an uploaded asset to the timeline (drag-and-drop from the media
 * panel). Image/video on the main track insert magnetically (later clips
 * shift); on an overlay track they land at `atMs`, moving to a free or new
 * overlay track if that spot is taken. Audio lands on a track of its role.
 */
export function addMediaClip(
  composition: Composition,
  input: { media: MediaRef; atMs: number; trackId?: string | undefined; clipId?: string | undefined; mode?: "auto" | "overlay" | undefined },
): { composition: Composition; clipId: string; trackId: string } {
  let clipId = "";
  let trackId = "";
  const next = edit(composition, (draft) => {
    const used = collectIds(draft);
    const media = input.media;
    const label = (media.label ?? media.mediaType).slice(0, 80);
    clipId = input.clipId && !used.has(input.clipId) ? input.clipId : uniqueId(used, media.mediaType === "audio" ? "audio" : "media");
    used.add(clipId);
    const atMs = Math.max(0, Math.round(input.atMs));
    if (media.mediaType === "audio") {
      const durationMs = Math.max(MIN_CLIP_MS, Math.round(media.durationMs ?? 8000));
      const preferred = input.trackId ? findTrack(draft, input.trackId)?.track : undefined;
      const spec: TrackSpec = preferred?.kind === "audio" ? { kind: "audio", role: preferred.role } : { kind: "audio", role: audioRoleFor(media) };
      const track = freeTrackFor(draft, spec, atMs, durationMs, input.trackId);
      const clip = audioClipSchema.parse({
        id: clipId,
        startMs: atMs,
        durationMs,
        src: `asset:${media.assetId}`,
        assetId: media.assetId,
        text: label,
        duckUnderVoice: spec.kind === "audio" && spec.role === "music",
      });
      (track.clips as AnyClip[]).push(clip);
      trackId = track.id;
      return;
    }
    const durationMs = Math.max(MIN_CLIP_MS, Math.round(media.mediaType === "video" ? (media.durationMs ?? DEFAULT_IMAGE_MS) : DEFAULT_IMAGE_MS));
    const mainTrack = draft.tracks.find((track) => track.kind === "visual");
    const requested = input.trackId ? findTrack(draft, input.trackId)?.track : mainTrack;
    const target = requested?.kind === "visual" ? requested : mainTrack;
    if (!target) throw new CompositionEditError("track_not_found", "No visual track");
    const layer = {
      id: uniqueId(used, media.mediaType),
      type: media.mediaType,
      name: label,
      src: `asset:${media.assetId}`,
      fit: "contain",
      transform: { x: 50, y: 50, width: 100, height: 100 },
      ...(media.mediaType === "video" ? { volume: 1 } : {}),
    };
    const clipBase = { id: clipId, name: label, durationMs, layers: [layer], timing: "manual" as const };
    if (target === mainTrack && input.mode !== "overlay") {
      assertTrackEditable(target);
      // Magnetic insert at the nearest clip boundary.
      const sorted = [...target.clips].sort((a, b) => a.startMs - b.startMs);
      const inside = sorted.find((clip) => atMs > clip.startMs && atMs < clipEndMs(clip));
      const last = sorted[sorted.length - 1];
      const lastEnd = last ? clipEndMs(last) : 0;
      const insertAt = inside ? (atMs - inside.startMs < inside.durationMs / 2 ? inside.startMs : clipEndMs(inside)) : Math.min(atMs, lastEnd);
      for (const other of target.clips) if (other.startMs >= insertAt - 0.5) shiftClipTo(other, other.startMs + durationMs);
      (target.clips as AnyClip[]).push(visualClipSchema.parse({ ...clipBase, startMs: insertAt, background: "#000000" }));
      trackId = target.id;
      return;
    }
    const track = freeTrackFor(draft, { kind: "visual" }, atMs, durationMs, target === mainTrack ? undefined : target.id);
    (track.clips as AnyClip[]).push(visualClipSchema.parse({ ...clipBase, startMs: atMs }));
    trackId = track.id;
  });
  return { composition: next, clipId, trackId };
}

/** Adds a ready-made layer (text, shape, sticker) as its own clip on an overlay track at `atMs`. */
export function addElementClip(
  composition: Composition,
  input: { layer: LayerDraft; atMs: number; durationMs?: number | undefined; trackId?: string | undefined; clipId?: string | undefined; name?: string | undefined },
): { composition: Composition; clipId: string; trackId: string } {
  let clipId = "";
  let trackId = "";
  const next = edit(composition, (draft) => {
    const used = collectIds(draft);
    clipId = input.clipId && !used.has(input.clipId) ? input.clipId : uniqueId(used, input.layer.type === "text" ? "text" : "element");
    used.add(clipId);
    const atMs = Math.max(0, Math.round(input.atMs));
    const durationMs = Math.max(MIN_CLIP_MS, Math.round(input.durationMs ?? 3000));
    const requested = input.trackId ? findTrack(draft, input.trackId)?.track : undefined;
    const mainTrack = draft.tracks.find((track) => track.kind === "visual");
    const track = freeTrackFor(draft, { kind: "visual" }, atMs, durationMs, requested && requested !== mainTrack ? requested.id : undefined);
    const layer = layerSchema.parse({ ...input.layer, id: uniqueId(used, input.layer.id ?? input.layer.type) });
    const name = input.name ?? input.layer.name ?? (layer.type === "text" ? layer.text.replace(/\*/g, "").slice(0, 40) : layer.type);
    (track.clips as AnyClip[]).push(visualClipSchema.parse({ id: clipId, name, startMs: atMs, durationMs, layers: [layer], timing: "manual" }));
    trackId = track.id;
  });
  return { composition: next, clipId, trackId };
}

/** Clip speed for audio clips and video media clips; the clip's length scales and later clips on the track make room. */
export function setClipSpeed(composition: Composition, input: { clipId: string; rate: number }): Composition {
  return edit(composition, (draft) => {
    const location = requireClip(draft, input.clipId);
    assertTrackEditable(location.track);
    const rate = Math.max(0.25, Math.min(4, input.rate));
    const clip = location.clip;
    let oldRate = 1;
    if ("src" in clip) {
      oldRate = clip.playbackRate;
      clip.playbackRate = rate;
    } else if ("layers" in clip) {
      const video = clip.layers.find((layer) => layer.type === "video");
      if (!video || video.type !== "video") throw new CompositionEditError("invalid", "Speed applies to video and audio clips");
      oldRate = video.playbackRate;
      video.playbackRate = rate;
      if (video.durationMs) video.durationMs = Math.max(MIN_CLIP_MS, (video.durationMs * oldRate) / rate);
    } else {
      throw new CompositionEditError("invalid", "Captions have no speed");
    }
    const oldEnd = clipEndMs(clip);
    clip.durationMs = Math.max(MIN_CLIP_MS, Math.round((clip.durationMs * oldRate) / rate));
    const delta = clipEndMs(clip) - oldEnd;
    if (delta > 0 && !isFree(location.track, clip.startMs, clip.durationMs, new Set([clip.id]))) {
      for (const other of location.track.clips) if (other.id !== clip.id && other.startMs >= oldEnd - 0.5) shiftClipTo(other, other.startMs + delta);
    }
  });
}
