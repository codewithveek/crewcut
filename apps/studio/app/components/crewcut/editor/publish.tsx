import { callAction, useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { type Composition } from "@crewcut/composition";
import { IconBrandYoutubeFilled, IconChevronDown, IconExternalLink, IconLoader2, IconRefresh, IconSparkles, IconUpload } from "@tabler/icons-react";
import { type ComponentType, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger, FieldRow, Segmented } from "@/components/ds";
import { STAGE_PROMPTS, askAgent, errorMessage, formatAgo } from "@/lib/crewcut";
import { cn } from "@/lib/utils";

/**
 * Publishing from the editor: "Publish to YouTube" sits next to Export (top
 * bar and the export dialog), becomes a menu once several platforms are
 * connected, and runs the same people-only publish step as the pipeline board.
 */

/** Platforms people can connect, keyed by connection provider. Brand colour is the icon's fill. */
export const PUBLISH_PLATFORMS: Record<string, { label: string; Icon: ComponentType<{ className?: string; style?: React.CSSProperties }>; color: string }> = {
  youtube: { label: "YouTube", Icon: IconBrandYoutubeFilled, color: "#FF0033" },
};
export type PublishPlatform = keyof typeof PUBLISH_PLATFORMS;

export function PlatformIcon({ platform, className }: { platform: PublishPlatform; className?: string }) {
  const entry = PUBLISH_PLATFORMS[platform];
  if (!entry) return null;
  return <entry.Icon className={cn("size-4 shrink-0", className)} style={{ color: entry.color }} aria-hidden />;
}

interface ConnectionsData {
  accounts: Array<{ id: string; provider: string; accountName: string; status: string }>;
  youtubeConfigured: boolean;
}

/** Connected platforms we can publish to (one entry per platform, healthy or expiring accounts only). */
export function usePublishTargets(): { targets: PublishPlatform[]; loading: boolean; youtubeConfigured: boolean } {
  const query = useActionQuery("list-connections", {} as never);
  const data = query.data as ConnectionsData | undefined;
  const targets = [...new Set((data?.accounts ?? []).filter((account) => account.status !== "revoked" && account.status !== "failed" && account.provider in PUBLISH_PLATFORMS).map((account) => account.provider))];
  return { targets, loading: query.isLoading, youtubeConfigured: data?.youtubeConfigured ?? false };
}

/** Sends the person to YouTube's consent screen; they come back to this page with ?connected=youtube. */
export function useConnectYouTube(): () => Promise<void> {
  const connect = useActionMutation("connect-account", { uiOnly: true });
  return async () => {
    try {
      const result = (await connect.mutateAsync({ provider: "youtube", origin: window.location.origin, returnTo: window.location.pathname } as never)) as { configured: boolean; url?: string; message?: string };
      if (!result.configured || !result.url) {
        toast.message(result.message ?? "YouTube isn't set up yet.");
        return;
      }
      window.location.assign(result.url);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
}

/**
 * "Publish to ▶ YouTube". With nothing connected it connects YouTube first;
 * with two or more platforms connected it opens a menu to pick one.
 */
export function PublishButton({ onChoose, size = "sm", variant = "outline", className }: { onChoose: (platform: PublishPlatform) => void; size?: "sm" | "default"; variant?: "outline" | "default"; className?: string }) {
  const { targets, loading } = usePublishTargets();
  const connectYouTube = useConnectYouTube();
  const shared = { size, variant, className: cn("pc-press", className) } as const;
  if (targets.length > 1) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button {...shared}>
            <IconUpload className="size-4" /> Publish to… <IconChevronDown className="size-3.5 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Publish to</DropdownMenuLabel>
          {targets.map((platform) => (
            <DropdownMenuItem key={platform} icon={<PlatformIcon platform={platform} />} onSelect={() => onChoose(platform)}>
              {PUBLISH_PLATFORMS[platform]?.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  const platform: PublishPlatform = targets[0] ?? "youtube";
  const connected = targets.length === 1;
  return (
    <Button {...shared} disabled={loading} title={connected ? undefined : "Connect your YouTube channel, then publish from here"} onClick={() => (connected ? onChoose(platform) : void connectYouTube())}>
      <span>Publish to</span>
      <PlatformIcon platform={platform} />
      <span>{PUBLISH_PLATFORMS[platform]?.label}</span>
    </Button>
  );
}

// ── The publish step (inside the export dialog) ─────────────────────────────

export interface RenderSummary {
  id: string;
  status: string;
  progress: number | null;
  createdAt: string;
  compositionVersion: number;
}

interface PublishJob {
  id: string;
  platform: string;
  status: string;
  url: string | null;
  error: string | null;
  createdAt: string;
  privacy: string;
  copy: { title: string; description: string; hashtags?: string[]; keywords?: string[]; sources?: Array<{ title: string; url: string }> };
}

type Privacy = "private" | "unlisted" | "public";

/** A Short is vertical or square and at most 3 minutes; YouTube decides from the file, we label the post the same way. */
export function isShort(composition: Composition): boolean {
  return (composition.ratio === "9:16" || composition.ratio === "1:1") && composition.durationMs <= 180_000;
}

export function usePublishFlow({ videoId, composition, platform, renders, exporting, startExport }: { videoId: string; composition: Composition; platform: PublishPlatform | null; renders: RenderSummary[]; exporting: boolean; startExport: () => void }) {
  const [title, setTitle] = useState(composition.title.slice(0, 100));
  const [description, setDescription] = useState("");
  const [privacy, setPrivacy] = useState<Privacy>("private");
  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [writing, setWriting] = useState<string | null>(null);
  const publish = useActionMutation("publish-post", { uiOnly: true });
  const active = platform !== null;
  const watching = Boolean(jobId) || Boolean(writing);
  const query = useActionQuery("get-video", { videoId, include: ["publish"] } as never, { enabled: active, refetchInterval: active && watching ? 2000 : false } as never);
  const jobs = ((query.data as { publishJobs?: PublishJob[] } | undefined)?.publishJobs ?? []).filter((job) => job.platform.startsWith(platform ?? "-"));
  const job = jobId ? (jobs.find((entry) => entry.id === jobId) ?? null) : null;
  const draft = jobs.find((entry) => entry.status === "awaiting_approval" || entry.status === "failed") ?? null;

  // A post the assistant prepared (now, or earlier on the board) fills the form once.
  const filledFrom = useRef<string | null>(null);
  useEffect(() => {
    if (!draft || filledFrom.current === draft.id) return;
    if (writing && draft.createdAt < writing) return;
    filledFrom.current = draft.id;
    setTitle(draft.copy.title);
    setDescription(draft.copy.description);
    setPrivacy((draft.privacy as Privacy) ?? "private");
    if (writing) {
      setWriting(null);
      toast.success("The assistant wrote your post. Check it, then publish.");
    }
  }, [draft?.id, writing]);

  useEffect(() => {
    if (!job) return;
    if (job.status === "published") toast.success(`Published to ${PUBLISH_PLATFORMS[platform ?? ""]?.label ?? "your channel"}`);
    if (job.status === "published" || job.status === "failed") setJobId((current) => (job.status === "failed" ? null : current));
  }, [job?.status]);

  const latestDone = renders.find((render) => render.status === "done") ?? null;
  const running = renders.find((render) => render.status === "running" || render.status === "queued") ?? null;

  const submit = async () => {
    if (!latestDone || !platform) return;
    setSubmitting(true);
    try {
      const prepared = (await callAction("prepare-post" as never, {
        videoId,
        platform: platform === "youtube" && isShort(composition) ? "youtube_shorts" : platform,
        renderId: latestDone.id,
        copy: { title: title.trim(), description, hashtags: draft?.copy.hashtags ?? [], keywords: draft?.copy.keywords ?? [], sources: draft?.copy.sources ?? [] },
        privacy,
      } as never)) as { publishJobId: string };
      filledFrom.current = prepared.publishJobId;
      await publish.mutateAsync({ publishJobId: prepared.publishJobId, privacy } as never);
      setJobId(prepared.publishJobId);
      void query.refetch();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const askAssistant = () => {
    setWriting(new Date().toISOString());
    askAgent(STAGE_PROMPTS.publish(videoId), { videoId });
  };

  return { platform, title, setTitle, description, setDescription, privacy, setPrivacy, submitting, job, writing: Boolean(writing), askAssistant, latestDone, running, exporting, startExport, submit, reset: () => setJobId(null) };
}

export type PublishFlow = ReturnType<typeof usePublishFlow>;

export function PublishBody({ flow, composition, version }: { flow: PublishFlow; composition: Composition; version: number }) {
  const label = PUBLISH_PLATFORMS[flow.platform ?? ""]?.label ?? "your channel";
  if (flow.job && (flow.job.status === "uploading" || flow.job.status === "published")) {
    const done = flow.job.status === "published";
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center" aria-live="polite">
        {done ? <PlatformIcon platform={flow.platform ?? "youtube"} className="size-10" /> : <IconLoader2 className="size-8 text-ds-text-2 motion-safe:animate-spin" />}
        <div>
          <p className="text-sm font-semibold text-ds-text">{done ? `Published to ${label}` : `Uploading to ${label}…`}</p>
          <p className="mt-1 text-xs text-ds-text-3">{done ? `Posted as ${flow.job.privacy}. YouTube may take a few minutes to process it.` : "You can close this; the upload keeps going."}</p>
        </div>
        {done && flow.job.url ? (
          <Button asChild size="sm" variant="outline">
            <a href={flow.job.url} target="_blank" rel="noreferrer noopener">
              Open on {label} <IconExternalLink className="size-3.5" />
            </a>
          </Button>
        ) : null}
      </div>
    );
  }
  const outdated = flow.latestDone && flow.latestDone.compositionVersion !== version;
  return (
    <div className="flex flex-col gap-3">
      {/* Publishing uploads the exported file, so an export has to exist first. */}
      {flow.running || flow.exporting ? (
        <div className="rounded-ds-md bg-ds-surface-2 p-3">
          <p className="text-xs text-ds-text">Exporting your video first…</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ds-surface-3" role="progressbar" aria-valuenow={Math.round((flow.running?.progress ?? 0) * 100)}>
            <div className="h-full rounded-full bg-ds-accent transition-[width] duration-500" style={{ width: `${Math.max(3, Math.round((flow.running?.progress ?? 0) * 100))}%` }} />
          </div>
        </div>
      ) : !flow.latestDone ? (
        <div className="flex items-center gap-3 rounded-ds-md bg-ds-surface-2 p-3">
          <p className="flex-1 text-xs text-ds-text-2">Publishing uploads your exported video. Export it first; it takes a minute or two.</p>
          <Button size="sm" onClick={flow.startExport} className="pc-press">
            <IconUpload className="size-4" /> Export
          </Button>
        </div>
      ) : outdated ? (
        <div className="flex items-center gap-3 rounded-ds-md bg-ds-surface-2 p-3">
          <p className="flex-1 text-xs text-ds-text-2">This uses your export from {formatAgo(flow.latestDone.createdAt)}, before your latest edits.</p>
          <Button size="sm" variant="outline" onClick={flow.startExport} className="pc-press">
            <IconRefresh className="size-4" /> Export again
          </Button>
        </div>
      ) : null}

      <label className="flex flex-col gap-1">
        <span className="flex items-baseline justify-between text-xs font-medium text-ds-text-2">
          Title <span className="font-mono tabular text-[11px] text-ds-text-3">{flow.title.length}/100</span>
        </span>
        <input
          value={flow.title}
          maxLength={100}
          onChange={(event) => flow.setTitle(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          className="h-9 w-full rounded-ds-xs bg-ds-surface-2 px-2.5 text-[13px] text-ds-text shadow-[inset_0_0_0_1px_var(--ds-hairline)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--ds-accent)]"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ds-text-2">Description</span>
        <textarea
          value={flow.description}
          rows={5}
          maxLength={5000}
          placeholder="What's the video about? Add links and hashtags here."
          onChange={(event) => flow.setDescription(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          className="w-full resize-y rounded-ds-xs bg-ds-surface-2 px-2.5 py-2 text-[13px] leading-relaxed text-ds-text shadow-[inset_0_0_0_1px_var(--ds-hairline)] outline-none placeholder:text-ds-text-3 focus:shadow-[inset_0_0_0_1.5px_var(--ds-accent)]"
        />
      </label>
      <Button size="sm" variant="ghost" className="pc-press self-start" disabled={flow.writing} onClick={flow.askAssistant}>
        {flow.writing ? <IconLoader2 className="size-4 motion-safe:animate-spin" /> : <IconSparkles className="size-4" />}
        {flow.writing ? "The assistant is writing it…" : "Write it with the assistant"}
      </Button>

      <FieldRow label="Visibility">
        <Segmented
          ariaLabel="Visibility"
          value={flow.privacy}
          onChange={flow.setPrivacy}
          options={[
            { value: "private", label: "Private", title: "Only you" },
            { value: "unlisted", label: "Unlisted", title: "Anyone with the link" },
            { value: "public", label: "Public", title: "Everyone" },
          ]}
        />
      </FieldRow>
      <p className="text-[11px] leading-relaxed text-ds-text-3">
        {flow.platform === "youtube" && isShort(composition) ? "Goes up as a YouTube Short. " : ""}
        YouTube keeps uploads private until Google has verified this app.
      </p>
      {flow.job?.status === "failed" ? <p className="text-xs text-ds-danger">{flow.job.error ?? "The upload failed."} Try again.</p> : null}
    </div>
  );
}

export function PublishFooter({ flow, onBack }: { flow: PublishFlow; onBack: () => void }) {
  const label = PUBLISH_PLATFORMS[flow.platform ?? ""]?.label ?? "";
  if (flow.job && (flow.job.status === "uploading" || flow.job.status === "published")) {
    return (
      <Button variant="ghost" onClick={onBack}>
        Back to export
      </Button>
    );
  }
  return (
    <>
      <Button variant="ghost" onClick={onBack}>
        Back
      </Button>
      <Button onClick={() => void flow.submit()} disabled={!flow.latestDone || flow.submitting || !flow.title.trim() || Boolean(flow.running) || flow.exporting} className="pc-press">
        {flow.submitting ? <IconLoader2 className="size-4 motion-safe:animate-spin" /> : <PlatformIcon platform={flow.platform ?? "youtube"} className="[&]:text-current" />}
        Publish to {label}
      </Button>
    </>
  );
}
