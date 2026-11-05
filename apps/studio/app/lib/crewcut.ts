import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
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
  trend: (id) => `Run the trend stage for video ${id}: research the idea and save 3–5 ranked ideas with evidence using find-trends.`,
  research: (id) => `Run the research stage for video ${id}: gather sources for the picked idea with add-source, then build a dossier where every fact quotes its source verbatim.`,
  script: (id) => `Write the script for video ${id}. Read the learnings first; cite dossier facts on every factual line.`,
  qa: (id) => `Run QA on video ${id} with audit-claims and fix what you can with apply-fix. Tell me what needs my decision.`,
  motion: (id) => `Be the motion director for video ${id}: write a fresh art direction brief and compose a freeform video.`,
  voice: (id) => `Do the voice and sound stage for video ${id} with synthesize-voice, then check pacing.`,
  publish: (id) => `Prepare the YouTube post for video ${id}: render if needed, then write the title, description and hashtags with prepare-post (private).`,
  analytics: (id) => `Pull 7-day metrics for video ${id}, explain the performance, and save the learnings.`,
};

export function askAgent(message: string, context?: Record<string, unknown>): void {
  sendToAgentChat({
    message,
    ...(context ? { context: JSON.stringify(context) } : {}),
    submit: true,
    openSidebar: true,
  } as Parameters<typeof sendToAgentChat>[0]);
}

/** Opens the agent with context attached and the composer ready for the person's request. */
export function prefillAgent(context: Record<string, unknown>, message = ""): void {
  sendToAgentChat({ message, context: JSON.stringify(context), submit: false, openSidebar: true } as Parameters<typeof sendToAgentChat>[0]);
}

export function formatAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const time = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`).getTime();
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
