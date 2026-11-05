import { type Composition, clipEndMs, formatTimecode } from "@crewcut/composition";
import type { RetentionPoint } from "@crewcut/contracts";

export interface RetentionDrop {
  /** 0..1 through the video. */
  startAt: number;
  endAt: number;
  startMs: number;
  endMs: number;
  fromRatio: number;
  toRatio: number;
  /** Share of the viewers present at the start who left during the drop. */
  relativeLoss: number;
}

/**
 * Finds steep declines: consecutive falling points whose combined loss is
 * well above the curve's typical slope. Gentle decay is normal and ignored.
 */
export function findRetentionDrops(
  retention: readonly RetentionPoint[],
  durationMs: number,
  options: { minRelativeLoss?: number; maxDrops?: number } = {},
): RetentionDrop[] {
  const points = [...retention].sort((a, b) => a.at - b.at);
  if (points.length < 3) return [];
  const minLoss = options.minRelativeLoss ?? 0.12;
  const first = points[0];
  const last = points[points.length - 1];
  const typicalSlope = first && last && last.at > first.at ? (first.ratio - last.ratio) / (last.at - first.at) : 0;
  const drops: RetentionDrop[] = [];
  let index = 0;
  while (index < points.length - 1) {
    const start = points[index];
    const next = points[index + 1];
    if (!start || !next) break;
    const slope = (start.ratio - next.ratio) / Math.max(1e-6, next.at - start.at);
    if (slope <= typicalSlope * 1.8 || next.ratio >= start.ratio) {
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < points.length - 1) {
      const a = points[end];
      const b = points[end + 1];
      if (!a || !b) break;
      const nextSlope = (a.ratio - b.ratio) / Math.max(1e-6, b.at - a.at);
      if (nextSlope <= typicalSlope * 1.8) break;
      end += 1;
    }
    const endPoint = points[end] as RetentionPoint;
    const relativeLoss = (start.ratio - endPoint.ratio) / Math.max(1e-6, start.ratio);
    if (relativeLoss >= minLoss) {
      drops.push({
        startAt: start.at,
        endAt: endPoint.at,
        startMs: Math.round(start.at * durationMs),
        endMs: Math.round(endPoint.at * durationMs),
        fromRatio: start.ratio,
        toRatio: endPoint.ratio,
        relativeLoss: Math.round(relativeLoss * 1000) / 1000,
      });
    }
    index = end;
  }
  return drops.sort((a, b) => b.relativeLoss - a.relativeLoss).slice(0, options.maxDrops ?? 3);
}

export function ratioAt(retention: readonly RetentionPoint[], at: number): number {
  const points = [...retention].sort((a, b) => a.at - b.at);
  const right = points.findIndex((point) => point.at >= at);
  if (right <= 0) return points[0]?.ratio ?? 1;
  const a = points[right - 1] as RetentionPoint;
  const b = points[right] as RetentionPoint;
  const t = (at - a.at) / Math.max(1e-6, b.at - a.at);
  return a.ratio + (b.ratio - a.ratio) * t;
}

export interface TimelineMoment {
  atMs: number;
  timecode: string;
  clipId?: string;
  clipName?: string;
  recipe?: string;
  lineId?: string;
  lineText?: string;
  visibleLayerTypes: string[];
}

/** What was on screen and being said at `atMs` — so an insight links to the frame. */
export function momentAt(composition: Composition, atMs: number): TimelineMoment {
  const moment: TimelineMoment = { atMs, timecode: formatTimecode(atMs, { fps: composition.fps }).slice(3, 8), visibleLayerTypes: [] };
  for (const track of composition.tracks) {
    for (const clip of track.clips) {
      if (atMs < clip.startMs || atMs >= clipEndMs(clip)) continue;
      if (track.kind === "visual" && !moment.clipId) {
        moment.clipId = clip.id;
        if ("name" in clip && clip.name) moment.clipName = clip.name;
        if ("recipe" in clip && clip.recipe) moment.recipe = clip.recipe;
        if ("layers" in clip) {
          moment.visibleLayerTypes = [...new Set(clip.layers.filter((layer) => !layer.hidden).map((layer) => layer.type))];
        }
      }
      if (track.kind === "audio" && track.role === "voice" && "lineId" in clip && clip.lineId) {
        moment.lineId = clip.lineId;
        if (clip.text) moment.lineText = clip.text;
      }
    }
  }
  if (!moment.lineId) {
    // In a pause between lines: use the nearest line within 1.5 s.
    let nearest: { lineId: string; text?: string; distance: number } | null = null;
    for (const track of composition.tracks) {
      if (track.kind !== "audio" || track.role !== "voice") continue;
      for (const clip of track.clips) {
        if (!clip.lineId) continue;
        const distance = atMs < clip.startMs ? clip.startMs - atMs : Math.max(0, atMs - clipEndMs(clip));
        if (distance <= 1500 && (!nearest || distance < nearest.distance)) {
          nearest = { lineId: clip.lineId, distance, ...(clip.text ? { text: clip.text } : {}) };
        }
      }
    }
    if (nearest) {
      moment.lineId = nearest.lineId;
      if (nearest.text) moment.lineText = nearest.text;
    }
  }
  return moment;
}

/** Human description of what was on screen: "the code card", "the big number". */
export function describeMoment(moment: TimelineMoment): string {
  const recipeNames: Record<string, string> = {
    code: "the code card",
    "big-number": "the big number",
    cards: "the feature cards",
    flow: "the step diagram",
    list: "the list",
    quote: "the quote",
    chart: "the chart",
    image: "the image",
    end: "the end card",
    title: "the title card",
    headline: "the headline",
  };
  if (moment.recipe && recipeNames[moment.recipe]) return recipeNames[moment.recipe] as string;
  if (moment.visibleLayerTypes.includes("code")) return "the code card";
  if (moment.visibleLayerTypes.includes("chart")) return "the chart";
  return moment.clipName ? `"${moment.clipName}"` : "this scene";
}
