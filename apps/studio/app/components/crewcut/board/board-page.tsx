import { useActionQuery } from "@agent-native/core/client/hooks";
import type { Stage } from "@crewcut/contracts";
import { IconArrowLeft, IconCertificate, IconPlayerPlay, IconSparkles } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ds";
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
  notified: "finished",
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

/**
 * The eight stages as one tab bar: each tab is its stage's status badge over its
 * name, and the open stage is underlined in the accent. Scrolls sideways on
 * narrow screens and keeps the open tab in view.
 */
function StageTabs({ state, active }: { state: VideoState; active: Stage }) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tab = listRef.current?.querySelector<HTMLElement>('[data-state="active"]');
    tab?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [active]);
  const done = STAGE_ORDER.filter((stage) => ["approved", "notified"].includes(state.stages[stage].status)).length;
  return (
    <div className="pc-panel overflow-hidden">
      <div ref={listRef} className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <TabsList aria-label={`Pipeline stages, ${done} of ${STAGE_ORDER.length} done`} className="min-w-max gap-0 border-b-0 px-1 sm:min-w-0">
          {STAGE_ORDER.map((stage, index) => (
            <TabsTrigger
              key={stage}
              value={stage}
              className="group h-auto min-w-[7.5rem] flex-1 flex-col gap-2 px-3 pt-3.5 pb-3 focus-visible:ring-inset text-ds-text-2 hover:bg-ds-surface-2/60 after:bottom-0 after:inset-x-3 after:h-[2.5px] after:origin-center after:scale-x-50 after:opacity-0 after:transition-[transform,opacity] after:duration-200 after:ease-[var(--ds-ease-out)] data-[state=active]:after:scale-x-100 data-[state=active]:after:bg-ds-accent data-[state=active]:after:opacity-100 motion-reduce:after:transition-none"
            >
              <StatusPill status={state.stages[stage].status} className="h-5 gap-1 px-2 text-[10.5px] [&_svg]:size-3 group-data-[state=inactive]:opacity-90" />
              <span className="flex items-baseline gap-1.5 text-[13px]">
                <span className="text-[11px] text-ds-text-3 tabular">{index + 1}</span>
                {STAGE_LABELS[stage].agent}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
    </div>
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
          <Link to="/projects" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <IconArrowLeft className="size-3.5" /> Projects
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

      <Tabs value={active} onValueChange={(value) => setSelected(value as Stage)} className="flex flex-col gap-5">
      <StageTabs state={state} active={active} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <TabsContent value={active} className="min-w-0 outline-none">
        <Panel
          key={active}
          className="pc-enter min-w-0"
          // The status badge lives on the stage's tab just above, so the heading stays quiet.
          title={STAGE_LABELS[active].agent}
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
        </TabsContent>
        <ApprovalLog state={state} />
      </div>
      </Tabs>
    </div>
  );
}
