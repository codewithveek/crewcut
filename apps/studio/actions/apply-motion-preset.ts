import { defineAction } from "@agent-native/core/action";
import { MOTION_PRESETS, TRANSITION_PRESETS, applyMotionPreset, setTransition } from "@crewcut/composition";
import { z } from "zod";

import { runCompositionEdit } from "../server/lib/composition-action.js";
import { UserError } from "../server/lib/errors.js";

const PRESET_IDS = [...MOTION_PRESETS.map((preset) => preset.id), ...TRANSITION_PRESETS.map((preset) => `transition:${preset.id}`)];

export default defineAction({
  description: `Apply a motion preset — it writes ordinary keyframes the person can edit afterwards; exits mirror their entrance. Layer presets: ${MOTION_PRESETS.map((preset) => `${preset.id} (${preset.group})`).join(", ")}. Clip transitions: ${TRANSITION_PRESETS.map((preset) => `transition:${preset.id}`).join(", ")}.`,
  schema: z.object({
    videoId: z.string(),
    clipId: z.string(),
    layerIds: z.array(z.string()).default([]),
    presetId: z.string().refine((id) => PRESET_IDS.includes(id), "Unknown preset"),
    mode: z.enum(["enter", "exit"]).default("enter"),
    atMs: z.number().optional(),
    durationMs: z.number().min(50).max(20_000).optional(),
    direction: z.enum(["left", "right", "up", "down"]).optional(),
    staggerMs: z.number().min(0).max(400).optional(),
    returnFull: z.boolean().default(false),
  }),
  run: async ({ videoId, returnFull, ...input }, ctx) =>
    runCompositionEdit(
      ctx,
      videoId,
      `${input.presetId}${input.mode === "exit" ? " (exit)" : ""} on ${input.layerIds.length ? input.layerIds.join(", ") : input.clipId}`,
      (c) => {
        if (input.presetId.startsWith("transition:")) {
          const preset = TRANSITION_PRESETS.find((candidate) => `transition:${candidate.id}` === input.presetId);
          if (!preset) throw new UserError("Unknown transition preset");
          return setTransition(c, {
            clipId: input.clipId,
            transition: {
              ...preset.transition,
              ...(input.durationMs ? { durationMs: input.durationMs } : {}),
              ...(input.direction ? { direction: input.direction } : {}),
            },
          });
        }
        if (input.layerIds.length === 0) throw new UserError("Pick at least one layer.");
        return applyMotionPreset(c, {
          clipId: input.clipId,
          layerIds: input.layerIds,
          presetId: input.presetId,
          mode: input.mode,
          ...(input.atMs !== undefined ? { atMs: input.atMs } : {}),
          ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
          ...(input.direction ? { direction: input.direction } : {}),
          ...(input.staggerMs !== undefined ? { staggerMs: input.staggerMs } : {}),
        });
      },
      { returnFull },
    ),
});
