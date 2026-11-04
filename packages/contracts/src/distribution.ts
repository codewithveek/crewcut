import { z } from "zod";

export const PLATFORMS = [
  "youtube",
  "youtube_shorts",
  "tiktok",
  "instagram_reels",
  "facebook_reels",
  "x",
  "linkedin",
  "threads",
  "pinterest",
  "bluesky",
] as const;
export const platformSchema = z.enum(PLATFORMS);
export type Platform = (typeof PLATFORMS)[number];

export const privacySchema = z.enum(["private", "unlisted", "public"]);
export type Privacy = z.infer<typeof privacySchema>;

export const publishCopySchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(5000).default(""),
  hashtags: z.array(z.string().max(60)).max(30).default([]),
  keywords: z.array(z.string().max(60)).max(30).default([]),
  /** Sources cited in the description (from the dossier). */
  sources: z.array(z.object({ title: z.string(), url: z.string() })).max(10).default([]),
  language: z.string().min(2).max(10).default("en"),
});
export type PublishCopy = z.infer<typeof publishCopySchema>;

export const connectionStatusSchema = z.enum(["healthy", "expiring", "failed", "revoked"]);
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

// ── Analytics ───────────────────────────────────────────────────────────────

export const metricWindowSchema = z.enum(["48h", "7d", "28d"]);
export type MetricWindow = z.infer<typeof metricWindowSchema>;

export const retentionPointSchema = z.object({
  /** 0..1 through the video. */
  at: z.number().min(0).max(1),
  /** Share of starting viewers still watching (can exceed 1 with rewatches). */
  ratio: z.number().min(0).max(3),
});
export type RetentionPoint = z.infer<typeof retentionPointSchema>;

export const metricsSchema = z.object({
  views: z.number().nonnegative(),
  impressions: z.number().nonnegative().default(0),
  /** Click-through rate on impressions, 0..1. */
  ctr: z.number().min(0).max(1).default(0),
  averageViewDurationSec: z.number().nonnegative().default(0),
  averagePercentViewed: z.number().min(0).max(1.5).default(0),
  subscribersGained: z.number().default(0),
  likes: z.number().nonnegative().default(0),
  comments: z.array(z.object({ text: z.string().max(2000), likes: z.number().default(0) })).max(200).default([]),
  retention: z.array(retentionPointSchema).max(200).default([]),
  trafficSources: z.array(z.object({ source: z.string(), share: z.number().min(0).max(1) })).default([]),
});
export type Metrics = z.infer<typeof metricsSchema>;

export const insightSchema = z.object({
  id: z.string(),
  kind: z.enum(["retention-drop", "hook", "ctr", "pacing", "topic", "timing", "comments", "strength"]),
  headline: z.string().max(200),
  detail: z.string().max(1200),
  severity: z.enum(["positive", "neutral", "negative"]),
  /** Link back to the timeline. */
  atMs: z.number().nonnegative().optional(),
  clipId: z.string().optional(),
  lineId: z.string().optional(),
  evidence: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
  /** The instruction this teaches the next video's agents. */
  learning: z.string().max(400).optional(),
  lowImpact: z.boolean().default(false),
});
export type Insight = z.infer<typeof insightSchema>;

export const learningSchema = z.object({
  id: z.string(),
  scope: z.enum(["hook", "pacing", "topic", "style", "timing", "copy"]),
  text: z.string().min(3).max(400),
  evidence: z.string().max(400).default(""),
  createdAt: z.string(),
});
export type Learning = z.infer<typeof learningSchema>;

// ── Platform specs (from vid-skills `platforms.ts`, verified 2026-10) ───────

export interface PlatformSpec {
  id: Platform;
  label: string;
  minSec: number;
  maxSec: number;
  maxBytes: number;
  aspects: readonly string[];
  titleMax?: number;
  captionMax: number;
  /** What must happen before public posting works. */
  auditNote: string;
  /** Quota or rate limits to design around. */
  limitNote: string;
  /** Wired end to end in this build. */
  supported: boolean;
}

const GiB = 1024 ** 3;

export const PLATFORM_SPECS: Record<Platform, PlatformSpec> = {
  youtube: {
    id: "youtube", label: "YouTube", minSec: 1, maxSec: 43_200, maxBytes: 256 * GiB, aspects: ["16:9", "9:16", "1:1", "4:5"], titleMax: 100, captionMax: 5000,
    auditNote: "Uploads from unverified API projects (created after 28 Jul 2020) stay private until Google's compliance audit.",
    limitNote: "Since 1 Jun 2026, 100 uploads per project per day in their own quota bucket.", supported: true,
  },
  youtube_shorts: {
    id: "youtube_shorts", label: "YouTube Shorts", minSec: 1, maxSec: 180, maxBytes: 256 * GiB, aspects: ["9:16", "1:1"], titleMax: 100, captionMax: 5000,
    auditNote: "Same audit as YouTube; vertical or square ≤ 3 min is classified as a Short automatically.",
    limitNote: "Shares the YouTube upload quota.", supported: true,
  },
  tiktok: { id: "tiktok", label: "TikTok", minSec: 3, maxSec: 600, maxBytes: 4 * GiB, aspects: ["9:16"], captionMax: 2200, auditNote: "Unaudited apps can only post privately; needs TikTok's audit.", limitNote: "6 post requests per minute per user token, plus daily caps.", supported: false },
  instagram_reels: { id: "instagram_reels", label: "Instagram Reels", minSec: 3, maxSec: 900, maxBytes: 1 * GiB, aspects: ["9:16"], captionMax: 2200, auditNote: "Meta App Review per permission; Business or Creator accounts only.", limitNote: "100 API-published posts per rolling 24 h.", supported: false },
  facebook_reels: { id: "facebook_reels", label: "Facebook Reels", minSec: 3, maxSec: 90, maxBytes: 1 * GiB, aspects: ["9:16"], captionMax: 2200, auditNote: "App Review and Live mode.", limitNote: "25 posts per Page per rolling 24 h.", supported: false },
  x: { id: "x", label: "X", minSec: 0.5, maxSec: 1200, maxBytes: 8 * GiB, aspects: ["16:9", "9:16", "1:1"], captionMax: 280, auditNote: "Pay-per-use API, available immediately.", limitNote: "About $0.015 per post ($0.20 with a link).", supported: false },
  linkedin: { id: "linkedin", label: "LinkedIn", minSec: 3, maxSec: 1800, maxBytes: 5 * GiB, aspects: ["16:9", "9:16", "1:1", "4:5"], captionMax: 3000, auditNote: "LinkedIn Partner Program approval, often weeks to months.", limitNote: "Rate limits not published.", supported: false },
  threads: { id: "threads", label: "Threads", minSec: 1, maxSec: 300, maxBytes: 1 * GiB, aspects: ["9:16", "1:1", "16:9"], captionMax: 500, auditNote: "Meta App Review.", limitNote: "Needs a public HTTPS video URL.", supported: false },
  pinterest: { id: "pinterest", label: "Pinterest", minSec: 4, maxSec: 900, maxBytes: 2 * GiB, aspects: ["9:16", "1:1"], titleMax: 100, captionMax: 800, auditNote: "Standard API access review.", limitNote: "Per-app rate limits.", supported: false },
  bluesky: { id: "bluesky", label: "Bluesky", minSec: 1, maxSec: 180, maxBytes: 100 * 1024 ** 2, aspects: ["9:16", "16:9", "1:1"], captionMax: 300, auditNote: "App password; no audit.", limitNote: "Video service daily limits per account.", supported: false },
};
