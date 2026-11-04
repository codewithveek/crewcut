import type { ArtDirectionBrief } from "@proofcut/composition";
import type {
  ApprovalEvent,
  AuditReport,
  Dossier,
  Idea,
  Insight,
  QaReport,
  Script,
  Stage,
  StageStates,
} from "@proofcut/contracts";

/** Shape of the `get-video` action's result, as the board reads it. */
export interface VideoState {
  video: {
    id: string;
    title: string;
    brief: string;
    ratio: string;
    platforms: string[];
    status: string;
    isDemo: boolean;
    projectId: string;
    pickedIdeaId: string | null;
    scriptVersion: number;
    compositionVersion: number;
    updatedAt: string;
  };
  stages: StageStates;
  progress: { done: number; total: number; current: Stage; waiting: Stage[] };
  ideas: Idea[];
  dossier: Dossier | null;
  script: { version: number; script: Script; authorKind: string; author: string } | null;
  audit: AuditReport | null;
  qa: QaReport | null;
  composition: {
    version: number;
    label: string;
    summary: {
      durationMs: number;
      ratio: string;
      sceneCount: number;
      brief: Pick<ArtDirectionBrief, "mood" | "layoutGrid" | "motionSignature" | "palette" | "typePairing">;
      tracks: Array<{ id: string; name: string; kind: string; clips: Array<{ id: string; name?: string; startMs: number; endMs: number; text?: string }> }>;
    };
  } | null;
  sources: Array<{ id: string; kind: string; title: string; url: string | null; publisher: string | null; length: number; retrievedAt: string; redactions: number }>;
  renders: Array<{ id: string; status: string; progress: number; stage: string; ratio: string; compositionVersion: number; outputFile: string | null; outputBytes: number | null; error: string | null; createdAt: string }>;
  publishJobs: Array<{
    id: string;
    platform: string;
    status: string;
    privacy: string;
    renderJobId: string;
    copy: { title: string; description: string; hashtags: string[]; sources: Array<{ title: string; url: string }> };
    warnings: string[];
    url: string | null;
    error: string | null;
    approvedBy: string | null;
  }>;
  approvals: ApprovalEvent[];
  insights: Array<Insight & { window: string }>;
}
