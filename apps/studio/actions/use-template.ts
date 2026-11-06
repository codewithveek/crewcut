import { defineAction } from "@agent-native/core/action";
import { FRAME_SIZE, aspectRatioSchema, buildTemplate, closestTemplateRatio, getTemplate } from "@crewcut/composition";
import { initialStageStates } from "@crewcut/pipeline";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { identity } from "../server/lib/identity.js";
import { toJson } from "../server/lib/json.js";
import { newId } from "../server/lib/storage.js";
import { ensureDefaultProject, loadVideo, ownership, saveComposition } from "../server/lib/store.js";
import { attachTemplateMusic, importStockPhoto, stockPicks } from "../server/lib/templates.js";

export default defineAction({
  description:
    "Start a project from a template (see list-templates): the template's design in the chosen ratio, with your words and photos in its slots. values maps slot ids to text, or for photo slots to `asset:<id>` from the media library. Photo slots left empty get the template's stock photo (downloaded into the project with credit) unless useStock is false; text slots left empty keep the sample copy, so write real copy for each text slot. Every layer stays editable. Returns the editor path.",
  schema: z.object({
    templateId: z.string(),
    ratio: aspectRatioSchema,
    title: z.string().trim().min(1).max(120).optional(),
    values: z.record(z.string(), z.string().max(600)).default({}),
    useStock: z.boolean().default(true),
  }),
  run: async ({ templateId, ratio, title, values, useStock }, ctx) => {
    const template = getTemplate(templateId);
    if (!template) throw new Error(`No template "${templateId}". Call list-templates for the ids.`);
    const unknown = Object.keys(values).filter((slotId) => !template.slots.some((slot) => slot.id === slotId));
    if (unknown.length) throw new Error(`Template "${templateId}" has no slot ${unknown.map((slot) => `"${slot}"`).join(", ")}.`);
    const designed = closestTemplateRatio(template, ratio);
    const who = identity(ctx);
    const project = await ensureDefaultProject(who);
    const id = newId("vid");
    const seed = Math.floor(Math.random() * 1_000_000) + 1;
    const portrait = FRAME_SIZE[designed].height > FRAME_SIZE[designed].width;
    const name = title ?? template.name;
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
        } catch {
          notes.push(`${slot.label} kept its placeholder (the stock photo didn't download).`);
        }
      }
    }
    const music = await attachTemplateMusic(template, owner);
    const composition = (buildTemplate(template, {
      id,
      title: name,
      ratio: designed,
      values: filled,
      seed,
      ...(music ? { music: { src: `asset:${music.assetId}`, label: music.label, assetId: music.assetId } } : {}),
    }));
    const version = await saveComposition(video, composition, `From template: ${template.name}`);
    return {
      videoId: id,
      version,
      ratio: designed,
      path: `/videos/${id}/edit`,
      ...(designed !== ratio ? { note: `${template.name} isn't designed for ${ratio}; used ${designed}.` } : {}),
      ...(notes.length ? { notes } : {}),
      hasMusic: Boolean(music),
    };
  },
});
