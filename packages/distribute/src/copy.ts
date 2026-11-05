import { PLATFORM_SPECS, type Platform, type PublishCopy } from "@crewcut/contracts";

/** Per-platform copy limits (vid-skills `copy.ts`). */
export interface AdaptedCopy {
  title: string;
  text: string;
  tags: string[];
}

const cleanTag = (tag: string) => tag.replace(/^#/, "").replace(/[^\p{L}\p{N}_]/gu, "");

export function truncateWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function fit(parts: string[], max: number): string {
  let out = "";
  for (const part of parts.filter(Boolean)) {
    const next = out ? `${out}\n\n${part}` : part;
    if (next.length > max) break;
    out = next;
  }
  return out;
}

export function adaptCopy(platform: Platform, copy: PublishCopy): AdaptedCopy {
  const spec = PLATFORM_SPECS[platform];
  const tags = [...copy.hashtags, ...copy.keywords].map(cleanTag).filter(Boolean);
  const sources = copy.sources.length
    ? `Sources:\n${copy.sources
        .slice(0, 5)
        .map((source) => `• ${source.title}: ${source.url}`)
        .join("\n")}`
    : "";
  if (platform === "youtube" || platform === "youtube_shorts") {
    const title = truncateWords(copy.title.replace(/[<>]/g, ""), spec.titleMax ?? 100);
    const tagList: string[] = [];
    let length = 0;
    for (const tag of tags) {
      if (length + tag.length + 1 > 480) break;
      tagList.push(tag);
      length += tag.length + 1;
    }
    const hashtags = copy.hashtags.slice(0, 3).map((tag) => `#${cleanTag(tag)}`).join(" ");
    return { title, text: fit([copy.description.replace(/[<>]/g, ""), sources, hashtags], spec.captionMax), tags: tagList };
  }
  const hashtags = copy.hashtags.slice(0, platform === "x" ? 2 : 6).map((tag) => `#${cleanTag(tag)}`).join(" ");
  const firstLine = copy.description.split("\n")[0] ?? "";
  return { title: truncateWords(copy.title, spec.titleMax ?? 100), text: truncateWords([firstLine, hashtags].filter(Boolean).join("\n\n"), spec.captionMax), tags };
}
