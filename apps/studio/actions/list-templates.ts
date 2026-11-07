import { defineAction } from "@agent-native/core/action";
import { type AspectRatio, TEMPLATE_CATEGORIES, TEMPLATE_CATEGORY_LABELS, type TemplateCategory, aspectRatioSchema, getTemplate, templateDurationMs } from "@crewcut/composition";
import { stockCredit } from "@crewcut/stock";
import { z } from "zod";

import { fileUrl, resolveFileUrls } from "../server/lib/blob-store.js";
import { type ResolvedItem, canManageWorkspaceItem, variantOf, variantRatios, visibleItems } from "../server/lib/catalog.js";
import { identity } from "../server/lib/identity.js";
import { parseJsonLoose } from "../server/lib/json.js";
import { stockPicks, templateMusicFile, templateMusicReady } from "../server/lib/templates.js";

const asCategory = (value: string): TemplateCategory => ((TEMPLATE_CATEGORIES as readonly string[]).includes(value) ? (value as TemplateCategory) : "social");

export default defineAction({
  description:
    "Search the template library: hand-designed videos (photo stories, product promos, quotes…) with text and photo slots, each laid out for specific ratios, plus templates the person's workspace saved (source \"workspace\"). query matches names, descriptions and tags; ratio and category filter; source \"yours\" lists only the workspace's own. Each result lists its slots (ids, sample copy, length limits). Pro templates (tier \"pro\") can be used and edited, but exporting them needs Crewcut Pro: say so before choosing one. Start a project from one with use-template.",
  schema: z.object({
    query: z.string().max(120).optional(),
    ratio: aspectRatioSchema.optional(),
    category: z.enum(TEMPLATE_CATEGORIES).optional(),
    source: z.enum(["all", "yours"]).optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ query, ratio, category, source }, ctx) => {
    const who = identity(ctx);
    const items = await visibleItems(who, ["template"]);
    const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const ratiosOf = (entry: ResolvedItem): AspectRatio[] => {
      if (entry.payload.type === "builtin") return [...(getTemplate(entry.payload.templateId)?.ratios ?? [])];
      if (entry.payload.type === "data") return variantRatios(entry.payload);
      return [];
    };
    const inScope = items.filter((entry) => (source === "yours" ? entry.item.scope === "workspace" : true) && ratiosOf(entry).length > 0);
    const matches = inScope.filter((entry) => {
      if (ratio && !ratiosOf(entry).includes(ratio)) return false;
      if (category && asCategory(entry.item.category) !== category) return false;
      if (words.length === 0) return true;
      const tags = parseJsonLoose<string[]>(entry.item.tags, []);
      const haystack = [entry.item.name, entry.item.description, entry.item.category, ...(Array.isArray(tags) ? tags : [])].join(" ").toLowerCase();
      return words.every((word) => haystack.includes(word));
    });

    const templates = await Promise.all(
      matches.map(async (entry) => {
        const ratios = ratio ? [ratio] : ratiosOf(entry);
        const base = {
          catalogId: entry.item.id,
          name: entry.item.name,
          description: entry.item.description,
          category: asCategory(entry.item.category),
          categoryLabel: TEMPLATE_CATEGORY_LABELS[asCategory(entry.item.category)],
          tags: parseJsonLoose<string[]>(entry.item.tags, []),
          ratios: ratiosOf(entry),
          source: entry.item.scope === "workspace" ? ("workspace" as const) : entry.payload.type === "builtin" ? ("builtin" as const) : ("catalog" as const),
          tier: entry.tier,
          packName: entry.pack?.name ?? null,
          canDelete: canManageWorkspaceItem(who, entry.item),
        };
        if (entry.payload.type === "builtin") {
          const template = getTemplate(entry.payload.templateId);
          if (!template) return null;
          const previews = Object.fromEntries(
            await Promise.all(
              ratios.map(async (entryRatio) => {
                const picks = await stockPicks(template, entryRatio);
                return [
                  entryRatio,
                  {
                    values: Object.fromEntries(Object.entries(picks).map(([slotId, photo]) => [slotId, photo.previewUrl])),
                    credits: Object.values(picks).map((photo) => ({ text: stockCredit(photo), url: photo.pageUrl })),
                  },
                ] as const;
              }),
            ),
          );
          return {
            ...base,
            // Built-in templates keep their code ids ("golden-hour"), so existing links and agent prompts still work.
            id: template.id,
            durationMs: templateDurationMs(template),
            bpm: template.bpm,
            musicUrl: (await templateMusicReady(template.id)) ? await fileUrl("assets", templateMusicFile(template.id)) : null,
            slots: template.slots.map((slot) => ({ id: slot.id, kind: slot.kind, label: slot.label, default: slot.default, ...(slot.maxLength ? { maxLength: slot.maxLength } : {}), ...(slot.hint ? { hint: slot.hint } : {}) })),
            previews,
          };
        }
        if (entry.payload.type !== "data") return null;
        const payload = entry.payload;
        const variants = Object.fromEntries(ratios.map((entryRatio) => [entryRatio, variantOf(payload, entryRatio)] as const).filter(([, composition]) => composition !== null));
        // Links for the template's own media, keyed by the asset ids its compositions use.
        const urls = await resolveFileUrls("assets", Object.values(payload.media).map((media) => media.fileName));
        const assetUrls = Object.fromEntries(Object.entries(payload.media).map(([assetId, media]) => [assetId, urls.get(media.fileName) ?? ""]));
        const audio = Object.entries(payload.media).find(([, media]) => media.mime.startsWith("audio/"));
        return {
          ...base,
          id: entry.item.id,
          durationMs: payload.durationMs,
          bpm: payload.bpm,
          musicUrl: audio ? (assetUrls[audio[0]] ?? null) : null,
          slots: payload.slots.map((slot) => ({ id: slot.id, kind: slot.kind, label: slot.label, default: slot.kind === "text" ? slot.default : "", ...(slot.maxLength ? { maxLength: slot.maxLength } : {}) })),
          previews: {},
          variants,
          assetUrls,
        };
      }),
    );
    const listed = templates.filter((template) => template !== null);
    const counts = Object.fromEntries(TEMPLATE_CATEGORIES.map((entry) => [entry, inScope.filter((item) => asCategory(item.item.category) === entry && (!ratio || ratiosOf(item).includes(ratio))).length]));
    const yours = items.filter((entry) => entry.item.scope === "workspace").length;
    return { templates: listed, total: listed.length, yours, categories: TEMPLATE_CATEGORIES.map((id) => ({ id, label: TEMPLATE_CATEGORY_LABELS[id], count: counts[id] ?? 0 })) };
  },
});
