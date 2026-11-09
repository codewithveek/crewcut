import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import type { Stage } from "@crewcut/contracts";
import { IconAlertTriangle, IconCircleCheck, IconLoader2, IconPlane, IconPlayerPause, IconPlayerPlay, IconPlayerStop } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ds";
import { STAGE_LABELS, errorMessage, formatAgo, runAutopilot } from "@/lib/crewcut";

export { runAutopilot };
import { cn } from "@/lib/utils";

/**
 * Autopilot in the app: the hint next to the idea box, the panel on the
 * pipeline page, and a watchdog that runs on every page. The watchdog resumes
 * a run that stopped working (a few times at most; the server decides whether
 * it really stalled, so several open tabs can't double up) and says when a
 * video is ready or needs the person.
 */

export type AutopilotPhase = "making" | "paused" | "needs_you" | "exporting" | "ready" | "stopped";

export interface AutopilotInfo {
  on: boolean;
  phase: AutopilotPhase;
  stage: Stage;
  qaRounds: number;
  maxQaRounds: number;
  reason: string | null;
  decisions: Array<{ at: string; stage: string; text: string }>;
  startedAt: string | null;
  lastActivityAt: string | null;
  resumes: number;
  canAutoResume: boolean;
  renderId: string | null;
}

export const AUTOPILOT_HINT = "The crew researches, writes, fact-checks (and fixes what fails), animates, voices and exports the video on its own. You come back to a finished draft to review, edit or publish. Publishing always stays with you.";

/** The person's videos on autopilot (refreshed every 30 s). */
export function useAutopilotList(enabled = true) {
  const query = useActionQuery("list-autopilot", {} as never, { enabled, refetchInterval: 30_000, staleTime: 10_000 } as never);
  return ((query.data as { videos?: Array<AutopilotInfo & { id: string; title: string }> } | undefined)?.videos ?? []);
}

async function setAutopilot(videoId: string, action: "start" | "resume" | "stop" | "hold", auto = false, reason?: string): Promise<boolean> {
  const result = (await callAction("set-autopilot" as never, { videoId, action, auto, ...(reason ? { reason } : {}) } as never)) as { changed: boolean };
  return result.changed;
}

const NO_AI = "The crew couldn't start: no AI model is connected. Connect one in Settings (Builder.io or your own key), then press Resume.";

/**
 * Starts (or continues) the crew's background run. When it can't start (most
 * often no AI model is connected), the video waits for the person with the
 * reason instead of looking busy. Resolves true when the crew is at work.
 */
export async function launchAutopilot(videoId: string, options: { resume?: boolean; quiet?: boolean } = {}): Promise<boolean> {
  const delivered = await runAutopilot(videoId, options.resume ?? false).catch(() => false);
  if (delivered) return true;
  await setAutopilot(videoId, "hold", false, NO_AI).catch(() => undefined);
  if (!options.quiet) toast.error("Autopilot couldn't start the crew", { description: "Connect an AI model in Settings, then press Resume on the video.", action: { label: "Connect AI", onClick: () => window.location.assign("/settings/agent") }, duration: 15_000 });
  return false;
}

/** Mounted once in the app shell: resumes stalled runs and announces finished ones. */
export function AutopilotWatchdog() {
  const videos = useAutopilotList();
  const navigate = useNavigate();
  const seen = useRef(new Map<string, AutopilotPhase>());
  const resuming = useRef(new Set<string>());
  useEffect(() => {
    for (const video of videos) {
      const before = seen.current.get(video.id);
      seen.current.set(video.id, video.phase);
      // Announce changes only (not what was already the case when the page opened).
      if (before && before !== video.phase) {
        if (video.phase === "ready") toast.success(`“${video.title}” is ready`, { description: "Autopilot finished the video. Review it, edit it or publish it.", action: { label: "Open", onClick: () => navigate(`/videos/${video.id}`) }, duration: 12_000 });
        if (video.phase === "needs_you") toast.warning(`Autopilot needs you on “${video.title}”`, { description: video.reason ?? undefined, action: { label: "Open", onClick: () => navigate(`/videos/${video.id}`) }, duration: 12_000 });
      }
      if (video.canAutoResume && !resuming.current.has(video.id) && document.visibilityState === "visible") {
        resuming.current.add(video.id);
        void setAutopilot(video.id, "resume", true)
          .then(async (changed) => {
            if (!changed) return;
            if (await launchAutopilot(video.id, { resume: true, quiet: true })) toast.message(`Autopilot picked “${video.title}” up where it stopped`);
          })
          .catch(() => undefined)
          .finally(() => window.setTimeout(() => resuming.current.delete(video.id), 5 * 60 * 1000));
      }
    }
  }, [videos, navigate]);
  return null;
}

const PHASE_COPY: Record<AutopilotPhase, { title: string; tone: string }> = {
  making: { title: "Autopilot is making your video", tone: "text-ds-accent" },
  paused: { title: "Autopilot stopped working", tone: "text-ds-warning" },
  needs_you: { title: "Autopilot needs you", tone: "text-ds-warning" },
  exporting: { title: "Autopilot is exporting your video", tone: "text-ds-accent" },
  ready: { title: "Your video is ready", tone: "text-supported" },
  stopped: { title: "Autopilot is off", tone: "text-ds-text-2" },
};

const STAGE_ORDER: Stage[] = ["trend", "research", "script", "qa", "motion", "voice", "publish"];

/** The pipeline page's autopilot panel: where it is, what it decided, and the controls. */
export function AutopilotPanel({ videoId, info, exportProgress, onChanged }: { videoId: string; info: AutopilotInfo; exportProgress: number | null; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const queryClient = useQueryClient();
  const act = async (action: "resume" | "stop") => {
    setBusy(true);
    try {
      const changed = await setAutopilot(videoId, action);
      const working = changed && action === "resume" ? await launchAutopilot(videoId, { resume: true }) : true;
      if (working) toast.success(action === "resume" ? "Autopilot is back at work" : "Autopilot is off. The remaining steps wait for you.");
      void queryClient.invalidateQueries({ queryKey: ["action", "list-autopilot"] });
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const copy = PHASE_COPY[info.phase];
  const stageIndex = info.phase === "ready" || info.phase === "exporting" ? STAGE_ORDER.length - 1 : Math.max(0, STAGE_ORDER.indexOf(info.stage));
  const decisions = [...info.decisions].reverse();
  const shown = showAll ? decisions : decisions.slice(0, 3);
  const working = info.phase === "making" || info.phase === "exporting";
  return (
    <section aria-label="Autopilot" className="ds-card flex flex-col gap-3 p-4" aria-live="polite">
      <div className="flex flex-wrap items-start gap-3">
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full bg-ds-surface-2", copy.tone)}>
          {working ? <IconLoader2 className="size-5 motion-safe:animate-spin" /> : info.phase === "ready" ? <IconCircleCheck className="size-5" /> : info.phase === "needs_you" || info.phase === "paused" ? <IconAlertTriangle className="size-5" /> : <IconPlane className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-ds-text">{copy.title}</p>
          <p className="text-[13px] text-ds-text-2">
            {info.phase === "making"
              ? `${STAGE_LABELS[info.stage].agent} is working${info.qaRounds > 0 ? ` · fact-check round ${info.qaRounds + 1} of ${info.maxQaRounds}` : ""}. You can close this page: it carries on.`
              : info.phase === "exporting"
                ? `Exporting${exportProgress !== null ? ` · ${Math.round(exportProgress * 100)}%` : ""}. Almost there.`
                : info.phase === "ready"
                  ? "Review it in the editor, change anything you like, then export or publish it."
                  : info.phase === "paused"
                    ? `It stopped at ${STAGE_LABELS[info.stage].agent.toLowerCase()}${info.lastActivityAt ? ` (last work ${formatAgo(info.lastActivityAt)})` : ""}. Resume to carry on from there.`
                    : info.phase === "needs_you"
                      ? info.reason ?? "Something needs your decision."
                      : "The steps wait for you again. Switch autopilot back on to let the crew finish."}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {info.phase === "ready" ? (
            <Button asChild className="pc-press">
              <Link to={`/videos/${videoId}/edit`}>
                <IconPlayerPlay className="size-4" /> Review in the editor
              </Link>
            </Button>
          ) : null}
          {info.phase === "paused" || info.phase === "needs_you" ? (
            <Button className="pc-press" disabled={busy} onClick={() => void act("resume")}>
              <IconPlayerPlay className="size-4" /> {info.phase === "needs_you" ? "I've fixed it, resume" : "Resume"}
            </Button>
          ) : null}
          {info.on && info.phase !== "ready" && info.phase !== "exporting" ? (
            <Button variant="outline" className="pc-press" disabled={busy} onClick={() => void act("stop")}>
              {info.phase === "making" ? <IconPlayerPause className="size-4" /> : <IconPlayerStop className="size-4" />} Take over
            </Button>
          ) : null}
        </div>
      </div>
      {info.phase !== "stopped" ? (
        <ol className="flex gap-1" aria-label="Steps">
          {STAGE_ORDER.map((stage, index) => (
            <li key={stage} title={stage === "publish" ? "Export" : STAGE_LABELS[stage].agent} className={cn("h-1.5 flex-1 rounded-full", index < stageIndex || info.phase === "ready" ? "bg-ds-accent" : index === stageIndex ? (working ? "bg-ds-accent/50 motion-safe:animate-pulse" : "bg-ds-warning") : "bg-ds-surface-3")} />
          ))}
        </ol>
      ) : null}
      {decisions.length ? (
        <div className="flex flex-col gap-1">
          <p className="ds-overline text-ds-text-3">What the crew decided</p>
          <ul className="flex flex-col gap-1">
            {shown.map((decision) => (
              <li key={`${decision.at}-${decision.text}`} className="flex gap-2 text-[13px] text-ds-text-2">
                <span className="w-16 shrink-0 text-[11px] text-ds-text-3 tabular">{formatAgo(decision.at)}</span>
                <span className="min-w-0">{decision.text}</span>
              </li>
            ))}
          </ul>
          {decisions.length > 3 ? (
            <button type="button" className="self-start text-[12px] text-ds-text-2 hover:text-ds-text" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show less" : `Show all ${decisions.length}`}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** "Finish on autopilot" for a video that's mid-way and not on autopilot. */
export function StartAutopilotButton({ videoId, onStarted }: { videoId: string; onStarted: () => void }) {
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  return (
    <Button
      variant="outline"
      className="pc-press"
      disabled={busy}
      title={AUTOPILOT_HINT}
      onClick={async () => {
        if (!window.confirm(`Let the crew finish this video on autopilot?\n\n${AUTOPILOT_HINT}`)) return;
        setBusy(true);
        try {
          await setAutopilot(videoId, "start");
          if (await launchAutopilot(videoId, { resume: true })) toast.success("Autopilot is finishing your video. You can close this page.");
          void queryClient.invalidateQueries({ queryKey: ["action", "list-autopilot"] });
          onStarted();
        } catch (error) {
          toast.error(errorMessage(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <IconPlane className="size-4" /> Finish on autopilot
    </Button>
  );
}
