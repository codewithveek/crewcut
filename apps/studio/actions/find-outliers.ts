import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { UserError } from "../server/lib/errors.js";
import { identity } from "../server/lib/identity.js";
import { OutlierSearchError, findYouTubeOutliers, outlierSearchEnabled, outlierSearchesLeft } from "../server/lib/youtube-search.js";

export default defineAction({
  description:
    "Trend agent: search public YouTube (official API) for outlier videos in a niche — videos that got far more views than their own channel usually gets (views ÷ the median of the channel's last ~30 uploads older than 3 days). Returns each outlier with its link, views, the channel's usual views, the score (e.g. 6.2 = 6.2× usual) and length. Use the numbers as-is in find-trends evidence (kind \"outlier\", metric like \"6.2× channel median\", url = the video link). Searches are limited per person per day, so make each query count: a few plain words for the niche, not the whole brief. If it returns enabled: false or an error, fall back to web search.",
  schema: z.object({
    query: z.string().trim().min(2).max(100).describe("The niche in a few plain words, e.g. \"sleep science\""),
    publishedWithinDays: z.coerce.number().int().min(1).max(365).optional().describe("Only videos from this many days back (default 90)"),
    length: z.enum(["short", "long", "any"]).optional().describe("short = Shorts-length (3 min or less), long = longer videos; default any"),
    minScore: z.coerce.number().min(1.5).max(50).optional().describe("Minimum views ÷ channel usual (default 3)"),
    maxResults: z.coerce.number().int().min(5).max(50).optional().describe("Search results to check (default 25)"),
    regionCode: z.string().regex(/^[A-Za-z]{2}$/).optional().describe("Two-letter country, e.g. US"),
    language: z.string().regex(/^[A-Za-z]{2,3}$/).optional().describe("Two-letter language, e.g. en"),
  }),
  readOnly: true,
  run: async (args, ctx) => {
    const who = identity(ctx);
    if (!outlierSearchEnabled()) {
      return { enabled: false as const, outliers: [], note: "YouTube search isn't set up on this server. Use web search for outlier evidence." };
    }
    try {
      const result = await findYouTubeOutliers(who.email, args);
      return {
        enabled: true as const,
        query: args.query,
        outliers: result.outliers.map((video) => ({
          title: video.title,
          url: video.url,
          channel: video.channelTitle,
          views: video.views,
          channelUsualViews: video.channelMedianViews,
          comparedWith: `${video.channelSample} of the channel's recent uploads`,
          score: video.outlierScore,
          metric: `${video.outlierScore}× channel median`,
          subscribers: video.subscribers,
          lengthSec: video.durationSec,
          publishedAt: video.publishedAt,
        })),
        checked: result.checked,
        channelsMeasured: result.channelsMeasured,
        channelsSkipped: result.channelsSkipped,
        searchesLeftToday: outlierSearchesLeft(who.email),
        ...(result.outliers.length === 0
          ? { note: "No outliers at this score. Try a broader query, a longer window, or a lower minScore (not below 2)." }
          : {}),
      };
    } catch (error) {
      if (error instanceof OutlierSearchError) throw new UserError(error.message);
      throw error;
    }
  },
});
