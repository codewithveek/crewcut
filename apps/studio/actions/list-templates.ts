import { defineAction } from "@agent-native/core/action";
import { TEMPLATE_CATEGORIES, TEMPLATE_CATEGORY_LABELS, TEMPLATES, aspectRatioSchema, searchTemplates, templateDurationMs } from "@crewcut/composition";
import { stockCredit } from "@crewcut/stock";
import { z } from "zod";

import { fileUrl } from "../server/lib/blob-store.js";
import { stockPicks, templateMusicFile, templateMusicReady } from "../server/lib/templates.js";

export default defineAction({
  description:
    "Search the template library: hand-designed videos (photo stories, product promos, quotes…) with text and photo slots, each laid out for specific ratios. query matches names, descriptions and tags; ratio and category filter. Each result lists its slots (ids, sample copy, length limits) and preview photos per ratio. Start a project from one with use-template.",
  schema: z.object({
    query: z.string().max(120).optional(),
    ratio: aspectRatioSchema.optional(),
    category: z.enum(TEMPLATE_CATEGORIES).optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ query, ratio, category }) => {
    const found = searchTemplates({ ...(query ? { query } : {}), ...(ratio ? { ratio } : {}), ...(category ? { category } : {}) });
    const templates = await Promise.all(
      found.map(async (template) => {
        const ratios = ratio ? [ratio] : [...template.ratios];
        const previews = Object.fromEntries(
          await Promise.all(
            ratios.map(async (entry) => {
              const picks = await stockPicks(template, entry);
              return [
                entry,
                {
                  values: Object.fromEntries(Object.entries(picks).map(([slotId, photo]) => [slotId, photo.previewUrl])),
                  credits: Object.values(picks).map((photo) => ({ text: stockCredit(photo), url: photo.pageUrl })),
                },
              ] as const;
            }),
          ),
        );
        return {
          id: template.id,
          name: template.name,
          description: template.description,
          category: template.category,
          categoryLabel: TEMPLATE_CATEGORY_LABELS[template.category],
          tags: template.tags,
          ratios: template.ratios,
          durationMs: templateDurationMs(template),
          bpm: template.bpm,
          musicUrl: (await templateMusicReady(template.id)) ? await fileUrl("assets", templateMusicFile(template.id)) : null,
          slots: template.slots.map((slot) => ({ id: slot.id, kind: slot.kind, label: slot.label, default: slot.default, ...(slot.maxLength ? { maxLength: slot.maxLength } : {}), ...(slot.hint ? { hint: slot.hint } : {}) })),
          previews,
        };
      }),
    );
    const counts = Object.fromEntries(TEMPLATE_CATEGORIES.map((entry) => [entry, TEMPLATES.filter((template) => template.category === entry && (!ratio || template.ratios.includes(ratio))).length]));
    return { templates, total: templates.length, categories: TEMPLATE_CATEGORIES.map((id) => ({ id, label: TEMPLATE_CATEGORY_LABELS[id], count: counts[id] ?? 0 })) };
  },
});
