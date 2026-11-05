import { demoMetrics, demoPublishedComposition } from "@crewcut/pipeline";
import { describe, expect, it } from "vitest";

import { explainPerformance, groupComments, learningsFromInsights } from "./explain";
import { findRetentionDrops, momentAt } from "./retention";
import { findOutliers, interestChange } from "./trends";

describe("retention", () => {
  it("finds the steep drop and ignores gentle decay", () => {
    const retention = demoMetrics()["7d"].retention;
    const drops = findRetentionDrops(retention, 60_000);
    expect(drops).toHaveLength(1);
    expect(drops[0]?.startAt).toBeGreaterThan(0.08);
    expect(drops[0]?.relativeLoss).toBeGreaterThan(0.3);
    expect(findRetentionDrops([{ at: 0, ratio: 1 }, { at: 0.5, ratio: 0.8 }, { at: 1, ratio: 0.6 }], 60_000)).toEqual([]);
  });
});

describe("explainPerformance", () => {
  const composition = demoPublishedComposition();
  const insights = explainPerformance({ videoId: "past", composition, metrics: demoMetrics()["7d"], window: "7d" });

  it("links the drop to the frame, the scene and the narration", () => {
    const drop = insights.find((insight) => insight.kind === "retention-drop");
    expect(drop?.headline).toMatch(/^Viewers dropped \d+% at \d\d:\d\d during the code card; the hook ran \d+ s\.$/);
    expect(drop?.lineId).toBeDefined();
    expect(drop?.clipId).toBeDefined();
    expect(drop?.atMs).toBeGreaterThan(0);
    expect(momentAt(composition, drop?.atMs ?? 0).clipId).toBe(drop?.clipId);
  });

  it("calls out a slow hook and grounds CTR in numbers", () => {
    expect(insights.find((insight) => insight.kind === "hook")?.learning).toMatch(/under 3 seconds/);
    expect(insights.find((insight) => insight.kind === "ctr")?.severity).toBe("positive");
    expect(insights.find((insight) => insight.kind === "timing")?.lowImpact).toBe(true);
  });

  it("produces learnings but never from low-impact advice", () => {
    const learnings = learningsFromInsights(insights, "2026-11-03T00:00:00Z");
    expect(learnings.length).toBeGreaterThanOrEqual(3);
    expect(learnings.some((learning) => learning.scope === "hook")).toBe(true);
    expect(learnings.some((learning) => learning.text.includes("Publish"))).toBe(false);
  });

  it("groups comments", () => {
    const grouped = groupComments(demoMetrics()["7d"].comments);
    expect(grouped.requests.map((comment) => comment.text)).toContain("Please do springs next!");
    expect(grouped.objections.length).toBeGreaterThanOrEqual(1);
    expect(grouped.questions.length).toBeGreaterThanOrEqual(1);
  });
});

describe("trends", () => {
  it("scores outliers against the channel median", () => {
    const history = new Map([["c1", [1000, 1200, 800]], ["c2", [50_000, 60_000]]]);
    const outliers = findOutliers(
      [
        { id: "a", title: "A", channelId: "c1", views: 9000, publishedAt: "2026-10-01" },
        { id: "b", title: "B", channelId: "c2", views: 70_000, publishedAt: "2026-10-01" },
      ],
      history,
    );
    expect(outliers.map((video) => video.id)).toEqual(["a"]);
    expect(outliers[0]?.outlierScore).toBe(9);
    expect(interestChange(100, 280)).toBe(180);
  });
});
