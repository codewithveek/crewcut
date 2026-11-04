import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import type { Stage, StageStatus } from "@proofcut/contracts";
import { IconArrowRight, IconFlask2, IconMovie, IconSparkles } from "@tabler/icons-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { STAGE_LABELS, STAGE_ORDER, STAGE_PROMPTS, askAgent, errorMessage, formatAgo } from "@/lib/proofcut";
import { cn } from "@/lib/utils";

import { EmptyState, ProofcutMark, SkeletonLines } from "./primitives";

type Ratio = "16:9" | "9:16" | "1:1";

interface VideoSummary {
  id: string;
  title: string;
  ratio: string;
  status: string;
  isDemo: boolean;
  updatedAt: string;
  progress: { done: number; total: number; current: Stage; waiting: Stage[] };
}

function StageDots({ progress }: { progress: VideoSummary["progress"] }) {
  return (
    <div className="flex items-center gap-1" aria-label={`${progress.done} of ${progress.total} stages done`}>
      {STAGE_ORDER.map((stage, index) => {
        const done = index < progress.done;
        const waiting = progress.waiting.includes(stage);
        return (
          <span
            key={stage}
            title={STAGE_LABELS[stage].agent}
            className={cn("h-1.5 flex-1 rounded-full", done ? "bg-supported" : waiting ? "bg-weak" : stage === progress.current ? "bg-pc-accent" : "bg-muted")}
          />
        );
      })}
    </div>
  );
}

function VideoCard({ video }: { video: VideoSummary }) {
  const waiting = video.progress.waiting[0];
  return (
    <Link
      to={`/videos/${video.id}`}
      className="pc-panel pc-press group flex flex-col gap-3 p-4 outline-none focus-visible:ring-2 focus-visible:ring-[var(--pc-accent)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="pc-display line-clamp-2 text-[15px] text-foreground">{video.title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {video.ratio} · {formatAgo(video.updatedAt)}
            {video.isDemo ? " · sample" : ""}
          </p>
        </div>
        <IconArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5" />
      </div>
      <StageDots progress={video.progress} />
      <p className="text-xs text-muted-foreground">
        {video.status === "published"
          ? "Published"
          : video.status === "sample"
            ? "Sample published video · analytics ready"
            : waiting
              ? `Waiting on you: ${STAGE_LABELS[waiting].agent}`
              : `${STAGE_LABELS[video.progress.current].agent} · ${video.progress.done}/${video.progress.total}`}
      </p>
    </Link>
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const [brief, setBrief] = useState("");
  const [ratio, setRatio] = useState<Ratio>("16:9");
  const videos = useActionQuery("list-videos", {});
  const start = useActionMutation("start-pipeline");
  const seed = useActionMutation("seed-demo");
  const list = (videos.data as { videos?: VideoSummary[] } | undefined)?.videos ?? [];

  async function handleStart() {
    if (brief.trim().length < 3) return;
    try {
      const result = (await start.mutateAsync({ brief: brief.trim(), ratio, platforms: [ratio === "16:9" ? "youtube" : "youtube_shorts"] } as never)) as { videoId: string };
      navigate(`/videos/${result.videoId}`);
      askAgent(STAGE_PROMPTS.trend(result.videoId), { videoId: result.videoId, idea: brief.trim() });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function handleSeed() {
    try {
      const result = (await seed.mutateAsync({ through: "script" } as never)) as { path: string };
      toast.success("Demo workspace loaded");
      navigate(result.path);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
      <section className="flex flex-col gap-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ProofcutMark />
          <span className="font-medium text-foreground">Proofcut</span>
          <span aria-hidden>·</span>
          <span>agents make it, you approve it, every claim has a source</span>
        </div>
        <h1 className="pc-display max-w-2xl text-3xl leading-tight text-foreground sm:text-[40px]">What should the next video prove?</h1>
        <form
          className="pc-panel flex flex-col gap-3 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void handleStart();
          }}
        >
          <label htmlFor="pc-brief" className="sr-only">
            Video idea
          </label>
          <textarea
            id="pc-brief"
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void handleStart();
            }}
            rows={3}
            placeholder="An idea, a URL, a repo, or notes — e.g. “Why spring animations feel more natural than easing curves”"
            className="w-full resize-none bg-transparent px-2 py-1.5 text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5" role="radiogroup" aria-label="Aspect ratio">
              {(["16:9", "9:16", "1:1"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={ratio === option}
                  onClick={() => setRatio(option)}
                  className={cn("pc-press h-8 rounded-md px-3 text-xs font-medium tabular", ratio === option ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                >
                  {option}
                </button>
              ))}
            </div>
            <Button type="submit" disabled={brief.trim().length < 3 || start.isPending} className="pc-press">
              <IconSparkles className="size-4" />
              {start.isPending ? "Starting…" : "Start with the agents"}
            </Button>
          </div>
        </form>
        <p className="text-xs text-muted-foreground">
          Trend → research → script → QA → motion → voice → publish → analytics. Five gates wait for your click; QA can send the script back.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="pc-display text-[15px] text-foreground">Videos</h2>
          <Button variant="outline" size="sm" className="pc-press" onClick={() => void handleSeed()} disabled={seed.isPending}>
            <IconFlask2 className="size-4" />
            {seed.isPending ? "Loading…" : "Load demo workspace"}
          </Button>
        </div>
        {videos.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <div key={index} className="pc-panel p-4">
                <SkeletonLines count={3} />
              </div>
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyState icon={<IconMovie className="size-6" />} title="No videos yet" action={<Button variant="secondary" size="sm" onClick={() => void handleSeed()}>Load the demo workspace</Button>}>
            Describe an idea above and the agents start researching, or load the demo to see a sourced script, a QA flag and a finished composition.
          </EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((video) => (
              <VideoCard key={video.id} video={video} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export type { Ratio, StageStatus };
