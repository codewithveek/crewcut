import { type AnyClip, type FilterPreset, type Track, findClip } from "@crewcut/composition";
import { toast } from "sonner";

import { errorMessage } from "@/lib/crewcut";

import { addElementAt, addLibraryAudioAt, addMediaAt, applyFilter, applyMotion, applyTransition, soloLayer } from "./commands";
import { useEditor } from "./editor-store";
import { type DragPayload, uploadMedia } from "./media";

/** Where something was dropped: a time, and optionally the track/clip under the pointer. */
export interface DropTarget {
  atMs: number;
  track?: Track | undefined;
  clip?: AnyClip | undefined;
  /** The preview canvas: media lands as an overlay, effects hit the clip under the playhead. */
  surface: "timeline" | "preview" | "new-track";
}

function mainTrackId(): string | undefined {
  return useEditor.getState().composition?.tracks.find((track) => track.kind === "visual")?.id;
}

function visualClipUnderPlayhead(): { clipId: string; layerId?: string } | null {
  const { composition, playheadMs, selectedClipIds, selectedLayer } = useEditor.getState();
  if (!composition) return null;
  if (selectedLayer) return selectedLayer;
  const selected = selectedClipIds[0] ? findClip(composition, selectedClipIds[0]) : null;
  if (selected && "layers" in selected.clip) return { clipId: selected.clip.id };
  for (const track of [...composition.tracks].reverse()) {
    if (track.kind !== "visual" || track.hidden) continue;
    const clip = track.clips.find((candidate) => playheadMs >= candidate.startMs && playheadMs < candidate.startMs + candidate.durationMs);
    if (clip) return { clipId: clip.id };
  }
  return null;
}

export async function dropPayload(payload: DragPayload, target: DropTarget): Promise<void> {
  const track = target.track;
  const atMs = Math.max(0, target.atMs);
  switch (payload.type) {
    case "asset": {
      const asset = payload.asset;
      if (asset.mediaType === "audio") {
        await addMediaAt(asset, atMs, track?.kind === "audio" ? { trackId: track.id } : {});
        return;
      }
      if (target.surface === "preview" || target.surface === "new-track") {
        await addMediaAt(asset, atMs, { mode: "overlay" });
        return;
      }
      const isMain = track?.id === mainTrackId();
      await addMediaAt(asset, atMs, track?.kind === "visual" ? { trackId: track.id, mode: isMain ? "auto" : "overlay" } : {});
      return;
    }
    case "library":
      await addLibraryAudioAt(payload.item, atMs, track?.kind === "audio" ? { trackId: track.id } : {});
      return;
    case "element": {
      const trackId = track?.kind === "visual" && track.id !== mainTrackId() && target.surface === "timeline" ? track.id : undefined;
      await addElementAt(payload.layer, atMs, trackId ? { trackId } : {});
      return;
    }
    case "transition": {
      const clip = target.clip && "layers" in target.clip ? target.clip : null;
      const fallback = clip ? null : visualClipUnderPlayhead();
      const clipId = clip?.id ?? fallback?.clipId;
      if (!clipId) {
        toast.message("Drop a transition onto the clip it should lead into.");
        return;
      }
      applyTransition(clipId, payload.transition);
      return;
    }
    case "motion": {
      const clip = target.clip && "layers" in target.clip ? target.clip : null;
      const ref = clip ? { clipId: clip.id } : visualClipUnderPlayhead();
      const composition = useEditor.getState().composition;
      const location = ref && composition ? findClip(composition, ref.clipId) : null;
      if (!location || !("layers" in location.clip)) {
        toast.message("Drop an animation onto a clip, or select a layer first.");
        return;
      }
      const layerIds = "layerId" in (ref ?? {}) && (ref as { layerId?: string }).layerId ? [(ref as { layerId: string }).layerId] : location.clip.layers.filter((layer) => layer.type !== "camera").map((layer) => layer.id);
      if (layerIds.length === 0) return;
      applyMotion(location.clip.id, layerIds, payload.presetId);
      return;
    }
    case "filter": {
      const clip = target.clip && "layers" in target.clip ? target.clip : null;
      const ref = clip ? { clipId: clip.id, ...(soloLayer(clip) ? { layerId: soloLayer(clip)?.id } : {}) } : visualClipUnderPlayhead();
      if (!ref) {
        toast.message("Drop a filter onto a clip.");
        return;
      }
      applyFilter(ref as { clipId: string; layerId?: string }, payload.preset === "none" ? null : (payload.preset as FilterPreset));
      return;
    }
  }
}

/** Files dragged in from the desktop: upload to this video, then place each one after the last. */
export async function dropFiles(files: FileList | File[], target: DropTarget): Promise<void> {
  const list = Array.from(files).slice(0, 12);
  if (list.length === 0) return;
  const { videoId } = useEditor.getState();
  const toastId = toast.loading(list.length === 1 ? `Uploading ${list[0]?.name}…` : `Uploading ${list.length} files…`);
  let cursor = target.atMs;
  try {
    for (const file of list) {
      const asset = await uploadMedia(file, { videoId });
      await dropPayload({ type: "asset", asset }, { ...target, atMs: cursor });
      cursor += asset.mediaType === "image" ? 5000 : (asset.durationMs ?? 5000);
    }
    toast.success(list.length === 1 ? "Added to the timeline" : `${list.length} files added`, { id: toastId });
  } catch (error) {
    toast.error(errorMessage(error), { id: toastId });
  }
}
