import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { keepPreviousData } from "@tanstack/react-query";
import type { Composition } from "@crewcut/composition";
import type { Stage } from "@crewcut/contracts";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { STAGE_LABELS, errorMessage } from "@/lib/crewcut";

export interface VideoSummary {
  id: string;
  title: string;
  ratio: string;
  status: string;
  isDemo: boolean;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  hasComposition: boolean;
  mode: "agents" | "manual";
  progress: { done: number; total: number; current: Stage; waiting: Stage[] };
  durationMs?: number;
  composition?: Composition;
}

export type VideoFilter = "all" | "pipeline" | "drafts" | "published" | "waiting";
export type VideoSort = "recent" | "created" | "title";

export interface VideosPayload {
  projects: Array<{ id: string; name: string; isDemo: boolean }>;
  videos: VideoSummary[];
  assetUrls?: Record<string, string>;
  total: number;
  counts: Record<VideoFilter, number>;
  nextOffset: number | null;
}

const NO_COUNTS: Record<VideoFilter, number> = { all: 0, pipeline: 0, drafts: 0, published: 0, waiting: 0 };

/**
 * One page of the person's videos; search, filter and sort run on the server.
 * The previous page stays on screen while the next one loads (no flash of skeletons).
 */
export function useVideoList(options: { query?: string; filter?: VideoFilter; sort?: VideoSort; page?: number; pageSize?: number; withCompositions?: boolean } = {}) {
  const pageSize = options.pageSize ?? 24;
  const page = Math.max(1, options.page ?? 1);
  const params = {
    withCompositions: options.withCompositions ?? true,
    ...(options.query?.trim() ? { query: options.query.trim() } : {}),
    filter: options.filter ?? "all",
    sort: options.sort ?? "recent",
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };
  const query = useActionQuery("list-videos", params as never, { placeholderData: keepPreviousData } as never);
  const data = query.data as VideosPayload | undefined;
  return {
    query,
    videos: data?.videos ?? [],
    projects: data?.projects ?? [],
    assetUrls: data?.assetUrls ?? {},
    total: data?.total ?? 0,
    counts: data?.counts ?? NO_COUNTS,
    pageSize,
    loading: query.isLoading,
    /** True while a new page or search is loading behind the current results. */
    refreshing: query.isFetching && query.isPlaceholderData,
  };
}

export function isPublished(video: VideoSummary): boolean {
  return video.status === "published" || video.status === "sample";
}

/** Where a click on a project should land: the editor when there is something to edit. */
export function primaryPath(video: VideoSummary): string {
  return video.hasComposition ? `/videos/${video.id}/edit` : `/videos/${video.id}`;
}

export function formatDuration(ms: number | undefined): string {
  if (!ms || ms <= 0) return "";
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export interface VideoStatus {
  label: string;
  tone: "neutral" | "accent" | "warning" | "success";
}

export function videoStatus(video: VideoSummary): VideoStatus {
  if (video.status === "sample") return { label: "Sample · analytics", tone: "success" };
  if (isPublished(video)) return { label: "Published", tone: "success" };
  if (video.mode === "manual") return { label: "Draft", tone: "neutral" };
  const waiting = video.progress.waiting[0];
  if (waiting) return { label: `Needs your OK · ${STAGE_LABELS[waiting].agent}`, tone: "warning" };
  return { label: `${STAGE_LABELS[video.progress.current].agent} · ${video.progress.done}/${video.progress.total}`, tone: "accent" };
}

export const STATUS_TONE_CLASS: Record<VideoStatus["tone"], string> = {
  neutral: "bg-ds-surface-3 text-ds-text-2",
  accent: "bg-ds-accent-soft text-ds-accent",
  warning: "bg-ds-warning/15 text-ds-warning",
  success: "bg-ds-success/15 text-ds-success",
};

export function useCreateBlankProject() {
  const navigate = useNavigate();
  const create = useActionMutation("create-blank-video");
  return {
    pending: create.isPending,
    async create(input: { title: string; ratio: string }): Promise<boolean> {
      try {
        const result = (await create.mutateAsync({ title: input.title.trim() || "Untitled project", ratio: input.ratio } as never)) as { path: string };
        navigate(result.path);
        return true;
      } catch (error) {
        toast.error(errorMessage(error));
        return false;
      }
    },
  };
}

export function useLoadDemo() {
  const navigate = useNavigate();
  const seed = useActionMutation("seed-demo");
  return {
    pending: seed.isPending,
    async load(): Promise<void> {
      try {
        const result = (await seed.mutateAsync({ through: "script" } as never)) as { path: string };
        toast.success("Demo workspace loaded");
        navigate(result.path);
      } catch (error) {
        toast.error(errorMessage(error));
      }
    },
  };
}
