import { useActionMutation } from "@agent-native/core/client/hooks";
import { countWords, scriptWordCount, wordBudget } from "@crewcut/contracts";
import { IconAlertTriangle, IconPencil, IconScript, IconWand } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { STAGE_PROMPTS, askAgent, errorMessage } from "@/lib/crewcut";
import { cn } from "@/lib/utils";

import { EmptyState, VerdictBadge } from "../primitives";
import type { VideoState } from "./types";

export function ScriptStage({ state }: { state: VideoState }) {
  const approve = useActionMutation("approve-stage", { uiOnly: true });
  const videoId = state.video.id;
  if (!state.script) {
    return (
      <EmptyState icon={<IconScript className="size-6" />} title="No script yet" action={<Button size="sm" onClick={() => askAgent(STAGE_PROMPTS.script(videoId), { videoId })}>Ask the script agent</Button>}>
        The script agent writes the hook, the main points and the narration at the right length, backing every claim with a researched fact.
      </EmptyState>
    );
  }
  const { script, version } = state.script;
  const results = new Map((state.audit?.results ?? []).map((result) => [result.lineId, result]));
  const facts = new Map((state.dossier?.facts ?? []).map((fact) => [fact.id, fact]));
  const words = scriptWordCount(script);
  const budget = wordBudget(script);
  const hook = script.beats[0]?.lines[0];
  const canApprove = state.stages.script.status === "awaiting_approval";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          v{version} by {state.script.authorKind === "agent" ? "the script agent" : state.script.author}
        </span>
        <span className={cn("tabular", Math.abs(words - budget) / budget > 0.1 && "text-weak")}>
          {words} / {budget} words
        </span>
        {hook ? <span className={cn("tabular", countWords(hook.text) > 12 && "text-weak")}>Hook: {countWords(hook.text)} words</span> : null}
        {state.audit ? (
          <span className="tabular">
            <span className="text-supported">{state.audit.counts.supported} supported</span> · <span className="text-weak">{state.audit.counts.weak} weak</span> ·{" "}
            <span className="text-unsupported">{state.audit.counts.unsupported} unsupported</span>
          </span>
        ) : null}
      </div>
      <ol className="flex flex-col gap-3">
        {script.beats.map((beat) => (
          <li key={beat.id} className="rounded-xl border border-border">
            <p className="border-b border-border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {beat.id} · {beat.kind}
            </p>
            <ul className="divide-y divide-border">
              {beat.lines.map((line) => {
                const result = results.get(line.id);
                return (
                  <li key={line.id} className={cn("flex flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-3", result?.verdict === "unsupported" && !result.overrideReason && "bg-unsupported/5")}>
                    <span className="tabular w-8 shrink-0 font-mono text-[11px] text-muted-foreground">{line.id.toUpperCase()}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] leading-relaxed text-foreground">{line.text}</p>
                      {line.factIds.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {line.factIds.map((factId) => {
                            const fact = facts.get(factId);
                            return (
                              <span key={factId} title={fact ? `“${fact.quote}”` : "Unknown fact"} className="cursor-help rounded bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                                {factId}
                              </span>
                            );
                          })}
                        </div>
                      ) : null}
                      {result && result.verdict !== "supported" && result.suggestion ? <p className="mt-1 text-xs text-muted-foreground">{result.suggestion}</p> : null}
                    </div>
                    {result ? <VerdictBadge verdict={result.verdict} overridden={Boolean(result.overrideReason)} /> : null}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        {canApprove ? (
          <Button
            className="pc-press"
            disabled={approve.isPending}
            onClick={async () => {
              try {
                await approve.mutateAsync({ videoId, stage: "script" } as never);
                toast.success("Script approved — fact-checking it now");
              } catch (error) {
                toast.error(errorMessage(error));
              }
            }}
          >
            Approve script
          </Button>
        ) : null}
        <Button variant="outline" className="pc-press" onClick={() => askAgent(`Revise the script for video ${videoId}. Keep every claim sourced.`, { videoId })}>
          <IconPencil className="size-4" />
          Ask for a revision
        </Button>
      </div>
    </div>
  );
}

function ClaimFixes({ videoId, claimId }: { videoId: string; claimId: string }) {
  const apply = useActionMutation("apply-fix");
  const override = useActionMutation("override-claim", { uiOnly: true });
  const [fixes, setFixes] = useState<Array<{ index: number; kind: string; label: string }> | null>(null);
  const [reason, setReason] = useState("");
  const [showOverride, setShowOverride] = useState(false);

  async function loadFixes() {
    try {
      const result = (await apply.mutateAsync({ videoId, claimId } as never)) as { fixes: Array<{ index: number; kind: string; label: string }> };
      setFixes(result.fixes);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {fixes === null ? (
          <Button size="sm" variant="secondary" className="pc-press" onClick={() => void loadFixes()} disabled={apply.isPending}>
            <IconWand className="size-4" />
            Show fixes
          </Button>
        ) : (
          fixes.map((fix) => (
            <Button
              key={fix.index}
              size="sm"
              variant={fix.kind === "cut" ? "outline" : "secondary"}
              className="pc-press max-w-full"
              disabled={apply.isPending}
              onClick={async () => {
                try {
                  await apply.mutateAsync({ videoId, claimId, fixIndex: fix.index } as never);
                  toast.success(`Applied: ${fix.label}`);
                } catch (error) {
                  toast.error(errorMessage(error));
                }
              }}
            >
              <span className="truncate">{fix.label}</span>
            </Button>
          ))
        )}
        <Button size="sm" variant="ghost" className="pc-press" onClick={() => setShowOverride((open) => !open)}>
          Override…
        </Button>
      </div>
      {showOverride ? (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await override.mutateAsync({ videoId, claimId, reason } as never);
              toast.success("Override logged in the Proof report");
              setShowOverride(false);
            } catch (error) {
              toast.error(errorMessage(error));
            }
          }}
        >
          <label className="sr-only" htmlFor={`reason-${claimId}`}>
            Reason for the override
          </label>
          <input
            id={`reason-${claimId}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why this claim is fine without a source (logged)"
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--pc-accent)]"
          />
          <Button type="submit" size="sm" variant="destructive" disabled={reason.trim().length < 8 || override.isPending}>
            Override with reason
          </Button>
        </form>
      ) : null}
    </div>
  );
}

export function QaStage({ state }: { state: VideoState }) {
  const approve = useActionMutation("approve-stage", { uiOnly: true });
  const audit = useActionMutation("audit-claims");
  const videoId = state.video.id;
  const blockers = (state.audit?.results ?? []).filter((result) => result.verdict === "unsupported" && !result.overrideReason);
  const findings = (state.qa?.findings ?? []).filter((finding) => finding.code !== "unsupported_claim");
  const canApprove = state.stages.qa.status === "awaiting_approval";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {state.qa ? (
          <div className="flex items-baseline gap-1.5">
            <span className={cn("tabular text-2xl font-semibold", state.qa.pass ? "text-supported" : "text-unsupported")}>{state.qa.score}</span>
            <span className="text-xs text-muted-foreground">Fact-check score · {state.qa.pass ? "no blockers" : "blocked"}</span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">The fact-check runs when you approve the script.</p>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="pc-press"
            disabled={audit.isPending || !state.script}
            onClick={async () => {
              try {
                await audit.mutateAsync({ videoId } as never);
              } catch (error) {
                toast.error(errorMessage(error));
              }
            }}
          >
            {audit.isPending ? "Checking…" : "Check again"}
          </Button>
          {canApprove ? (
            <Button
              size="sm"
              className="pc-press"
              disabled={approve.isPending}
              onClick={async () => {
                try {
                  await approve.mutateAsync({ videoId, stage: "qa" } as never);
                  toast.success("Fact-check approved");
                  askAgent(STAGE_PROMPTS.motion(videoId), { videoId });
                } catch (error) {
                  toast.error(errorMessage(error));
                }
              }}
            >
              Approve fact-check
            </Button>
          ) : null}
        </div>
      </div>

      {blockers.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {blockers.map((blocker) => (
            <li key={blocker.claimId} className="flex flex-col gap-2 rounded-xl border border-unsupported/40 bg-unsupported/5 p-3">
              <div className="flex items-start gap-2">
                <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-unsupported" />
                <div className="min-w-0">
                  <p className="text-[14px] text-foreground">“{blocker.text}”</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {blocker.checks.filter((check) => !check.passed).map((check) => check.detail).join(" ")}
                  </p>
                </div>
              </div>
              <ClaimFixes videoId={videoId} claimId={blocker.claimId} />
            </li>
          ))}
        </ul>
      ) : null}

      {findings.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
          {findings.map((finding, index) => (
            <li key={`${finding.code}-${index}`} className="flex items-start gap-3 p-3">
              <span
                className={cn(
                  "mt-0.5 inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[10px] font-semibold uppercase tracking-wide",
                  finding.severity === "blocker" ? "bg-unsupported/15 text-unsupported" : finding.severity === "major" ? "bg-weak/15 text-weak" : "bg-muted text-muted-foreground",
                )}
              >
                {finding.severity}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-foreground">{finding.message}</p>
                {finding.fix ? <p className="mt-0.5 text-xs text-muted-foreground">{finding.fix}</p> : null}
              </div>
              <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:block">{finding.area}</span>
            </li>
          ))}
        </ul>
      ) : state.qa ? (
        <p className="text-sm text-muted-foreground">No other findings: hook, pacing, reading speed, licences, platform rules, motion and originality all check out.</p>
      ) : null}
    </div>
  );
}
