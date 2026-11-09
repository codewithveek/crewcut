/**
 * Which video and pipeline stage a model call was for, so the admin cost page
 * can show what a video costs to make, stage by stage. Worked out from the
 * conversation itself: the tool calls this response makes say what the model
 * is doing; otherwise the most recent tool call before it does.
 */

export type CostStage = "trend" | "research" | "script" | "qa" | "motion" | "voice" | "publish" | "analytics" | "edit" | "chat";

const STAGE_BY_ACTION: Record<string, CostStage> = {
  "find-trends": "trend",
  "add-source": "research",
  "read-source": "research",
  "build-dossier": "research",
  "write-script": "script",
  "edit-line": "script",
  "rewrite-hook": "script",
  "audit-claims": "qa",
  "apply-fix": "qa",
  "check-sameness": "qa",
  "compose-video": "motion",
  "set-art-direction": "motion",
  "apply-motion-preset": "motion",
  "synthesize-voice": "voice",
  "set-music": "voice",
  "render-video": "publish",
  "prepare-post": "publish",
  "get-render-link": "publish",
  "pull-metrics": "analytics",
  "explain-performance": "analytics",
  "list-metrics": "analytics",
  "edit-composition": "edit",
  "add-clip": "edit",
  "move-clip": "edit",
  "trim-clip": "edit",
  "split-clip": "edit",
  "delete-clips": "edit",
  "set-keyframe": "edit",
  "add-layer": "edit",
  "update-layer": "edit",
  "remove-layers": "edit",
  "set-transition": "edit",
  "update-clip": "edit",
  "use-template": "edit",
};

const VIDEO_ID = /\bvid_[A-Za-z0-9]{6,40}\b/;

interface MessageLike {
  role: string;
  content: Array<{ type: string; name?: string; input?: unknown; text?: string }>;
}

function videoIdIn(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["videoId", "video_id", "id"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && (key !== "id" || candidate.startsWith("vid_"))) return candidate;
  }
  return undefined;
}

export function stageForAction(name: string | undefined): CostStage | undefined {
  return name ? STAGE_BY_ACTION[name] : undefined;
}

export interface Attribution {
  videoId?: string;
  stage: CostStage;
}

/**
 * `emitted` are the tool calls in this model response (known after it
 * streams); `messages` is the conversation the model was given.
 */
export function attribute(messages: readonly MessageLike[], emitted: ReadonlyArray<{ name: string; input: unknown }> = []): Attribution {
  let videoId: string | undefined;
  let stage: CostStage | undefined;

  for (const call of emitted) {
    videoId ??= videoIdIn(call.input);
    stage ??= stageForAction(call.name);
  }

  for (let index = messages.length - 1; index >= 0 && (!videoId || !stage); index--) {
    const parts = messages[index]?.content ?? [];
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex--) {
      const part = parts[partIndex];
      if (!part) continue;
      if (part.type === "tool-call") {
        videoId ??= videoIdIn(part.input);
        stage ??= stageForAction(part.name);
      } else if (part.type === "text" && !videoId && typeof part.text === "string") {
        videoId = VIDEO_ID.exec(part.text)?.[0];
      }
    }
  }
  return { videoId, stage: stage ?? "chat" };
}
