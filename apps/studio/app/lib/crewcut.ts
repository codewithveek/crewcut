import { sendToAgentChat, sendToAgentChatAndConfirm } from "@agent-native/core/client/agent-chat";
import { STAGE_LABELS, type Stage, type StageStatus } from "@crewcut/contracts";

export { STAGE_LABELS };
export const STAGE_ORDER: readonly Stage[] = ["trend", "research", "script", "qa", "motion", "voice", "publish", "analytics"];

export const STATUS_META: Record<StageStatus, { label: string; tone: "idle" | "running" | "waiting" | "done" | "blocked" | "failed" }> = {
  idle: { label: "Not started", tone: "idle" },
  running: { label: "Working", tone: "running" },
  awaiting_approval: { label: "Needs your OK", tone: "waiting" },
  approved: { label: "Approved", tone: "done" },
  notified: { label: "Done", tone: "done" },
  sent_back: { label: "Sent back", tone: "blocked" },
  blocked: { label: "Blocked", tone: "blocked" },
  failed: { label: "Failed", tone: "failed" },
};

/** Which stages ask the agent (AI work) vs. run a deterministic action directly. */
export const STAGE_PROMPTS: Record<Stage, (videoId: string) => string> = {
  trend: (id) => `Find 3–5 strong ideas for video ${id}, ranked, with the evidence for each.`,
  research: (id) => `Research the picked idea for video ${id}: gather sources and collect facts that quote them word for word.`,
  script: (id) => `Write the script for video ${id}, using what we've learned from past videos. Back every factual line with a researched fact.`,
  qa: (id) => `Fact-check video ${id} and fix what you can. Tell me what needs my decision.`,
  motion: (id) => `Design and animate video ${id} with a fresh look of its own.`,
  voice: (id) => `Record the voice-over for video ${id}, then check the pacing.`,
  publish: (id) => `Prepare the YouTube post for video ${id}: export it if needed, then write the title, description and hashtags. Keep it private.`,
  analytics: (id) => `Get the first week's results for video ${id}, explain how it did, and note what to repeat next time.`,
};

export function askAgent(message: string, context?: Record<string, unknown>): void {
  sendToAgentChat({
    message,
    ...(context ? { context: JSON.stringify(context) } : {}),
    submit: true,
    openSidebar: true,
  } as Parameters<typeof sendToAgentChat>[0]);
}

/**
 * Puts the crew to work on a video on autopilot: a background agent run (its
 * own chat thread, shown in the runs tray) that makes the whole video. The run
 * lives on the server, so it carries on when the page or tab closes.
 * Resolves false when the run couldn't start (most often: no AI model connected).
 */
export async function runAutopilot(videoId: string, resume = false): Promise<boolean> {
  const result = await sendToAgentChatAndConfirm({
    chatTarget: "local",
    message: resume
      ? `Continue autopilot for video ${videoId}: load the crewcut-autopilot skill, check where it got to with get-video, and carry on from there to an exported draft.`
      : `Run autopilot for video ${videoId}: load the crewcut-autopilot skill and make the whole video, from ideas to an exported draft, without waiting for me.`,
    context: JSON.stringify({ videoId, autopilot: true }),
    submit: true,
    newTab: true,
    background: true,
    openSidebar: false,
  } as Parameters<typeof sendToAgentChatAndConfirm>[0], { timeoutMs: 20_000 });
  return result.delivered;
}

/** Opens the agent with context attached and the composer ready for the person's request. */
export function prefillAgent(context: Record<string, unknown>, message = ""): void {
  sendToAgentChat({ message, context: JSON.stringify(context), submit: false, openSidebar: true } as Parameters<typeof sendToAgentChat>[0]);
}

/**
 * Milliseconds for the timestamps the app stores: ISO strings, SQLite-style
 * "2026-11-07 05:37:56" (UTC) and Postgres-style "2026-11-07 05:37:56.548+00".
 */
export function parseTimestamp(value: string): number {
  let text = value.trim().replace(" ", "T");
  if (/[+-]\d\d$/.test(text)) text += ":00";
  else if (/[+-]\d\d\d\d$/.test(text)) text = text.replace(/([+-]\d\d)(\d\d)$/, "$1:$2");
  else if (!/(Z|[+-]\d\d:\d\d)$/i.test(text)) text += "Z";
  return new Date(text).getTime();
}

export function formatAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const time = parseTimestamp(iso);
  if (Number.isNaN(time)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Something went wrong.";
}
