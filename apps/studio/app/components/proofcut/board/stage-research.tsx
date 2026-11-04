import { useActionMutation } from "@agent-native/core/client/hooks";
import { IconCheck, IconExternalLink, IconFileText, IconTrendingUp, IconX } from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { STAGE_PROMPTS, askAgent, errorMessage } from "@/lib/proofcut";
import { cn } from "@/lib/utils";

import { EmptyState } from "../primitives";
import type { VideoState } from "./types";

export function TrendStage({ state }: { state: VideoState }) {
  const approve = useActionMutation("approve-stage", { uiOnly: true });
  const videoId = state.video.id;
  if (state.ideas.length === 0) {
    return (
      <EmptyState icon={<IconTrendingUp className="size-6" />} title="No ideas yet" action={<Button size="sm" onClick={() => askAgent(STAGE_PROMPTS.trend(videoId), { videoId })}>Ask the trend agent</Button>}>
        The trend agent looks at outliers in your niche, what people search and ask, and your own winners — then ranks ideas with evidence.
      </EmptyState>
    );
  }
  const canPick = state.stages.trend.status === "awaiting_approval";
  return (
    <ol className="grid gap-3 md:grid-cols-2">
      {state.ideas.map((idea, index) => {
        const picked = state.video.pickedIdeaId === idea.id;
        return (
          <li key={idea.id} className={cn("flex flex-col gap-3 rounded-xl border p-4", picked ? "border-[var(--pc-accent)] bg-pc-accent-soft" : "border-border bg-background/40")}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  #{index + 1} · {idea.format === "long" ? "Long" : "Short"}
                </p>
                <h3 className="pc-display mt-0.5 text-[15px] text-foreground">{idea.title}</h3>
              </div>
              <span className="tabular shrink-0 rounded-md bg-muted px-2 py-1 text-xs font-semibold text-foreground" title="Evidence score">
                {idea.score}
              </span>
            </div>
            <p className="text-[13px] leading-relaxed text-muted-foreground">{idea.angle}</p>
            <ul className="flex flex-col gap-1.5">
              {idea.evidence.map((evidence, evidenceIndex) => (
                <li key={evidenceIndex} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span className="mt-0.5 rounded bg-muted px-1.5 py-px text-[10px] font-medium uppercase tracking-wide">{evidence.kind.replace("-", " ")}</span>
                  <span className="min-w-0 flex-1">
                    {evidence.url ? (
                      <a href={evidence.url} target="_blank" rel="noreferrer noopener" className="underline-offset-2 hover:underline">
                        {evidence.label}
                      </a>
                    ) : (
                      evidence.label
                    )}
                    {evidence.metric ? <span className="ml-1 font-medium text-foreground">{evidence.metric}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            {canPick ? (
              <Button
                size="sm"
                variant={index === 0 ? "default" : "outline"}
                className="pc-press mt-auto self-start"
                disabled={approve.isPending}
                onClick={async () => {
                  try {
                    await approve.mutateAsync({ videoId, stage: "trend", ideaId: idea.id } as never);
                    toast.success(`Picked “${idea.title}”`);
                    askAgent(STAGE_PROMPTS.research(videoId), { videoId, ideaId: idea.id });
                  } catch (error) {
                    toast.error(errorMessage(error));
                  }
                }}
              >
                Pick this idea
              </Button>
            ) : picked ? (
              <p className="mt-auto text-xs font-medium text-pc-accent">Picked</p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export function ResearchStage({ state }: { state: VideoState }) {
  const { dossier, sources } = state;
  if (!dossier) {
    return (
      <EmptyState icon={<IconFileText className="size-6" />} title="No dossier yet" action={<Button size="sm" onClick={() => askAgent(STAGE_PROMPTS.research(state.video.id), { videoId: state.video.id })}>Ask the research agent</Button>}>
        Research reads pages, docs or a repo (secrets redacted) and records facts that quote their source word for word.
      </EmptyState>
    );
  }
  const verified = dossier.facts.filter((fact) => fact.verified).length;
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl bg-muted/50 p-3 text-[13px] leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">{dossier.angle}</span> {dossier.summary}
      </div>
      <div className="flex flex-wrap gap-2">
        {sources.map((source) => (
          <span key={source.id} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground">
            <IconFileText className="size-3.5 shrink-0" />
            <span className="truncate">{source.title}</span>
            {source.url ? (
              <a href={source.url} target="_blank" rel="noreferrer noopener" aria-label={`Open ${source.title}`} className="text-foreground">
                <IconExternalLink className="size-3.5" />
              </a>
            ) : null}
            {source.redactions > 0 ? <span className="text-weak">· {source.redactions} redacted</span> : null}
          </span>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground tabular">
          {verified}/{dossier.facts.length}
        </span>{" "}
        facts verified word for word against their stored source.
      </p>
      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
        {dossier.facts.map((fact) => (
          <li key={fact.id} className="flex gap-3 p-3">
            <span className="tabular mt-0.5 font-mono text-xs text-muted-foreground">{fact.id}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-foreground">{fact.statement}</p>
              <blockquote className="mt-1 border-l-2 border-border pl-2 text-xs text-muted-foreground">“{fact.quote}”</blockquote>
            </div>
            <span
              className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium", fact.verified ? "bg-supported/15 text-supported" : "bg-unsupported/15 text-unsupported")}
              title={fact.verified ? "Quote found in the source" : "Quote not found in the source"}
            >
              {fact.verified ? <IconCheck className="size-3" /> : <IconX className="size-3" />}
              {fact.verified ? "Verified" : "Not found"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export { errorMessage };
