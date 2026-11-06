import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { type AspectRatio, type Composition, type TemplateCategory, buildTemplate, getTemplate } from "@crewcut/composition";
import { keepPreviousData } from "@tanstack/react-query";
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { errorMessage } from "@/lib/crewcut";

export interface TemplateSlotSummary {
  id: string;
  kind: "photo" | "text";
  label: string;
  default: string;
  maxLength?: number;
  hint?: string;
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  categoryLabel: string;
  tags: string[];
  ratios: AspectRatio[];
  durationMs: number;
  bpm: number;
  musicUrl: string | null;
  slots: TemplateSlotSummary[];
  previews: Partial<Record<AspectRatio, { values: Record<string, string>; credits: Array<{ text: string; url: string }> }>>;
}

interface TemplatesPayload {
  templates: TemplateSummary[];
  total: number;
  categories: Array<{ id: TemplateCategory; label: string; count: number }>;
}

export function useTemplates(filters: { query?: string; ratio?: AspectRatio | null; category?: TemplateCategory | null }) {
  const params = { ...(filters.query?.trim() ? { query: filters.query.trim() } : {}), ...(filters.ratio ? { ratio: filters.ratio } : {}), ...(filters.category ? { category: filters.category } : {}) };
  const query = useActionQuery("list-templates", params as never, { placeholderData: keepPreviousData } as never);
  const data = query.data as TemplatesPayload | undefined;
  return { templates: data?.templates ?? [], categories: data?.categories ?? [], loading: query.isLoading, refreshing: query.isFetching && query.isPlaceholderData };
}

/** The template as it will look, built in the browser from the same definition the server uses. */
export function useTemplatePreview(template: TemplateSummary | null, ratio: AspectRatio | null, text: Record<string, string> = {}): Composition | null {
  return useMemo(() => {
    if (!template || !ratio) return null;
    const definition = getTemplate(template.id);
    if (!definition) return null;
    const preview = template.previews[ratio];
    return buildTemplate(definition, {
      id: `preview-${template.id}`,
      ratio,
      values: { ...(preview?.values ?? {}), ...text },
      ...(template.musicUrl ? { music: { src: template.musicUrl, label: `${template.name} theme` } } : {}),
    });
  }, [template, ratio, text]);
}

export function useStartFromTemplate() {
  const navigate = useNavigate();
  const use = useActionMutation("use-template");
  return {
    pending: use.isPending,
    async start(input: { templateId: string; ratio: AspectRatio; values?: Record<string, string>; title?: string }): Promise<boolean> {
      try {
        const result = (await use.mutateAsync(input as never)) as { path: string; note?: string; notes?: string[] };
        if (result.note) toast.message(result.note);
        for (const note of result.notes ?? []) toast.message(note);
        navigate(result.path);
        return true;
      } catch (error) {
        toast.error(errorMessage(error));
        return false;
      }
    },
  };
}
