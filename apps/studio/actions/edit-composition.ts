import { defineAction } from "@agent-native/core/action";
import {
  type Composition,
  type LayerInput,
  type LayerPatch,
  addLayer,
  alignLayers,
  animatablePropertySchema,
  applyMotionPreset,
  deleteClips,
  distributeLayers,
  easingSchema,
  envelopePointSchema,
  groupLayers,
  moveClip,
  moveKeyframes,
  nudgeLayers,
  removeKeyframe,
  removeLayers,
  removeMarker,
  reorderLayer,
  setKeyframe,
  setMarker,
  setTrackState,
  setTransition,
  setVolumeEnvelope,
  splitClip,
  transitionSchema,
  trimClip,
  updateLayer,
} from "@proofcut/composition";
import { z } from "zod";

import { runCompositionEdit } from "../server/lib/composition-action.js";

const target = z.object({ clipId: z.string(), layerId: z.string() });

const opSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("trim-clip"), clipId: z.string(), edge: z.enum(["start", "end"]), toMs: z.number().min(0), ripple: z.boolean().default(false) }),
  z.object({ op: z.literal("move-clip"), clipId: z.string(), startMs: z.number().min(0), trackId: z.string().optional() }),
  z.object({ op: z.literal("split-clip"), clipId: z.string(), atMs: z.number().min(0) }),
  z.object({ op: z.literal("delete-clips"), clipIds: z.array(z.string()).min(1), ripple: z.boolean().default(false) }),
  z.object({ op: z.literal("set-keyframe"), clipId: z.string(), layerId: z.string(), property: animatablePropertySchema, atMs: z.number(), value: z.number(), easing: easingSchema.optional() }),
  z.object({ op: z.literal("remove-keyframe"), clipId: z.string(), layerId: z.string(), property: animatablePropertySchema, atMs: z.number() }),
  z.object({ op: z.literal("move-keyframes"), clipId: z.string(), layerId: z.string(), fromMs: z.number(), toMs: z.number(), property: animatablePropertySchema.optional() }),
  z.object({ op: z.literal("update-layer"), clipId: z.string(), layerId: z.string(), patch: z.record(z.string(), z.unknown()) }),
  z.object({ op: z.literal("add-layer"), clipId: z.string(), layer: z.object({ type: z.string() }).passthrough(), index: z.number().int().min(0).optional() }),
  z.object({ op: z.literal("remove-layers"), clipId: z.string(), layerIds: z.array(z.string()).min(1) }),
  z.object({ op: z.literal("reorder-layer"), clipId: z.string(), layerId: z.string(), toIndex: z.number().int().min(0) }),
  z.object({ op: z.literal("nudge-layers"), targets: z.array(target).min(1), dxPx: z.number(), dyPx: z.number() }),
  z.object({ op: z.literal("align-layers"), targets: z.array(target).min(1), edge: z.enum(["left", "center", "right", "top", "middle", "bottom"]) }),
  z.object({ op: z.literal("distribute-layers"), targets: z.array(target).min(3), axis: z.enum(["horizontal", "vertical"]) }),
  z.object({ op: z.literal("group-layers"), clipId: z.string(), layerIds: z.array(z.string()).min(2), name: z.string().optional() }),
  z.object({ op: z.literal("apply-motion-preset"), clipId: z.string(), layerIds: z.array(z.string()).min(1), presetId: z.string(), mode: z.enum(["enter", "exit"]).default("enter"), atMs: z.number().optional(), durationMs: z.number().optional(), staggerMs: z.number().optional() }),
  z.object({ op: z.literal("set-transition"), clipId: z.string(), transition: transitionSchema.partial().nullable() }),
  z.object({ op: z.literal("set-marker"), id: z.string().optional(), atMs: z.number().min(0), label: z.string().max(60).optional(), color: z.string().optional() }),
  z.object({ op: z.literal("remove-marker"), id: z.string() }),
  z.object({ op: z.literal("set-track-state"), trackId: z.string(), patch: z.object({ hidden: z.boolean().optional(), locked: z.boolean().optional(), muted: z.boolean().optional(), volume: z.number().min(0).max(2).optional(), name: z.string().max(60).optional() }) }),
  z.object({ op: z.literal("set-volume-envelope"), clipId: z.string(), points: z.array(envelopePointSchema).max(512) }),
]);
type Op = z.infer<typeof opSchema>;

function applyOp(composition: Composition, op: Op): Composition {
  switch (op.op) {
    case "trim-clip":
      return trimClip(composition, op);
    case "move-clip":
      return moveClip(composition, op);
    case "split-clip":
      return splitClip(composition, op).composition;
    case "delete-clips":
      return deleteClips(composition, op);
    case "set-keyframe":
      return setKeyframe(composition, op);
    case "remove-keyframe":
      return removeKeyframe(composition, op);
    case "move-keyframes":
      return moveKeyframes(composition, op);
    case "update-layer":
      return updateLayer(composition, { clipId: op.clipId, layerId: op.layerId, patch: op.patch as LayerPatch });
    case "add-layer":
      return addLayer(composition, { clipId: op.clipId, layer: op.layer as LayerInput, ...(op.index !== undefined ? { index: op.index } : {}) }).composition;
    case "remove-layers":
      return removeLayers(composition, op);
    case "reorder-layer":
      return reorderLayer(composition, op);
    case "nudge-layers":
      return nudgeLayers(composition, op);
    case "align-layers":
      return alignLayers(composition, op);
    case "distribute-layers":
      return distributeLayers(composition, op);
    case "group-layers":
      return groupLayers(composition, op).composition;
    case "apply-motion-preset":
      return applyMotionPreset(composition, op);
    case "set-transition":
      return setTransition(composition, op);
    case "set-marker":
      return setMarker(composition, op);
    case "remove-marker":
      return removeMarker(composition, op);
    case "set-track-state":
      return setTrackState(composition, op);
    case "set-volume-envelope":
      return setVolumeEnvelope(composition, op);
  }
}

export default defineAction({
  description:
    "Apply several composition edits as ONE undoable step (e.g. 'make the hook punchier' = shorten a clip, retime keyframes, swap a preset). Ops run in order; if any fails, nothing is saved.",
  schema: z.object({
    videoId: z.string(),
    label: z.string().min(2).max(120).describe("What this step did, shown in history"),
    ops: z.array(opSchema).min(1).max(60),
    returnFull: z.boolean().default(false),
  }),
  run: async ({ videoId, label, ops, returnFull }, ctx) =>
    runCompositionEdit(ctx, videoId, label, (composition) => ops.reduce(applyOp, composition), { returnFull }),
});
