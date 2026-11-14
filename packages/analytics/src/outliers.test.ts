import { describe, expect, it } from "vitest";

import { type YouTubeGet, isoDurationSeconds, searchYouTubeOutliers } from "./outliers";

const NOW = Date.parse("2026-11-11T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

interface FakeVideo {
  id: string;
  channelId: string;
  views?: number;
  ageDays: number;
  duration?: string;
}

/** A tiny YouTube: search returns `found`; each channel's uploads are its videos, newest first. */
function fakeYouTube(videos: FakeVideo[], found: string[], channels: Record<string, { subscribers?: number; hidden?: boolean }>) {
  const calls: Array<{ resource: string; params: Record<string, string> }> = [];
  const byId = new Map(videos.map((video) => [video.id, video]));
  const get: YouTubeGet = async (resource, params) => {
    calls.push({ resource, params });
    if (resource === "search") return { items: found.map((videoId) => ({ id: { kind: "youtube#video", videoId } })) };
    if (resource === "videos") {
      return {
        items: params.id!
          .split(",")
          .map((id) => byId.get(id))
          .filter(Boolean)
          .map((video) => ({
            id: video!.id,
            snippet: { title: `Video ${video!.id}`, channelId: video!.channelId, channelTitle: `Channel ${video!.channelId}`, publishedAt: daysAgo(video!.ageDays) },
            statistics: video!.views === undefined ? {} : { viewCount: String(video!.views) },
            contentDetails: { duration: video!.duration ?? "PT8M" },
          })),
      };
    }
    if (resource === "channels") {
      return {
        items: params.id!.split(",").flatMap((id) =>
          channels[id]
            ? [
                {
                  id,
                  contentDetails: { relatedPlaylists: { uploads: `UU-${id}` } },
                  statistics: { subscriberCount: String(channels[id]!.subscribers ?? 1000), hiddenSubscriberCount: Boolean(channels[id]!.hidden) },
                },
              ]
            : [],
        ),
      };
    }
    const channelId = params.playlistId!.slice(3);
    return {
      items: videos
        .filter((video) => video.channelId === channelId)
        .sort((a, b) => a.ageDays - b.ageDays)
        .slice(0, Number(params.maxResults))
        .map((video) => ({ contentDetails: { videoId: video.id } })),
    };
  };
  return { get, calls };
}

function channelHistory(channelId: string, views: number[], startAge = 10): FakeVideo[] {
  return views.map((count, index) => ({ id: `${channelId}-h${index}`, channelId, views: count, ageDays: startAge + index * 7 }));
}

describe("isoDurationSeconds", () => {
  it("reads YouTube durations", () => {
    expect(isoDurationSeconds("PT1H2M3S")).toBe(3723);
    expect(isoDurationSeconds("PT45S")).toBe(45);
    expect(isoDurationSeconds("P1DT1S")).toBe(86_401);
    expect(isoDurationSeconds("PT")).toBeNull();
    expect(isoDurationSeconds("P")).toBeNull();
    expect(isoDurationSeconds("3 minutes")).toBeNull();
    expect(isoDurationSeconds(undefined)).toBeNull();
  });
});

describe("searchYouTubeOutliers", () => {
  it("scores a video against its own channel's usual views, without itself", async () => {
    const videos = [
      { id: "hit", channelId: "A", views: 120_000, ageDays: 20 },
      ...channelHistory("A", [10_000, 12_000, 8_000, 11_000, 9_000, 10_500]),
      { id: "normal", channelId: "B", views: 50_000, ageDays: 30 },
      ...channelHistory("B", [40_000, 55_000, 48_000, 52_000, 45_000]),
    ];
    const { get } = fakeYouTube(videos, ["hit", "normal"], { A: { subscribers: 5000 }, B: {} });
    const result = await searchYouTubeOutliers(get, { query: "  sleep   science ", now: NOW });
    expect(result.outliers.map((video) => video.id)).toEqual(["hit"]);
    const hit = result.outliers[0]!;
    // Median of A's other uploads: 10,000 and 10,500 around the middle → 10,250.
    expect(hit.channelMedianViews).toBe(10_250);
    expect(hit.outlierScore).toBe(11.7);
    expect(hit.channelSample).toBe(6);
    expect(hit.subscribers).toBe(5000);
    expect(hit.url).toBe("https://www.youtube.com/watch?v=hit");
    expect(hit.durationSec).toBe(480);
    expect(result.checked).toBe(2);
    expect(result.channelsMeasured).toBe(2);
    expect(result.channelsSkipped).toBe(0);
  });

  it("sends a clean query and the date window", async () => {
    const { get, calls } = fakeYouTube([], [], {});
    await searchYouTubeOutliers(get, { query: "  sleep   science ", publishedWithinDays: 30, regionCode: "us", language: "en", now: NOW });
    const search = calls.find((call) => call.resource === "search")!;
    expect(search.params.q).toBe("sleep science");
    expect(search.params.order).toBe("viewCount");
    expect(search.params.publishedAfter).toBe(daysAgo(30));
    expect(search.params.regionCode).toBe("US");
    expect(search.params.relevanceLanguage).toBe("en");
    expect(search.params.videoDuration).toBeUndefined();
  });

  it("ignores bad region and language codes instead of sending them", async () => {
    const { get, calls } = fakeYouTube([], [], {});
    await searchYouTubeOutliers(get, { query: "x", regionCode: "USA&x=1", language: "english please", now: NOW });
    const search = calls.find((call) => call.resource === "search")!;
    expect(search.params.regionCode).toBeUndefined();
    expect(search.params.relevanceLanguage).toBeUndefined();
  });

  it("refuses an empty query", async () => {
    const { get } = fakeYouTube([], [], {});
    await expect(searchYouTubeOutliers(get, { query: "   " })).rejects.toThrow(/query/);
  });

  it("skips channels without enough comparable uploads, hidden counts and brand-new uploads", async () => {
    const videos = [
      { id: "hit", channelId: "A", views: 900_000, ageDays: 5 },
      // Only four uploads old enough to count (two are under 3 days old, one hides its views).
      ...channelHistory("A", [1000, 1200, 900, 1100]),
      { id: "A-new1", channelId: "A", views: 10, ageDays: 1 },
      { id: "A-new2", channelId: "A", views: 20, ageDays: 2 },
      { id: "A-hidden", channelId: "A", ageDays: 60 },
      { id: "secret", channelId: "C", ageDays: 10 },
    ];
    const { get } = fakeYouTube(videos, ["hit", "secret"], { A: {} });
    const result = await searchYouTubeOutliers(get, { query: "x", now: NOW });
    expect(result.outliers).toEqual([]);
    // "secret" hides its view count, so it isn't checked at all.
    expect(result.checked).toBe(1);
    expect(result.channelsMeasured).toBe(0);
    expect(result.channelsSkipped).toBe(1);
  });

  it("keeps only Shorts-length videos when asked, and only longer ones for long", async () => {
    const videos = [
      { id: "short", channelId: "A", views: 100_000, ageDays: 20, duration: "PT2M30S" },
      { id: "long", channelId: "A", views: 100_000, ageDays: 21, duration: "PT25M" },
      ...channelHistory("A", [1000, 1000, 1000, 1000, 1000]),
    ];
    const shorts = fakeYouTube(videos, ["short", "long"], { A: {} });
    const shortResult = await searchYouTubeOutliers(shorts.get, { query: "x", length: "short", now: NOW });
    expect(shortResult.outliers.map((video) => video.id)).toEqual(["short"]);
    expect(shorts.calls.find((call) => call.resource === "search")!.params.videoDuration).toBe("short");

    const longs = fakeYouTube(videos, ["short", "long"], { A: {} });
    const longResult = await searchYouTubeOutliers(longs.get, { query: "x", length: "long", now: NOW });
    expect(longResult.outliers.map((video) => video.id)).toEqual(["long"]);
    expect(longs.calls.find((call) => call.resource === "search")!.params.videoDuration).toBeUndefined();
  });

  it("reports hidden subscriber counts as unknown and respects minScore", async () => {
    const videos = [{ id: "v", channelId: "A", views: 2500, ageDays: 20 }, ...channelHistory("A", [1000, 1000, 1000, 1000, 1000])];
    const { get } = fakeYouTube(videos, ["v"], { A: { hidden: true } });
    expect((await searchYouTubeOutliers(get, { query: "x", now: NOW })).outliers).toEqual([]);
    const loose = await searchYouTubeOutliers(get, { query: "x", minScore: 2, now: NOW });
    expect(loose.outliers[0]?.outlierScore).toBe(2.5);
    expect(loose.outliers[0]?.subscribers).toBeNull();
  });

  it("asks for each video's details once, in batches of 50", async () => {
    const history = channelHistory(
      "A",
      Array.from({ length: 30 }, () => 1000),
    );
    const found = Array.from({ length: 50 }, (_, index) => ({ id: `f${index}`, channelId: "A", views: 5000 + index, ageDays: 400 }));
    const { get, calls } = fakeYouTube([...found, ...history], found.map((video) => video.id), { A: {} });
    const result = await searchYouTubeOutliers(get, { query: "x", maxResults: 50, now: NOW });
    expect(result.outliers).toHaveLength(50);
    const videoCalls = calls.filter((call) => call.resource === "videos");
    expect(videoCalls.every((call) => call.params.id!.split(",").length <= 50)).toBe(true);
    expect(calls.filter((call) => call.resource === "playlistItems")).toHaveLength(1);
  });
});
