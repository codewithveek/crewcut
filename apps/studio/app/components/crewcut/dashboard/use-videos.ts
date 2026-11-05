import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
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

export interface VideosPayload {
  projects: Array<{ id: string; name: string; isDemo: boolean }>;
  videos: VideoSummary[];
  assetUrls?: Record<string, string>;
}

export type VideoFilter = "all" | "pipeline" | "drafts" | "published";

export function useVideos() {
  const query = useActionQuery("list-videos", { withCompositions: true } as never);
  const data = query.data as VideosPayload | undefined;
  return {
    query,
    videos: data?.videos ?? [],
    projects: data?.projects ?? [],
    assetUrls: data?.assetUrls ?? {},
    loading: query.isLoading,
  };
}

export function isPublished(video: VideoSummary): boolean {
  return video.status === "published" || video.status === "sample";
}

export function matchesFilter(video: VideoSummary, filter: VideoFilter): boolean {
  if (filter === "all") return true;
  if (filter === "published") return isPublished(video);
  if (filter === "pipeline") return video.mode === "agents" && !isPublished(video);
  return video.mode === "manual" && !isPublished(video);
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
