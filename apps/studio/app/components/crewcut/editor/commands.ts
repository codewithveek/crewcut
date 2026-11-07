import { callAction } from "@agent-native/core/client/hooks";
import {
  type AnyClip,
  type AspectRatio,
  type AudioTrack,
  type ClipboardClip,
  type Composition,
  type CompositionOpInput,
  type FilterPreset,
  type Layer,
  type LayerDraft,
  type LeafLayer,
  type MediaRef,
  type Track,
  type Transition,
  type TrackSpec,
  type VisualClip,
  STEADY_BEAT,
  TRANSITION_CATALOG,
  beatPhaseMs,
  clipEndMs,
  estimateTempo,
  onsetEnvelope,
  snapCutsToBeats,
  timelineBeats,
  findClip,
  findLayer,
  isCrewcutEnding,
} from "@crewcut/composition";
import { SHORT_FORM_CAPTIONS, buildCaptionCues, estimateWordTimings } from "@crewcut/voice";
import { toast } from "sonner";

import { errorMessage } from "@/lib/crewcut";

import { useEditor } from "./editor-store";
import { type AssetDto, PEAKS_PER_SECOND, type StockPhotoDto, loadPeaks } from "./media";

/**
 * Editor commands. Keyboard shortcuts, context menus, toolbars and the
 * phone toolbar all call these, so every path does exactly the same edit.
 */

const state = () => useEditor.getState();

export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Selection ───────────────────────────────────────────────────────────────

export type Selection =
  | { kind: "none" }
  | { kind: "multi"; clipIds: string[] }
  | { kind: "clip"; clip: VisualClip; track: Track }
  | { kind: "layer"; clip: VisualClip; track: Track; layer: Layer | LeafLayer; solo: boolean }
  | { kind: "audio"; clip: Extract<AnyClip, { src: string }>; track: AudioTrack }
  | { kind: "caption"; clip: Extract<AnyClip, { words: unknown }>; track: Track };

/** A visual clip that is one image/video/text/element layer behaves like that layer (CapCut-style). */
export function soloLayer(clip: VisualClip): Layer | null {
  const visible = clip.layers.filter((layer) => layer.type !== "camera");
  return visible.length === 1 && visible[0]?.type !== "group" ? (visible[0] ?? null) : null;
}

export function describeSelection(composition: Composition | null, selectedClipIds: string[], selectedLayer: { clipId: string; layerId: string } | null): Selection {
  if (!composition) return { kind: "none" };
  if (selectedLayer) {
    const location = findClip(composition, selectedLayer.clipId);
    if (location && "layers" in location.clip) {
      const layer = findLayer(location.clip, selectedLayer.layerId)?.layer;
      if (layer) return { kind: "layer", clip: location.clip, track: location.track, layer, solo: soloLayer(location.clip)?.id === layer.id };
    }
  }
  if (selectedClipIds.length > 1) return { kind: "multi", clipIds: selectedClipIds };
  const id = selectedClipIds[0];
  if (!id) return { kind: "none" };
  const location = findClip(composition, id);
  if (!location) return { kind: "none" };
  const { clip, track } = location;
  if ("layers" in clip) {
    const solo = soloLayer(clip);
    return solo ? { kind: "layer", clip, track, layer: solo, solo: true } : { kind: "clip", clip, track };
  }
  if ("src" in clip && track.kind === "audio") return { kind: "audio", clip, track };
  if ("words" in clip) return { kind: "caption", clip, track };
  return { kind: "none" };
}

export function currentSelection(): Selection {
  const { composition, selectedClipIds, selectedLayer } = state();
  return describeSelection(composition, selectedClipIds, selectedLayer);
}

export function clipKind(clip: AnyClip, track: Track): "media" | "text" | "graphic" | "caption" | "voice" | "music" | "sfx" {
  if (track.kind === "caption") return "caption";
  if (track.kind === "audio") return track.role;
  if ("layers" in clip) {
    const solo = soloLayer(clip);
    if (solo?.type === "image" || solo?.type === "video") return "media";
    if (solo?.type === "text" || (clip.layers.length > 0 && clip.layers.every((layer) => layer.type === "text"))) return "text";
  }
  return "graphic";
}

export function trackSpecOf(track: Track): TrackSpec {
  return track.kind === "audio" ? { kind: "audio", role: track.role } : { kind: track.kind };
}

// ── Committing ──────────────────────────────────────────────────────────────

export function run(label: string, ops: CompositionOpInput[]): Promise<boolean> {
  return state().commitOps(label, ops);
}

function playhead(): number {
  return Math.round(state().playheadMs);
}

// ── Clip commands ───────────────────────────────────────────────────────────

export function splitAtPlayhead(): void {
  const { composition, selectedClipIds } = state();
  if (!composition) return;
  const at = playhead();
  const inside = (clip: AnyClip) => at > clip.startMs + 40 && at < clipEndMs(clip) - 40;
  let targets = selectedClipIds.map((id) => findClip(composition, id)).filter((location) => location && inside(location.clip) && !location.track.locked);
  if (targets.length === 0) {
    // Nothing selected under the playhead: split every unlocked clip it crosses (CapCut's split-all).
    targets = composition.tracks.filter((track) => !track.locked).flatMap((track) => track.clips.filter(inside).map((clip) => findClip(composition, clip.id)));
  }
  const ops = targets.filter(Boolean).map((location) => ({ op: "split-clip" as const, clipId: location!.clip.id, atMs: at }));
  if (ops.length === 0) {
    toast.message("Move the playhead inside a clip to split it.");
    return;
  }
  void run(ops.length === 1 ? "Split clip" : `Split ${ops.length} clips`, ops);
}

export function deleteSelection(rippleOverride?: boolean): void {
  const selection = currentSelection();
  const ripple = rippleOverride ?? state().ripple;
  if (selection.kind === "layer" && !selection.solo) {
    void run(`Delete ${selection.layer.name ?? selection.layer.type}`, [{ op: "remove-layers", clipId: selection.clip.id, layerIds: [selection.layer.id] }]);
    state().selectLayer(null);
    return;
  }
  const ids = state().selectedClipIds;
  if (ids.length === 0) return;
  void run(ids.length === 1 ? (ripple ? "Delete and close gap" : "Delete clip") : `Delete ${ids.length} clips`, [{ op: "delete-clips", clipIds: ids, ripple }]);
  state().selectClip(null);
}

export async function duplicateSelection(): Promise<void> {
  const selection = currentSelection();
  if (selection.kind === "layer" && !selection.solo) {
    await run("Duplicate layer", [{ op: "duplicate-layers", clipId: selection.clip.id, layerIds: [selection.layer.id] }]);
    return;
  }
  const ids = state().selectedClipIds;
  if (ids.length === 0) return;
  const before = new Set(allClipIds(state().composition));
  const ok = await run(ids.length === 1 ? "Duplicate clip" : `Duplicate ${ids.length} clips`, [{ op: "duplicate-clips", clipIds: ids }]);
  if (ok) selectNewClips(before);
}

function allClipIds(composition: Composition | null): string[] {
  return composition ? composition.tracks.flatMap((track) => track.clips.map((clip) => clip.id)) : [];
}

function selectNewClips(before: Set<string>): void {
  const fresh = allClipIds(state().composition).filter((id) => !before.has(id));
  if (fresh.length) state().selectClips(fresh);
}

export function copySelection(): boolean {
  const { composition } = state();
  const selection = currentSelection();
  if (!composition) return false;
  if (selection.kind === "layer" && !selection.solo) {
    const { id: _id, ...layer } = structuredClone(selection.layer) as Layer;
    state().setClipboard({ kind: "layers", layers: [layer as LayerDraft] });
    toast.message("Layer copied");
    return true;
  }
  const items: ClipboardClip[] = state()
    .selectedClipIds.map((id) => findClip(composition, id))
    .filter((location): location is NonNullable<typeof location> => Boolean(location))
    .map((location) => ({ trackId: location.track.id, track: trackSpecOf(location.track), clip: structuredClone(location.clip) as ClipboardClip["clip"] }));
  if (items.length === 0) return false;
  state().setClipboard({ kind: "clips", items });
  toast.message(items.length === 1 ? "Clip copied" : `${items.length} clips copied`);
  return true;
}

export function cutSelection(): void {
  if (copySelection()) deleteSelection(false);
}

export async function paste(atMs = playhead()): Promise<void> {
  const { clipboard, composition } = state();
  if (!clipboard || !composition) {
    toast.message("Nothing to paste yet. Copy a clip or layer first.");
    return;
  }
  if (clipboard.kind === "layers") {
    const selection = currentSelection();
    const target = selection.kind === "clip" || selection.kind === "layer" ? selection.clip.id : visualClipAt(composition, atMs);
    if (!target) {
      // No clip to paste into: the layer becomes its own clip at the playhead.
      const layer = clipboard.layers[0];
      if (layer) await addElementAt(layer, atMs);
      return;
    }
    await run("Paste layer", [{ op: "paste-layers", clipId: target, layers: clipboard.layers as never }]);
    return;
  }
  const before = new Set(allClipIds(composition));
  const ok = await run(clipboard.items.length === 1 ? "Paste clip" : `Paste ${clipboard.items.length} clips`, [{ op: "paste-clips", atMs, items: clipboard.items as never }]);
  if (ok) selectNewClips(before);
}

function visualClipAt(composition: Composition, atMs: number): string | null {
  const visual = composition.tracks.filter((track) => track.kind === "visual" && !track.locked).reverse();
  for (const track of visual) {
    const clip = track.clips.find((candidate) => atMs >= candidate.startMs && atMs < clipEndMs(candidate));
    if (clip) return clip.id;
  }
  return null;
}

/** CapCut's Q / W: trim the selected clip's start or end to the playhead. */
export function trimToPlayhead(edge: "start" | "end"): void {
  const { composition, selectedClipIds } = state();
  if (!composition) return;
  const at = playhead();
  const ops = selectedClipIds
    .map((id) => findClip(composition, id))
    .filter((location) => location && at > location.clip.startMs && at < clipEndMs(location.clip))
    .map((location) => ({ op: "trim-clip" as const, clipId: location!.clip.id, edge, toMs: at, ripple: state().ripple }));
  if (ops.length === 0) {
    toast.message("Select a clip under the playhead to trim it.");
    return;
  }
  void run(edge === "start" ? "Trim start to playhead" : "Trim end to playhead", ops);
}

// ── Adding things ───────────────────────────────────────────────────────────

export interface AssetLike {
  id: string;
  mediaType: "image" | "video" | "audio";
  label: string;
  durationMs: number | null;
  kind?: string;
  url: string;
}

/**
 * Swaps the photo or video inside a layer and keeps everything else: position,
 * crop, motion, grade and its template slot. Photos replace photos, videos replace videos.
 */
export async function replaceLayerMedia(target: { clipId: string; layerId: string }, asset: AssetLike): Promise<boolean> {
  const composition = state().composition;
  const location = composition ? findClip(composition, target.clipId) : null;
  const found = location && "layers" in location.clip ? findLayer(location.clip, target.layerId) : null;
  if (!found || (found.layer.type !== "image" && found.layer.type !== "video")) return false;
  if (asset.mediaType !== found.layer.type) {
    toast.message(found.layer.type === "image" ? "That's a video. Drop a photo onto a photo, or drop the video elsewhere to add it." : "That's a photo. Drop a video onto a video, or drop the photo elsewhere to add it.");
    return false;
  }
  state().mergeAssetUrls({ [asset.id]: asset.url });
  return run(found.layer.type === "image" ? "Replace photo" : "Replace video", [{ op: "update-layer", clipId: target.clipId, layerId: target.layerId, patch: { src: `asset:${asset.id}`, alt: asset.label.slice(0, 200) } }]);
}

export async function addMediaAt(asset: AssetLike, atMs = playhead(), options: { trackId?: string; mode?: "auto" | "overlay" } = {}): Promise<void> {
  state().mergeAssetUrls({ [asset.id]: asset.url });
  const media: MediaRef = { assetId: asset.id, mediaType: asset.mediaType, label: asset.label, ...(asset.durationMs ? { durationMs: asset.durationMs } : {}), ...(asset.kind ? { kind: asset.kind } : {}) };
  const clipId = newId(asset.mediaType === "audio" ? "audio" : "media");
  const ok = await run(`Add ${asset.label}`, [{ op: "add-media-clip", media: media as never, atMs: Math.max(0, Math.round(atMs)), clipId, ...(options.trackId ? { trackId: options.trackId } : {}), mode: options.mode ?? "auto" }]);
  if (ok) state().selectClip(clipId);
}

export async function addElementAt(layer: LayerDraft, atMs = playhead(), options: { trackId?: string; durationMs?: number } = {}): Promise<void> {
  const clipId = newId(layer.type === "text" ? "text" : "element");
  const ok = await run(`Add ${layer.name ?? layer.type}`, [
    { op: "add-element-clip", layer: layer as never, atMs: Math.max(0, Math.round(atMs)), clipId, ...(options.trackId ? { trackId: options.trackId } : {}), ...(options.durationMs ? { durationMs: options.durationMs } : {}) },
  ]);
  if (ok) state().selectClip(clipId);
}

// ── Stock photos ────────────────────────────────────────────────────────────

const stockImports = new Map<string, Promise<AssetDto>>();

/**
 * Saves a stock photo into this video's media (with the photographer's credit)
 * and returns it as an asset. The server reuses a photo the video already has;
 * clicks on the same photo while it downloads share one download.
 */
export function importStockPhoto(photo: Pick<StockPhotoDto, "id">): Promise<AssetDto> {
  const videoId = state().videoId;
  const key = `${videoId}:${photo.id}`;
  let job = stockImports.get(key);
  if (!job) {
    job = (callAction("import-stock-photo" as never, { photoId: photo.id, videoId } as never) as Promise<{ asset: AssetDto }>)
      .then((result) => {
        state().mergeAssetUrls({ [result.asset.id]: result.asset.url });
        return result.asset;
      })
      .finally(() => stockImports.delete(key));
    stockImports.set(key, job);
  }
  return job;
}

/** Adds a stock photo to the timeline, like any photo from the media panel. */
export async function addStockAt(photo: StockPhotoDto, atMs = playhead(), options: { trackId?: string; mode?: "auto" | "overlay" } = {}): Promise<boolean> {
  const toastId = toast.loading("Adding photo…");
  try {
    const asset = await importStockPhoto(photo);
    await addMediaAt(asset, atMs, options);
    toast.dismiss(toastId);
    return true;
  } catch (error) {
    toast.error(errorMessage(error), { id: toastId });
    return false;
  }
}

export interface LibraryAudio {
  id: string;
  label: string;
  kind: "music" | "sfx";
  durationMs: number;
}

export async function addLibraryAudioAt(item: LibraryAudio, atMs = playhead(), options: { trackId?: string } = {}): Promise<void> {
  try {
    const asset = (await callAction("add-library-asset" as never, { itemId: item.id, videoId: state().videoId } as never)) as { assetId: string; url: string; durationMs: number; label: string; kind: string };
    await addMediaAt({ id: asset.assetId, mediaType: "audio", label: asset.label, durationMs: asset.durationMs, kind: asset.kind, url: asset.url }, atMs, options);
  } catch (error) {
    toast.error(errorMessage(error));
  }
}

export async function addCaptionAt(atMs = playhead(), text = "New caption"): Promise<void> {
  const clipId = newId("caption");
  const ok = await run("Add caption", [{ op: "add-caption", atMs: Math.round(atMs), text, clipId }]);
  if (ok) state().selectClip(clipId);
}

/** Builds caption cues from every narration clip's transcript (no speech recognition needed). */
export async function generateCaptionsFromNarration(): Promise<void> {
  const { composition } = state();
  if (!composition) return;
  const voice = composition.tracks.filter((track): track is AudioTrack => track.kind === "audio" && track.role === "voice");
  const lines = voice.flatMap((track) => track.clips).filter((clip) => clip.text?.trim());
  if (lines.length === 0) {
    toast.message("No narration with a transcript yet. Add captions by hand, or record a voiceover first.");
    return;
  }
  const captions = composition.tracks.find((track) => track.kind === "caption");
  const ops: CompositionOpInput[] = [];
  if (!captions) ops.push({ op: "add-track", track: { kind: "caption" }, id: "track-captions" });
  const trackId = captions?.id ?? "track-captions";
  const taken = captions?.clips ?? [];
  if (taken.length) ops.push({ op: "delete-clips", clipIds: taken.map((clip) => clip.id) });
  for (const line of lines) {
    const words = estimateWordTimings(line.text ?? "", line.durationMs, line.startMs);
    for (const cue of buildCaptionCues(words, SHORT_FORM_CAPTIONS)) {
      ops.push({ op: "add-clip", trackId, clip: { id: newId("cap"), startMs: Math.round(cue.startMs), durationMs: Math.max(200, Math.round(cue.endMs - cue.startMs)), text: cue.text, words: cue.words.map((word) => ({ ...word, startMs: Math.round(word.startMs), endMs: Math.round(word.endMs) })), emphasis: cue.emphasis } });
    }
  }
  const ok = await run("Generate captions from narration", ops);
  if (ok) toast.success("Captions generated from the narration");
}

export function applyTransition(clipId: string, transition: Transition | null): void {
  void run(transition ? `Transition: ${TRANSITION_CATALOG[transition.type]?.label ?? transition.type}` : "Remove transition", [{ op: "set-transition", clipId, transition }]).then((ok) => ok && offerTransitionForAll(clipId));
}

/** Filters apply to a selected media/element layer, else to the whole clip. */
export function applyFilter(target: { clipId: string; layerId?: string }, preset: FilterPreset | null, intensity = 1): void {
  const filter = preset ? { preset, intensity } : null;
  void run(preset ? `Filter: ${preset}` : "Remove filter", [
    target.layerId ? { op: "update-layer", clipId: target.clipId, layerId: target.layerId, patch: { filter } } : { op: "update-clip", clipId: target.clipId, patch: { filter } },
  ]).then((ok) => ok && offerLookForAll(target, "filter"));
}

// ── Beat sync ───────────────────────────────────────────────────────────────

/** The music clip beat sync follows: the given one, else the selected music clip, else the longest. */
export function beatSyncMusic(clipId?: string): { clip: Extract<AnyClip, { src: string }>; track: AudioTrack } | null {
  const composition = state().composition;
  if (!composition) return null;
  const music = composition.tracks.flatMap((track) => (track.kind === "audio" && track.role === "music" ? track.clips.map((clip) => ({ clip, track })) : []));
  const wanted = clipId ?? state().selectedClipIds[0];
  return music.find((entry) => entry.clip.id === wanted) ?? [...music].sort((a, b) => b.clip.durationMs - a.clip.durationMs)[0] ?? null;
}

let syncing = false;

/**
 * Moves the cuts on the main track onto the music's beat (one undoable step).
 * The tempo comes from where the music came from (templates, library and
 * catalog tracks know theirs) or is measured from the audio; where the beat
 * starts is always measured, so the cuts land on the real hits.
 */
export async function snapCutsToBeat(clipId?: string, bpmOverride?: number): Promise<void> {
  if (syncing) return;
  const found = beatSyncMusic(clipId);
  if (!found) {
    toast.message("Add music first, then snap the cuts to its beat.");
    return;
  }
  const assetId = found.clip.src.startsWith("asset:") ? found.clip.src.slice(6) : null;
  const url = assetId ? state().assetUrls[assetId] : found.clip.src;
  if (!url) {
    toast.error("The music file isn't available. Reload the editor and try again.");
    return;
  }
  syncing = true;
  const toastId = toast.loading("Finding the beat…");
  try {
    const known = assetId ? ((await callAction("get-music-tempo" as never, { videoId: state().videoId, assetId } as never, { method: "GET" }).catch(() => null)) as { bpm: number | null } | null) : null;
    const peaks = await loadPeaks(url);
    if (!peaks || peaks.length < PEAKS_PER_SECOND * 2) {
      toast.error("Couldn't read this music. Try another track.", { id: toastId });
      return;
    }
    const onsets = onsetEnvelope(peaks);
    let bpm = bpmOverride && bpmOverride >= 40 && bpmOverride <= 300 ? bpmOverride : (known?.bpm ?? null);
    let measured = false;
    if (!bpm) {
      const estimate = estimateTempo(onsets, PEAKS_PER_SECOND);
      if (!estimate || estimate.confidence < STEADY_BEAT) {
        toast.error("This music doesn't have a steady enough beat to snap to.", { id: toastId });
        return;
      }
      bpm = estimate.bpm;
      measured = true;
    }
    const phaseMs = beatPhaseMs(onsets, PEAKS_PER_SECOND, bpm);
    // Re-read the edit now: it may have changed while the audio was analysed.
    const latest = beatSyncMusic(found.clip.id);
    const composition = state().composition;
    const main = composition?.tracks.find((track) => track.kind === "visual");
    if (!latest || !composition || !main) return void toast.dismiss(toastId);
    const { clip } = latest;
    const beats = timelineBeats({ bpm, phaseMs, clipStartMs: clip.startMs, clipDurationMs: clip.durationMs, trimStartMs: clip.trimStartMs, playbackRate: clip.playbackRate });
    if (main.locked) {
      toast.error(`Unlock ${main.name} to move its cuts.`, { id: toastId });
      return;
    }
    const { ops, moved } = snapCutsToBeats(composition, { trackId: main.id, beats, fromMs: clip.startMs, toMs: clipEndMs(clip) });
    const tempo = `${Math.round(bpm)} BPM${measured ? ", measured" : ""}`;
    if (moved === 0) {
      toast.success(`Every cut is already on the beat (${tempo}).`, { id: toastId });
      return;
    }
    const ok = await run("Snap cuts to the beat", ops);
    if (ok) toast.success(`Cuts snapped to the beat (${tempo}). Undo puts them back.`, { id: toastId });
    else toast.dismiss(toastId);
  } catch (error) {
    toast.error(errorMessage(error), { id: toastId });
  } finally {
    syncing = false;
  }
}

// ── "Apply to all" offers ───────────────────────────────────────────────────

/**
 * After a change that people usually want everywhere (a transition, a filter,
 * a colour adjustment), a toast offers to repeat it on the rest of the track.
 * One toast at a time: a newer change replaces the offer, so they never pile up.
 * Taking it is one undoable step.
 */
const OFFER_TOAST = "crewcut-apply-to-all";
const OFFER_MS = 8000;

function offer(message: string, description: string, actionLabel: string, apply: () => void): void {
  toast(message, { id: OFFER_TOAST, description, duration: OFFER_MS, action: { label: actionLabel, onClick: apply } });
}

const sameTransition = (a: Transition | undefined, b: Transition | null) => (!a && !b) || (Boolean(a) && Boolean(b) && a?.type === b?.type && a?.durationMs === b?.durationMs && a?.direction === b?.direction);

/** Clips on a visual track that start right where the one before ends: the cuts a transition plays at. */
function cutClips(track: Track): VisualClip[] {
  if (track.kind !== "visual") return [];
  const clips = [...track.clips].sort((a, b) => a.startMs - b.startMs);
  return clips.filter((clip, index) => index > 0 && Math.abs(clipEndMs(clips[index - 1]!) - clip.startMs) <= 50);
}

/** Offers the transition just set on `clipId` for every other cut on its track. */
export function offerTransitionForAll(clipId: string): void {
  const composition = state().composition;
  const location = composition ? findClip(composition, clipId) : null;
  if (!location || location.track.kind !== "visual" || location.track.locked || !("layers" in location.clip)) return;
  const transition = location.clip.transitionIn ?? null;
  const clips = [...location.track.clips].sort((a, b) => a.startMs - b.startMs);
  const others = cutClips(location.track).filter((clip) => clip.id !== clipId && !sameTransition(clip.transitionIn, transition));
  if (others.length === 0) return;
  const label = transition ? (TRANSITION_CATALOG[transition.type]?.label ?? transition.type) : null;
  offer(
    label ? `${label} transition set` : "Transition removed",
    label ? `Use it on the other ${others.length} cut${others.length === 1 ? "" : "s"} too?` : `Remove the transitions on the other ${others.length} cut${others.length === 1 ? "" : "s"} too?`,
    label ? "Apply to all" : "Remove all",
    () => {
      const ops: CompositionOpInput[] = others.map((clip) => {
        if (!transition) return { op: "set-transition", clipId: clip.id, transition: null };
        // A transition can't outlast the clips on either side of its cut: shorten it where they're short.
        const index = clips.findIndex((candidate) => candidate.id === clip.id);
        const room = Math.min(clip.durationMs, clips[index - 1]?.durationMs ?? clip.durationMs) * 0.9;
        return { op: "set-transition", clipId: clip.id, transition: { ...transition, durationMs: Math.round(Math.max(100, Math.min(transition.durationMs, room))) } };
      });
      void run(label ? `${label} on every cut` : "Remove every transition", ops);
    },
  );
}

/**
 * Offers a clip's (or its photo/video's) filter or colour adjustment for the
 * other clips on the same track. The Crewcut ending card is left alone.
 */
export function offerLookForAll(target: { clipId: string; layerId?: string }, kind: "filter" | "adjust"): void {
  const composition = state().composition;
  const location = composition ? findClip(composition, target.clipId) : null;
  if (!location || location.track.kind !== "visual" || location.track.locked || !("layers" in location.clip)) return;
  const source = target.layerId ? findLayer(location.clip, target.layerId)?.layer : null;
  if (target.layerId && !source) return;
  const value = (source ?? location.clip)[kind] ?? null;
  const ops: CompositionOpInput[] = [];
  for (const clip of location.track.clips) {
    if (clip.id === location.clip.id || isCrewcutEnding(clip)) continue;
    if (target.layerId) {
      // A photo or video's look goes to the other clips' photos and videos.
      const solo = soloLayer(clip);
      if (!solo || (solo.type !== "image" && solo.type !== "video")) continue;
      if (JSON.stringify(solo[kind] ?? null) === JSON.stringify(value)) continue;
      ops.push({ op: "update-layer", clipId: clip.id, layerId: solo.id, patch: { [kind]: value } });
    } else {
      if (JSON.stringify(clip[kind] ?? null) === JSON.stringify(value)) continue;
      ops.push({ op: "update-clip", clipId: clip.id, patch: { [kind]: value } });
    }
  }
  if (ops.length === 0) return;
  const what = kind === "filter" ? (value ? "Filter" : "Filter removed") : value ? "Colour adjustment" : "Adjustments reset";
  const noun = target.layerId ? "photo or video" : "clip";
  offer(
    kind === "filter" && value ? "Filter applied" : what === "Colour adjustment" ? "Colour adjusted" : what,
    `${value ? "Use the same look on" : "Do the same for"} the other ${ops.length} ${noun}${ops.length === 1 ? "" : "s"} on this track?`,
    "Apply to all",
    () => void run(kind === "filter" ? "Same filter on every clip" : "Same colour on every clip", ops),
  );
}

export function applyMotion(clipId: string, layerIds: string[], presetId: string, mode: "enter" | "exit" = "enter"): void {
  const clip = state().composition ? findClip(state().composition as Composition, clipId)?.clip : undefined;
  const localMs = clip ? Math.max(0, playhead() - clip.startMs) : 0;
  void run(`Animation: ${presetId}`, [{ op: "apply-motion-preset", clipId, layerIds, presetId, mode, ...(mode === "enter" ? { atMs: localMs } : {}) }]);
}

export function setFormat(ratio: AspectRatio): void {
  void run(`Format ${ratio}`, [{ op: "set-format", ratio }]);
}

export function toggleTrack(track: Track, key: "hidden" | "locked" | "muted"): void {
  const current = key === "muted" ? track.kind !== "caption" && Boolean((track as { muted?: boolean }).muted) : track[key];
  const verb = key === "hidden" ? (current ? "Show" : "Hide") : key === "locked" ? (current ? "Unlock" : "Lock") : current ? "Unmute" : "Mute";
  void run(`${verb} ${track.name}`, [{ op: "set-track-state", trackId: track.id, patch: { [key]: !current } }]);
}

export function addTrack(spec: TrackSpec): void {
  void run("Add track", [{ op: "add-track", track: spec }]);
}

export function removeTrack(track: Track): void {
  void run(`Remove ${track.name}`, [{ op: "remove-track", trackId: track.id }]);
}

export function selectionContext(): Record<string, unknown> {
  const { videoId, version, playheadMs, selectedClipIds, inMs, outMs } = state();
  const selection = currentSelection();
  return {
    videoId,
    compositionVersion: version,
    playheadMs: Math.round(playheadMs),
    selectedClipIds,
    selection: selection.kind === "layer" ? { kind: "layer", clipId: selection.clip.id, layerId: selection.layer.id, type: selection.layer.type } : { kind: selection.kind },
    range: inMs !== null || outMs !== null ? { inMs, outMs } : null,
  };
}

// ── Transform edits (canvas drag, inspector) ────────────────────────────────

export type TransformProps = Partial<Record<import("@crewcut/composition").AnimatableProperty, number>>;

/**
 * Animated properties get a keyframe at the playhead (auto-key); static ones
 * are set directly. Returns ops for one undoable step.
 */
export function transformOps(clip: VisualClip, layer: Layer | LeafLayer, props: TransformProps): CompositionOpInput[] {
  const localMs = Math.round(state().playheadMs - clip.startMs - layer.startMs);
  const ops: CompositionOpInput[] = [];
  const statics: Record<string, number> = {};
  for (const [property, value] of Object.entries(props)) {
    if (value === undefined || !Number.isFinite(value)) continue;
    if (layer.keyframes[property as keyof typeof layer.keyframes]?.length) {
      ops.push({ op: "set-keyframe", clipId: clip.id, layerId: layer.id, property: property as never, atMs: localMs, value });
    } else {
      statics[property] = value;
    }
  }
  if (Object.keys(statics).length) ops.unshift({ op: "update-layer", clipId: clip.id, layerId: layer.id, patch: { transform: statics } });
  return ops;
}

export function layerPatchOps(clip: VisualClip, layer: Layer | LeafLayer, patch: Record<string, unknown>): CompositionOpInput[] {
  return [{ op: "update-layer", clipId: clip.id, layerId: layer.id, patch }];
}
