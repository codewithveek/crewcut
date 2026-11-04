/**
 * Trend helpers for the trend agent. Only official APIs and pages the user
 * can open are used; this module scores what those return.
 */
export interface CandidateVideo {
  id: string;
  title: string;
  channelId: string;
  views: number;
  publishedAt: string;
  url?: string;
}

export interface OutlierVideo extends CandidateVideo {
  channelMedianViews: number;
  /** views ÷ channel median: 3× and up is an outlier. */
  outlierScore: number;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** Videos that beat their own channel's median by `minScore`×. */
export function findOutliers(
  videos: readonly CandidateVideo[],
  channelHistory: ReadonlyMap<string, readonly number[]>,
  minScore = 3,
): OutlierVideo[] {
  return videos
    .map((video) => {
      const channelMedianViews = median(channelHistory.get(video.channelId) ?? []);
      return { ...video, channelMedianViews, outlierScore: channelMedianViews > 0 ? Math.round((video.views / channelMedianViews) * 10) / 10 : 0 };
    })
    .filter((video) => video.outlierScore >= minScore)
    .sort((a, b) => b.outlierScore - a.outlierScore);
}

/** Search-interest change between two periods, as a percentage. */
export function interestChange(previous: number, current: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}
