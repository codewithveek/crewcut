import { type Composition, type CompositionOpInput, type SubjectSample, cropAxis, focusKeyframes } from "@crewcut/composition";
import { toast } from "sonner";

import { errorMessage } from "@/lib/crewcut";

import { run } from "./commands";
import { useEditor } from "./editor-store";
import { trackSubject } from "./subject-tracking";

/**
 * Auto reframe: every video whose shape differs from its box (a wide video
 * in a vertical format, say) fills the box ("Fill") with a crop that follows
 * its subject over time, instead of showing bars or the middle. The analysis
 * runs in this browser; the result is one undoable edit.
 */

/** Samples per second while following, and the most samples per video. */
const STEP_MS = 333;
const MAX_SAMPLES = 360;

interface Target {
  clipId: string;
  layerId: string;
  name: string;
  url: string;
  trimStartMs: number;
  playbackRate: number;
  loop: boolean;
  durationMs: number;
  boxAspect: number;
  fit: "cover" | "contain";
}

/** Video layers with a box, optionally only one (whether they need a crop is known once the video's shape is read). */
export function reframeTargets(composition: Composition, assetUrls: Record<string, string>, only?: { clipId: string; layerId: string }): Target[] {
  const targets: Target[] = [];
  for (const track of composition.tracks) {
    if (track.kind !== "visual") continue;
    for (const clip of track.clips) {
      if (only && clip.id !== only.clipId) continue;
      for (const layer of clip.layers) {
        if (layer.type !== "video") continue;
        if (only && layer.id !== only.layerId) continue;
        const { width, height } = layer.transform;
        if (!width || !height) continue;
        const url = layer.src.startsWith("asset:") ? assetUrls[layer.src.slice(6)] : /^https:\/\//.test(layer.src) ? layer.src : undefined;
        if (!url) continue;
        const durationMs = Math.max(0, layer.durationMs ?? clip.durationMs - layer.startMs);
        if (durationMs <= 0) continue;
        targets.push({
          clipId: clip.id,
          layerId: layer.id,
          name: layer.name || clip.name || "Video",
          url,
          trimStartMs: layer.trimStartMs,
          playbackRate: layer.playbackRate,
          loop: layer.loop,
          durationMs,
          boxAspect: ((width / 100) * composition.width) / ((height / 100) * composition.height),
          fit: layer.fit,
        });
      }
    }
  }
  return targets;
}

let reframing: AbortController | null = null;

export async function autoReframe(only?: { clipId: string; layerId: string }): Promise<void> {
  const { composition, assetUrls } = useEditor.getState();
  if (!composition) return;
  if (reframing) {
    toast.message("Auto reframe is already running.");
    return;
  }
  const targets = reframeTargets(composition, assetUrls, only);
  if (targets.length === 0) {
    toast.message(only ? "That video can't be reframed (it has no box to fill)." : "No videos to reframe.");
    return;
  }
  const controller = new AbortController();
  reframing = controller;
  const toastId = toast.loading(`Following the subject in ${targets.length} video${targets.length === 1 ? "" : "s"}…`, {
    action: { label: "Stop", onClick: () => controller.abort() },
  });
  const ops: CompositionOpInput[] = [];
  const skipped: string[] = [];
  try {
    for (const [index, target] of targets.entries()) {
      const step = Math.max(STEP_MS, target.durationMs / MAX_SAMPLES);
      const localTimes: number[] = [];
      for (let at = 0; at < target.durationMs; at += step) localTimes.push(Math.round(at));
      // Source time for each moment of the layer (trim, speed); loops are folded in once the length is known.
      const toSource = (localMs: number) => target.trimStartMs + localMs * target.playbackRate;
      let result;
      try {
        result = await trackSubject(target.url, localTimes.map(toSource), {
          signal: controller.signal,
          onProgress: (fraction) => toast.loading(`Following the subject: ${target.name} (${index + 1} of ${targets.length}), ${Math.round(fraction * 100)}%`, { id: toastId, action: { label: "Stop", onClick: () => controller.abort() } }),
        });
      } catch (error) {
        if (controller.signal.aborted) throw error;
        skipped.push(`${target.name}: ${errorMessage(error)}`);
        continue;
      }
      if (target.loop && Number.isFinite(result.durationMs) && result.durationMs > target.trimStartMs) {
        // A looping layer replays the same stretch: sample times past the end wrap round.
        const period = result.durationMs - target.trimStartMs;
        result = await trackSubject(target.url, localTimes.map((localMs) => target.trimStartMs + ((localMs * target.playbackRate) % period)), { signal: controller.signal });
      }
      const crop = cropAxis(result.aspect, target.boxAspect);
      if (!crop.axis) {
        skipped.push(`${target.name}: it already has the frame's shape`);
        continue;
      }
      const samples: SubjectSample[] = result.samples.map((sample, i) => ({ atMs: localTimes[i] ?? 0, x: sample.x, y: sample.y, weight: sample.weight }));
      const keyframes = focusKeyframes(samples, crop.axis, { visible: crop.visible });
      if (keyframes.length === 0) continue;
      const property = crop.axis === "x" ? "focusX" : "focusY";
      const other = crop.axis === "x" ? "focusY" : "focusX";
      ops.push({
        op: "update-layer",
        clipId: target.clipId,
        layerId: target.layerId,
        // One keyframe means it never needs to move: a fixed crop is enough.
        patch: {
          fit: "cover",
          transform: { [property]: keyframes[0]!.value, [other]: 50 },
          keyframes: { [property]: keyframes.length > 1 ? keyframes : [], [other]: [] },
        },
      });
    }
    if (ops.length === 0) {
      toast.error(skipped.length ? `Nothing was reframed. ${skipped.join(" · ")}` : "Nothing was reframed.", { id: toastId });
      return;
    }
    const ok = await run(ops.length === 1 ? "Auto reframe" : `Auto reframe (${ops.length} videos)`, ops);
    if (ok) toast.success(`Reframed ${ops.length} video${ops.length === 1 ? "" : "s"} to follow the subject`, { id: toastId, description: skipped.length ? `Skipped: ${skipped.join(" · ")}` : "Undo puts the centred crop back." });
    else toast.dismiss(toastId);
  } catch (error) {
    if (controller.signal.aborted) toast.message("Auto reframe stopped. Nothing changed.", { id: toastId });
    else toast.error(errorMessage(error), { id: toastId });
  } finally {
    reframing = null;
  }
}
