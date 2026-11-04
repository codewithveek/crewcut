import type { Composition } from "@proofcut/composition";
import type { Insight, Learning, Metrics, MetricWindow } from "@proofcut/contracts";

import { describeMoment, findRetentionDrops, momentAt, ratioAt } from "./retention";

export interface ChannelBaseline {
  ctr: number;
  averagePercentViewed: number;
  /** Retention at 30 s, for short-form comparisons. */
  retentionAt30s?: number;
}

export const DEFAULT_BASELINE: ChannelBaseline = { ctr: 0.05, averagePercentViewed: 0.45 };

export interface ExplainInput {
  videoId: string;
  composition: Composition;
  metrics: Metrics;
  window: MetricWindow;
  baseline?: ChannelBaseline;
}

/**
 * The analytics agent's deterministic analysis: every insight is grounded in
 * a number and, where it can be, linked to a moment on the timeline. The
 * agent may add narrative, but the evidence is computed here.
 */
export function explainPerformance(input: ExplainInput): Insight[] {
  const { composition, metrics } = input;
  const baseline = input.baseline ?? DEFAULT_BASELINE;
  const insights: Insight[] = [];
  const id = (suffix: string) => `${input.videoId}:${input.window}:${suffix}`;
  const durationMs = composition.durationMs;

  const voice = composition.tracks.find((track) => track.kind === "audio" && track.role === "voice");
  const firstLine = voice?.kind === "audio" ? [...voice.clips].sort((a, b) => a.startMs - b.startMs)[0] : undefined;
  const hookEndsMs = firstLine ? firstLine.startMs + firstLine.durationMs : undefined;

  for (const [index, drop] of findRetentionDrops(metrics.retention, durationMs).entries()) {
    const moment = momentAt(composition, drop.startMs);
    const what = describeMoment(moment);
    const lossPct = Math.round(drop.relativeLoss * 100);
    const hookNote = index === 0 && hookEndsMs !== undefined && hookEndsMs > 3000 ? `; the hook ran ${(hookEndsMs / 1000).toFixed(0)} s` : "";
    insights.push({
      id: id(`drop-${index + 1}`),
      kind: "retention-drop",
      headline: `Viewers dropped ${lossPct}% at ${moment.timecode} during ${what}${hookNote}.`,
      detail: `Retention fell from ${Math.round(drop.fromRatio * 100)}% to ${Math.round(drop.toRatio * 100)}% between ${(drop.startMs / 1000).toFixed(1)} s and ${(drop.endMs / 1000).toFixed(1)} s.${moment.lineText ? ` The narration was: "${moment.lineText}"` : ""}`,
      severity: "negative",
      atMs: drop.startMs,
      ...(moment.clipId ? { clipId: moment.clipId } : {}),
      ...(moment.lineId ? { lineId: moment.lineId } : {}),
      evidence: { lossPct, fromPct: Math.round(drop.fromRatio * 100), toPct: Math.round(drop.toRatio * 100), window: input.window },
      learning:
        what === "the code card"
          ? "Hold code on screen longer and highlight one line at a time; don't open on code."
          : `Tighten ${what} at this point: it's where viewers leave.`,
      lowImpact: false,
    });
  }

  if (hookEndsMs !== undefined) {
    const at3s = ratioAt(metrics.retention, Math.min(1, 3000 / durationMs));
    if (hookEndsMs > 3500 || at3s < 0.85) {
      insights.push({
        id: id("hook"),
        kind: "hook",
        headline: `The hook took ${(hookEndsMs / 1000).toFixed(1)} s; ${Math.round(at3s * 100)}% were still watching at 3 s.`,
        detail: "Short-form viewers decide in the first seconds. Lead with the claim or the question, not the setup.",
        severity: "negative",
        atMs: 0,
        ...(firstLine?.lineId ? { lineId: firstLine.lineId } : {}),
        evidence: { hookSeconds: Math.round(hookEndsMs / 100) / 10, retentionAt3sPct: Math.round(at3s * 100) },
        learning: "Keep the hook under 3 seconds and 12 words.",
        lowImpact: false,
      });
    }
  }

  if (metrics.impressions > 0) {
    const relative = metrics.ctr / Math.max(1e-6, baseline.ctr);
    insights.push({
      id: id("ctr"),
      kind: "ctr",
      headline: `Click-through was ${(metrics.ctr * 100).toFixed(1)}%, ${relative >= 1 ? `${Math.round((relative - 1) * 100)}% above` : `${Math.round((1 - relative) * 100)}% below`} your usual ${(baseline.ctr * 100).toFixed(1)}%.`,
      detail: `${metrics.impressions.toLocaleString("en-US")} impressions → ${metrics.views.toLocaleString("en-US")} views.`,
      severity: relative >= 1.1 ? "positive" : relative < 0.85 ? "negative" : "neutral",
      evidence: { ctrPct: Math.round(metrics.ctr * 1000) / 10, baselinePct: Math.round(baseline.ctr * 1000) / 10, impressions: metrics.impressions },
      ...(relative >= 1.1 ? { learning: "This title and thumbnail style beat the channel average; reuse its structure." } : relative < 0.85 ? { learning: "Test a more concrete title: name the outcome or the number." } : {}),
      lowImpact: false,
    });
  }

  const rewatch = metrics.retention.find((point) => point.ratio > 1.02);
  if (rewatch) {
    const moment = momentAt(composition, Math.round(rewatch.at * durationMs));
    insights.push({
      id: id("rewatch"),
      kind: "strength",
      headline: `People rewatched ${describeMoment(moment)} at ${moment.timecode}.`,
      detail: "Retention above 100% means viewers scrubbed back to see it again.",
      severity: "positive",
      atMs: moment.atMs,
      ...(moment.clipId ? { clipId: moment.clipId } : {}),
      evidence: { ratioPct: Math.round(rewatch.ratio * 100) },
      learning: `More moments like ${describeMoment(moment)}: they earn rewatches.`,
      lowImpact: false,
    });
  }

  const comments = groupComments(metrics.comments);
  if (comments.questions.length + comments.objections.length + comments.requests.length > 0) {
    const top = [...comments.requests, ...comments.questions, ...comments.objections].sort((a, b) => b.likes - a.likes)[0];
    insights.push({
      id: id("comments"),
      kind: "comments",
      headline: `${plural(comments.questions.length, "question")}, ${plural(comments.objections.length, "objection")}, ${plural(comments.requests.length, "request")} in the comments.`,
      detail: top ? `Most-liked: "${top.text}" (${top.likes} likes).` : "",
      severity: "neutral",
      evidence: { questions: comments.questions.length, objections: comments.objections.length, requests: comments.requests.length },
      ...(comments.requests[0] ? { learning: `Viewers asked for: "${comments.requests[0].text}". Consider it for the next video.` } : {}),
      lowImpact: false,
    });
  }

  insights.push({
    id: id("timing"),
    kind: "timing",
    headline: "Publish time had little effect here.",
    detail: "YouTube says timing matters mainly for time-sensitive videos; evergreen videos even out within weeks. Treat time-of-day advice as low impact.",
    severity: "neutral",
    evidence: {},
    lowImpact: true,
  });
  return insights;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export interface GroupedComments {
  questions: Array<{ text: string; likes: number }>;
  objections: Array<{ text: string; likes: number }>;
  requests: Array<{ text: string; likes: number }>;
}

export function groupComments(comments: ReadonlyArray<{ text: string; likes: number }>): GroupedComments {
  const grouped: GroupedComments = { questions: [], objections: [], requests: [] };
  for (const comment of comments) {
    const text = comment.text.trim();
    if (/\b(please|can you|could you|do .* next|make one|next video|would love)\b/i.test(text)) grouped.requests.push(comment);
    else if (/\b(wrong|but|isn'?t|not true|too fast|too slow|lost me|confus|disagree|actually)\b/i.test(text)) grouped.objections.push(comment);
    else if (text.includes("?")) grouped.questions.push(comment);
  }
  return grouped;
}

/** Turns insights into workspace learnings the script and motion agents read first. */
export function learningsFromInsights(insights: readonly Insight[], now: string): Learning[] {
  return insights
    .filter((insight) => insight.learning && !insight.lowImpact)
    .map((insight) => ({
      id: `learning:${insight.id}`,
      scope: insight.kind === "hook" ? "hook" : insight.kind === "ctr" ? "copy" : insight.kind === "comments" ? "topic" : insight.kind === "retention-drop" ? "pacing" : "style",
      text: insight.learning as string,
      evidence: insight.headline,
      createdAt: now,
    }));
}
