import { defineAction } from "@agent-native/core/action";
import {
  FRAME_SIZE,
  aspectRatioSchema,
  buildTemplate,
  closestRatioOf,
  closestTemplateRatio,
  compositionAssetIds,
  fillTemplateSlots,
  getTemplate,
  remapAssetRefs,
  withCrewcutEnding,
} from "@crewcut/composition";
import { initialStageStates } from "@crewcut/pipeline";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { type ResolvedItem, variantOf, variantRatios, visibleItems } from "../server/lib/catalog.js";
import { identity } from "../server/lib/identity.js";
import { toJson } from "../server/lib/json.js";
import { newId } from "../server/lib/storage.js";
import { brandNewVideo } from "../server/lib/brand.js";
import { ensureDefaultProject, loadVideo, ownership, saveComposition } from "../server/lib/store.js";
import { attachTemplateMusic, importStockPhoto, stockPicks } from "../server/lib/templates.js";
import { UserError } from "../server/lib/errors.js";

const PRO_NOTE = "This is a Pro template: you can edit it freely; exporting it needs Crewcut Pro.";

export default defineAction({
  description:
    "Start a project from a template (see list-templates; its id, built-in or saved): the template's design in the chosen ratio, with your words and photos in its slots. values maps slot ids to text, or for photo slots to `asset:<id>` from the media library. Built-in templates fill empty photo slots with their stock photos (downloaded into the project with credit) unless useStock is false; saved templates keep their own photos. Text slots left empty keep the sample copy, so write real copy for each text slot. Every layer stays editable. Returns the editor path.",
  schema: z.object({
    templateId: z.string(),
    ratio: aspectRatioSchema,
    title: z.string().trim().min(1).max(120).optional(),
    values: z.record(z.string(), z.string().max(600)).default({}),
    useStock: z.boolean().default(true),
  }),
  run: async ({ templateId, ratio, title, values, useStock }, ctx) => {
    const who = identity(ctx);
    const items = await visibleItems(who, ["template"]);
    const entry = items.find((candidate) => candidate.item.id === templateId || (candidate.payload.type === "builtin" && candidate.payload.templateId === templateId));
    if (!entry) throw new UserError(`No template "${templateId}". Call list-templates for the ids.`);
    if (entry.payload.type === "data") return useDataTemplate(entry, { ratio, title, values }, ctx);
    if (entry.payload.type !== "builtin") throw new UserError(`"${templateId}" isn't a template.`);

    const template = getTemplate(entry.payload.templateId);
    if (!template) throw new UserError(`No template "${templateId}". Call list-templates for the ids.`);
    const unknown = Object.keys(values).filter((slotId) => !template.slots.some((slot) => slot.id === slotId));
    if (unknown.length) throw new UserError(`Template "${templateId}" has no slot ${unknown.map((slot) => `"${slot}"`).join(", ")}.`);
    const designed = closestTemplateRatio(template, ratio);
    const project = await ensureDefaultProject(who);
    const id = newId("vid");
    const seed = Math.floor(Math.random() * 1_000_000) + 1;
    const portrait = FRAME_SIZE[designed].height > FRAME_SIZE[designed].width;
    const name = title ?? entry.item.name;
    await getDb()
      .insert(schema.videos)
      .values({ id, projectId: project.id, title: name, brief: "", ratio: designed, platforms: toJson([portrait ? "youtube_shorts" : "youtube"]), stages: toJson(initialStageStates()), seed, ...ownership(who) });
    const video = await loadVideo(id, ctx, "editor");
    const owner = { videoId: id, ownerEmail: video.row.ownerEmail, orgId: video.row.orgId };

    // Photo slots without a value get the template's stock pick, imported with its credit.
    const filled: Record<string, string> = { ...values };
    const notes: string[] = [];
    if (useStock) {
      const picks = await stockPicks(template, designed);
      for (const slot of template.slots) {
        if (slot.kind !== "photo" || filled[slot.id]) continue;
        const photo = picks[slot.id];
        if (!photo) continue;
        try {
          filled[slot.id] = await importStockPhoto(photo, owner);
        } catch (error) {
          // Logged with the reason, so a server's logs show why (download refused, storage upload failed…).
          console.warn(`[use-template] ${template.id}: stock photo for "${slot.id}" (Pexels ${photo.id}) wasn't imported`, error);
          notes.push(`${slot.label} kept its placeholder (the stock photo didn't download).`);
        }
      }
    }
    const music = await attachTemplateMusic(template, owner);
    // New videos end with the Crewcut ending (a normal clip: delete it, or switch it off in Export).
    const composition = await brandNewVideo(
      withCrewcutEnding(
        buildTemplate(template, {
          id,
          title: name,
          ratio: designed,
          values: filled,
          seed,
          ...(music ? { music: { src: `asset:${music.assetId}`, label: music.label, assetId: music.assetId } } : {}),
        }),
      ),
      video.row,
      "templates",
    );
    const version = await saveComposition(video, composition, `From template: ${entry.item.name}`);
    if (entry.tier === "pro") notes.push(PRO_NOTE);
    return {
      videoId: id,
      version,
      ratio: designed,
      path: `/videos/${id}/edit`,
      tier: entry.tier,
      ...(designed !== ratio ? { note: `${entry.item.name} isn't designed for ${ratio}; used ${designed}.` } : {}),
      ...(notes.length ? { notes } : {}),
      hasMusic: Boolean(music),
    };
  },
});

/** A saved (data) template: its composition for the closest format, with its media copied into the new project and the values in its slots. */
async function useDataTemplate(entry: ResolvedItem, input: { ratio: z.infer<typeof aspectRatioSchema>; title?: string | undefined; values: Record<string, string> }, ctx: Parameters<typeof identity>[0]) {
  if (entry.payload.type !== "data") throw new UserError("Not a saved template.");
  const payload = entry.payload;
  const unknown = Object.keys(input.values).filter((slotId) => !payload.slots.some((slot) => slot.id === slotId));
  if (unknown.length) throw new UserError(`Template "${entry.item.name}" has no slot ${unknown.map((slot) => `"${slot}"`).join(", ")}.`);
  const designed = closestRatioOf(variantRatios(payload), input.ratio);
  const variant = designed ? variantOf(payload, designed) : null;
  if (!designed || !variant) throw new UserError(`“${entry.item.name}” couldn't be opened. Ask whoever saved it to save it again.`);
  const who = identity(ctx);
  const project = await ensureDefaultProject(who);
  const id = newId("vid");
  const seed = Math.floor(Math.random() * 1_000_000) + 1;
  const portrait = FRAME_SIZE[designed].height > FRAME_SIZE[designed].width;
  const name = input.title ?? entry.item.name;
  const db = getDb();
  await db
    .insert(schema.videos)
    .values({ id, projectId: project.id, title: name, brief: "", ratio: designed, platforms: toJson([portrait ? "youtube_shorts" : "youtube"]), stages: toJson(initialStageStates()), seed, ...ownership(who) });
  const video = await loadVideo(id, ctx, "editor");

  // The project gets its own asset rows for the template's (shared, never-deleted) files.
  const used = new Set(compositionAssetIds(variant));
  const remap: Record<string, string> = {};
  for (const [assetId, media] of Object.entries(payload.media)) {
    if (!used.has(assetId)) continue;
    const copy = newId("ast");
    await db.insert(schema.assets).values({
      id: copy,
      videoId: id,
      kind: media.kind,
      label: media.label,
      fileName: media.fileName,
      mime: media.mime,
      bytes: media.bytes,
      durationMs: media.durationMs,
      licence: toJson(media.licence),
      provenance: toJson({ ...media.provenance, fromTemplate: entry.item.id, ...(entry.tier === "pro" ? { catalogTier: "pro", catalogName: entry.item.name } : {}) }),
      ownerEmail: video.row.ownerEmail,
      orgId: video.row.orgId,
    });
    remap[assetId] = copy;
  }
  const filled = fillTemplateSlots(remapAssetRefs(variant, remap), input.values);
  const composition = await brandNewVideo(withCrewcutEnding({ ...filled, id, title: name, seed, brief: { ...filled.brief, basedOn: `template:${entry.item.id}` } }), video.row, "templates");
  const version = await saveComposition(video, composition, `From template: ${entry.item.name}`);
  const notes = entry.tier === "pro" ? [PRO_NOTE] : [];
  return {
    videoId: id,
    version,
    ratio: designed,
    path: `/videos/${id}/edit`,
    tier: entry.tier,
    ...(designed !== input.ratio ? { note: `${entry.item.name} isn't designed for ${input.ratio}; used ${designed}.` } : {}),
    ...(notes.length ? { notes } : {}),
    hasMusic: Object.values(payload.media).some((media) => media.mime.startsWith("audio/")),
  };
}
