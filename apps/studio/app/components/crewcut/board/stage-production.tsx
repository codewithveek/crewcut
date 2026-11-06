import { useActionMutation } from "@agent-native/core/client/hooks";
import { formatTimecode } from "@crewcut/composition";
import { IconChartLine, IconDownload, IconExternalLink, IconMicrophone, IconMovie, IconPlayerPlay, IconSparkles, IconUpload } from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { STAGE_PROMPTS, askAgent, errorMessage, formatAgo, formatBytes } from "@/lib/crewcut";
import { plainStageNote } from "@/lib/decisions";
import { cn } from "@/lib/utils";

import { EmptyState } from "../primitives";
import type { VideoState } from "./types";

function useRun<T extends string>(name: T, label: string) {
  const mutation = useActionMutation(name as never);
  return {
    pending: mutation.isPending,
    run: async (args: Record<string, unknown>) => {
      try {
        const result = await mutation.mutateAsync(args as never);
        toast.success(label);
        return result;
      } catch (error) {
        toast.error(errorMessage(error));
        return null;
      }
    },
  };
}

export function MotionStage({ state }: { state: VideoState }) {
  const compose = useRun("compose-video", "Draft video ready");
  const approve = useActionMutation("approve-stage", { uiOnly: true });
  const videoId = state.video.id;
  const composition = state.composition;
  if (!composition) {
    return (
      <EmptyState
        icon={<IconMovie className="size-6" />}
        title="No draft video yet"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button size="sm" onClick={() => askAgent(STAGE_PROMPTS.motion(videoId), { videoId })}>
              <IconSparkles className="size-4" />
              Ask the motion director
            </Button>
            <Button size="sm" variant="outline" disabled={compose.pending || !state.script} onClick={() => void compose.run({ videoId })}>
              Draft without AI
            </Button>
          </div>
        }
      >
        The motion director picks a look for this video and designs every scene from scratch — no templates unless you ask for one.
      </EmptyState>
    );
  }
  const { brief } = composition.summary;
  const scenes = composition.summary.tracks[0]?.clips ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Art direction</p>
          <p className="pc-display mt-1 text-[15px] text-foreground">{brief.mood}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {brief.typePairing.display} / {brief.typePairing.body} · {brief.layoutGrid} grid · {brief.motionSignature} motion
          </p>
        </div>
        <div className="flex items-center gap-1.5" aria-label="Palette">
          {(["background", "surface", "ink", "muted", "accent"] as const).map((key) => (
            <span key={key} title={`${key} ${brief.palette[key]}`} className="size-7 rounded-md shadow-[0_0_0_1px_var(--pc-hairline)]" style={{ background: brief.palette[key] }} />
          ))}
        </div>
      </div>
      <ol className="flex gap-2 overflow-x-auto pb-1">
        {scenes.map((scene, index) => (
          <li key={scene.id} className="flex w-36 shrink-0 flex-col gap-1 rounded-lg border border-border p-2">
            <span className="text-[11px] text-muted-foreground">Scene {index + 1}</span>
            <span className="truncate text-[13px] font-medium text-foreground">{scene.name ?? scene.id}</span>
            <span className="tabular text-[11px] text-muted-foreground">{((scene.endMs - scene.startMs) / 1000).toFixed(1)} s</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button asChild className="pc-press">
          <Link to={`/videos/${videoId}/edit`}>
            <IconPlayerPlay className="size-4" />
            Open editor
          </Link>
        </Button>
        {state.stages.motion.status === "awaiting_approval" ? (
          <Button
            variant="secondary"
            className="pc-press"
            disabled={approve.isPending}
            onClick={async () => {
              try {
                await approve.mutateAsync({ videoId, stage: "motion" } as never);
                toast.success("Video approved");
              } catch (error) {
                toast.error(errorMessage(error));
              }
            }}
          >
            Approve video
          </Button>
        ) : null}
        <Button variant="outline" className="pc-press" onClick={() => askAgent(`Give video ${videoId} a fresh look: new colours, type and motion.`, { videoId })}>
          Try a different look
        </Button>
      </div>
    </div>
  );
}

export function VoiceStage({ state }: { state: VideoState }) {
  const synth = useRun("synthesize-voice", "Timing matched to the narration");
  const videoId = state.video.id;
  const voice = state.composition?.summary.tracks.find((track) => track.kind === "audio" && track.name === "Voice");
  const narrationClips = voice?.clips.length ?? 0;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-muted-foreground">
        {plainStageNote(state.stages.voice.note) ?? "Narration drives timing: scene lengths follow the voice. Hand-trimmed clips keep their length and unlock from narration."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button className="pc-press" disabled={synth.pending || !state.composition} onClick={() => void synth.run({ videoId })}>
          <IconMicrophone className="size-4" />
          {synth.pending ? "Synthesizing…" : "Generate voice-over"}
        </Button>
        <span className="text-xs text-muted-foreground">{narrationClips} narration clips on the timeline</span>
      </div>
    </div>
  );
}

export function PublishStage({ state }: { state: VideoState }) {
  const render = useRun("render-video", "Export started");
  const publish = useActionMutation("publish-post", { uiOnly: true });
  const [privacy, setPrivacy] = useState<"private" | "unlisted" | "public">("private");
  const videoId = state.video.id;
  const latest = state.renders[0];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button className="pc-press" disabled={render.pending || !state.composition} onClick={() => void render.run({ videoId })}>
          <IconMovie className="size-4" />
          Export video
        </Button>
        <Button variant="outline" className="pc-press" disabled={!latest || latest.status !== "done"} onClick={() => askAgent(STAGE_PROMPTS.publish(videoId), { videoId })}>
          <IconSparkles className="size-4" />
          Ask the publish agent
        </Button>
      </div>
      {state.renders.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
          {state.renders.map((job) => (
            <li key={job.id} className="flex flex-wrap items-center gap-3 p-3 text-[13px]">
              <span className="tabular text-muted-foreground">v{job.compositionVersion}</span>
              <span className="text-foreground">{job.ratio}</span>
              {job.status === "running" || job.status === "queued" ? (
                <div className="flex min-w-40 flex-1 items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.progress * 100)}>
                    <div className="h-full rounded-full bg-pc-accent transition-[width] duration-300" style={{ width: `${Math.round(job.progress * 100)}%` }} />
                  </div>
                  <span className="tabular w-16 text-right text-xs text-muted-foreground">
                    {job.status === "queued" ? "queued" : `${Math.round(job.progress * 100)}%`}
                  </span>
                </div>
              ) : job.status === "done" ? (
                <span className="flex-1 text-xs text-supported">Done · {formatBytes(job.outputBytes)}</span>
              ) : (
                <span className="flex-1 truncate text-xs text-unsupported" title={job.error ?? ""}>
                  Failed: {job.error?.split("\n")[0]}
                </span>
              )}
              <span className="text-xs text-muted-foreground">{formatAgo(job.createdAt)}</span>
              {job.status === "done" ? <RenderDownload videoId={videoId} renderId={job.id} /> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {state.publishJobs.filter((job) => job.status !== "cancelled").map((job) => (
        <div key={job.id} className="flex flex-col gap-3 rounded-xl border border-border p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{job.platform.replace("_", " ")} · {job.status.replace("_", " ")}</p>
              <p className="pc-display mt-0.5 text-[15px] text-foreground">{job.copy.title}</p>
            </div>
            {job.url ? (
              <a href={job.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs text-pc-accent underline-offset-2 hover:underline">
                Open on YouTube <IconExternalLink className="size-3.5" />
              </a>
            ) : null}
          </div>
          <p className="line-clamp-4 whitespace-pre-line text-xs text-muted-foreground">{job.copy.description}</p>
          {job.warnings.length > 0 ? <p className="text-xs text-weak">{job.warnings.join(" ")}</p> : null}
          {job.error ? <p className="text-xs text-unsupported">{job.error}</p> : null}
          {job.status === "awaiting_approval" || job.status === "failed" ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-muted-foreground" htmlFor={`privacy-${job.id}`}>
                Privacy
              </label>
              <select
                id={`privacy-${job.id}`}
                value={privacy}
                onChange={(event) => setPrivacy(event.target.value as typeof privacy)}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="private">Private</option>
                <option value="unlisted">Unlisted</option>
                <option value="public">Public</option>
              </select>
              <Button
                size="sm"
                className="pc-press"
                disabled={publish.isPending}
                onClick={async () => {
                  try {
                    await publish.mutateAsync({ publishJobId: job.id, privacy } as never);
                    toast.success("Uploading to YouTube…");
                  } catch (error) {
                    toast.error(errorMessage(error));
                  }
                }}
              >
                <IconUpload className="size-4" />
                Publish ({privacy})
              </Button>
              <span className="text-xs text-muted-foreground">YouTube keeps uploads private until Google has verified this app.</span>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function RenderDownload({ videoId, renderId }: { videoId: string; renderId: string }) {
  const link = useActionMutation("get-render-link");
  return (
    <Button
      size="xs"
      variant="ghost"
      className="pc-press"
      onClick={async () => {
        try {
          const result = (await link.mutateAsync({ videoId, renderId } as never)) as { url: string };
          window.open(result.url, "_blank", "noopener");
        } catch (error) {
          toast.error(errorMessage(error));
        }
      }}
    >
      <IconDownload className="size-3.5" />
      Download
    </Button>
  );
}

export function AnalyticsStage({ state }: { state: VideoState }) {
  const pull = useRun("pull-metrics", "Results updated");
  const explain = useRun("explain-performance", "Insights updated");
  const videoId = state.video.id;
  const insights = state.insights;
  const published = state.video.status === "published" || state.video.status === "sample";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button
          className="pc-press"
          disabled={!published || pull.pending || explain.pending}
          onClick={async () => {
            if (await pull.run({ videoId, window: "7d" })) await explain.run({ videoId, window: "7d" });
          }}
        >
          <IconChartLine className="size-4" />
          Pull 7-day results & explain
        </Button>
        {!published ? <span className="self-center text-xs text-muted-foreground">Available after publishing (48 h, 7 d, 28 d).</span> : null}
      </div>
      {insights.length > 0 ? (
        <ul className="grid gap-3 md:grid-cols-2">
          {insights
            .filter((insight) => !insight.lowImpact)
            .map((insight) => (
              <li
                key={insight.id}
                className={cn(
                  "flex flex-col gap-2 rounded-xl border p-3",
                  insight.severity === "negative" ? "border-unsupported/30" : insight.severity === "positive" ? "border-supported/30" : "border-border",
                )}
              >
                <p className="text-[14px] font-medium leading-snug text-foreground">{insight.headline}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">{insight.detail}</p>
                {insight.learning ? <p className="text-xs text-foreground">→ {insight.learning}</p> : null}
                {insight.atMs !== undefined ? (
                  <Link to={`/videos/${videoId}/edit?t=${Math.round(insight.atMs)}`} className="tabular self-start text-xs text-pc-accent underline-offset-2 hover:underline">
                    Jump to {formatTimecode(insight.atMs, { fps: 30 }).slice(3)}
                  </Link>
                ) : null}
              </li>
            ))}
        </ul>
      ) : null}
      {insights.some((insight) => insight.lowImpact) ? (
        <p className="text-xs text-muted-foreground">Low impact: {insights.find((insight) => insight.lowImpact)?.detail}</p>
      ) : null}
    </div>
  );
}
