import { useActionQuery } from "@agent-native/core/client/hooks";
import type { Stage } from "@crewcut/contracts";
import { IconArrowLeft, IconCertificate, IconPlayerPlay, IconSparkles } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { STAGE_LABELS, STAGE_ORDER, STAGE_PROMPTS, askAgent, formatAgo } from "@/lib/crewcut";
import { cn } from "@/lib/utils";

import { Panel, SkeletonLines, StatusPill } from "../primitives";
import { ResearchStage, TrendStage } from "./stage-research";
import { AnalyticsStage, MotionStage, PublishStage, VoiceStage } from "./stage-production";
import { QaStage, ScriptStage } from "./stage-script";
import type { VideoState } from "./types";

const STAGE_VIEW: Record<Stage, (props: { state: VideoState }) => React.JSX.Element> = {
  trend: TrendStage,
  research: ResearchStage,
  script: ScriptStage,
  qa: QaStage,
  motion: MotionStage,
  voice: VoiceStage,
  publish: PublishStage,
  analytics: AnalyticsStage,
};

const DECISION_LABEL: Record<string, string> = {
  approved: "approved",
  sent_back: "sent back",
  override: "overrode a claim",
  rejected: "rejected",
  notified: "finished (notify gate)",
  published: "published",
};

function ApprovalLog({ state }: { state: VideoState }) {
  const events = [...state.approvals].reverse();
  return (
    <Panel title="Decisions" description="Every approval, override and send-back, by whom and why.">
      {events.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Nothing yet.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {events.slice(0, 30).map((event) => (
            <li key={event.id} className="flex gap-2.5 text-[13px]">
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", event.actorKind === "human" ? "bg-pc-accent" : "bg-muted-foreground/50")} aria-hidden />
              <div className="min-w-0">
                <p className="text-foreground">
                  <span className="font-medium">{event.actorKind === "human" ? event.actor : "Agent"}</span> {DECISION_LABEL[event.decision] ?? event.decision}{" "}
                  <span className="text-muted-foreground">{STAGE_LABELS[event.stage].agent}</span>
                </p>
                {event.reason || event.subject ? <p className="truncate text-xs text-muted-foreground">{[event.subject, event.reason].filter(Boolean).join(" — ")}</p> : null}
                <p className="text-[11px] text-muted-foreground">{formatAgo(event.createdAt)}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

export function BoardPage({ videoId }: { videoId: string }) {
  const [busy, setBusy] = useState(false);
  const query = useActionQuery("get-video", { videoId } as never, { refetchInterval: busy ? 2000 : false });
  const state = query.data as VideoState | undefined;
  const [selected, setSelected] = useState<Stage | null>(null);

  useEffect(() => {
    if (!state) return;
    setBusy(state.renders.some((render) => render.status === "queued" || render.status === "running") || state.publishJobs.some((job) => job.status === "uploading"));
  }, [state]);

  if (query.isLoading || !state) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-8">
        {query.error ? <p className="text-sm text-unsupported">{String(query.error)}</p> : <SkeletonLines count={6} />}
      </div>
    );
  }

  const active = selected ?? (state.progress.waiting[0] ?? state.progress.current);
  const StageView = STAGE_VIEW[active];
  const stageState = state.stages[active];

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/home" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <IconArrowLeft className="size-3.5" /> Videos
          </Link>
          <h1 className="pc-display mt-1 text-2xl leading-tight text-foreground">{state.video.title}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {state.video.ratio} · {state.video.platforms.join(", ").replace(/_/g, " ")}
            {state.video.isDemo ? " · demo data" : ""} · updated {formatAgo(state.video.updatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild className="pc-press">
            <Link to={`/videos/${videoId}/proof`}>
              <IconCertificate className="size-4" />
              Proof report
            </Link>
          </Button>
          {state.composition ? (
            <Button asChild className="pc-press">
              <Link to={`/videos/${videoId}/edit`}>
                <IconPlayerPlay className="size-4" />
                Open editor
              </Link>
            </Button>
          ) : null}
        </div>
      </header>

      <nav aria-label="Pipeline stages" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ol className="flex min-w-max gap-2 sm:grid sm:min-w-0 sm:grid-cols-4 xl:grid-cols-8">
          {STAGE_ORDER.map((stage, index) => {
            const status = state.stages[stage].status;
            const isActive = stage === active;
            return (
              <li key={stage} className="w-40 sm:w-auto">
                <button
                  type="button"
                  onClick={() => setSelected(stage)}
                  aria-current={isActive ? "step" : undefined}
                  className={cn(
                    "pc-press flex h-full w-full flex-col items-start gap-2 rounded-xl p-3 text-left",
                    isActive ? "bg-card shadow-[0_0_0_2px_var(--pc-accent)]" : "bg-card/60 shadow-[0_0_0_1px_var(--pc-hairline)] hover:bg-card",
                  )}
                >
                  <span className="text-[11px] text-muted-foreground tabular">
                    {index + 1}. {STAGE_LABELS[stage].agent}
                  </span>
                  <StatusPill status={status} />
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel
          key={active}
          className="pc-enter min-w-0"
          title={
            <span className="flex flex-wrap items-center gap-2">
              {STAGE_LABELS[active].agent}
              <StatusPill status={stageState.status} />
            </span>
          }
          description={stageState.note ?? STAGE_LABELS[active].job}
          actions={
            <Button size="sm" variant="ghost" className="pc-press" onClick={() => askAgent(STAGE_PROMPTS[active](videoId), { videoId, stage: active })}>
              <IconSparkles className="size-4" />
              Ask agent
            </Button>
          }
        >
          <StageView state={state} />
        </Panel>
        <ApprovalLog state={state} />
      </div>
    </div>
  );
}
