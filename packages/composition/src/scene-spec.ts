import { z } from "zod";

import { iconNameSchema, fillSchema, layerSchema, transitionPatchSchema } from "./schema";

/** Zod mirror of `SceneSpec` (recipes), for actions and model output. */
export const sceneSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("headline"), lines: z.array(z.string().min(1).max(80)).min(1).max(3), eyebrow: z.string().max(40).optional() }),
  z.object({ kind: z.literal("title"), name: z.string().min(1).max(60), tagline: z.string().max(100).optional(), eyebrow: z.string().max(40).optional() }),
  z.object({
    kind: z.literal("big-number"),
    value: z.number(),
    label: z.string().min(1).max(40),
    line: z.string().max(100).optional(),
    prefix: z.string().max(6).optional(),
    suffix: z.string().max(8).optional(),
    decimals: z.number().int().min(0).max(4).optional(),
  }),
  z.object({
    kind: z.literal("cards"),
    heading: z.string().max(60).optional(),
    cards: z.array(z.object({ icon: iconNameSchema, title: z.string().min(1).max(32), line: z.string().min(1).max(90) })).min(2).max(4),
  }),
  z.object({
    kind: z.literal("code"),
    code: z.string().min(1).max(1600),
    language: z.string().min(1).max(24),
    title: z.string().max(80).optional(),
    caption: z.string().max(90).optional(),
    highlightLines: z.array(z.number().int().positive()).optional(),
    source: z.object({ path: z.string(), lineStart: z.number().int().positive(), lineEnd: z.number().int().positive() }).optional(),
  }),
  z.object({ kind: z.literal("list"), lead: z.string().max(60).optional(), items: z.array(z.string().min(1).max(60)).min(2).max(6) }),
  z.object({
    kind: z.literal("flow"),
    heading: z.string().max(60).optional(),
    nodes: z.array(z.object({ icon: iconNameSchema.optional(), label: z.string().min(1).max(28), detail: z.string().max(50).optional() })).min(2).max(5),
  }),
  z.object({ kind: z.literal("quote"), quote: z.string().min(3).max(200), attribution: z.string().max(80).optional() }),
  z.object({
    kind: z.literal("chart"),
    heading: z.string().max(60).optional(),
    chart: z.enum(["bar", "line", "donut"]),
    data: z.array(z.object({ label: z.string().max(40), value: z.number() })).min(2).max(12),
    suffix: z.string().max(8).optional(),
  }),
  z.object({ kind: z.literal("image"), src: z.string().min(1), caption: z.string().max(90).optional(), alt: z.string().max(200).optional() }),
  z.object({ kind: z.literal("end"), name: z.string().min(1).max(60), cta: z.string().min(1).max(32), url: z.string().max(80).optional() }),
]);

/** One scene for compose-video: a recipe, freeform layers, or both (layers draw above the recipe). */
export const composeSceneSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_.:-]+$/).optional(),
  name: z.string().max(80).optional(),
  durationMs: z.number().min(500).max(120_000).default(4000),
  beatId: z.string().optional(),
  lineIds: z.array(z.string()).default([]),
  claimIds: z.array(z.string()).default([]),
  transition: transitionPatchSchema.nullable().optional(),
  timing: z.enum(["narration", "manual"]).default("narration"),
  recipe: sceneSpecSchema.optional(),
  layers: z.array(z.lazy(() => layerSchema)).max(80).optional(),
  background: fillSchema.optional(),
});
export type ComposeSceneSpec = z.infer<typeof composeSceneSchema>;
