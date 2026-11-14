import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";

import { BodyTooLargeError, readBodyCapped, readTextCapped } from "./http.js";
import { sniffMedia } from "./sniff.js";

/**
 * Media from a web address ("add this here"). A direct link to an image,
 * video or audio file is downloaded; a web page is read for the pictures and
 * video files on it, so the person (or the crew) picks one. Video platforms
 * aren't downloaded from at all: their terms forbid it.
 *
 * Every fetch goes through the framework's SSRF guard (public addresses only,
 * checked again on each redirect) and stops at a size limit.
 */

export const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_CANDIDATES = 40;
const USER_AGENT = "Crewcut media import (+https://getcrewcut.app)";

/** Sites whose videos may only be watched there (their terms forbid downloading), and their names. */
const PLATFORMS: Record<string, string> = {
  "youtube.com": "YouTube",
  "youtu.be": "YouTube",
  "youtube-nocookie.com": "YouTube",
  "tiktok.com": "TikTok",
  "instagram.com": "Instagram",
  "facebook.com": "Facebook",
  "fb.watch": "Facebook",
  "twitter.com": "X",
  "x.com": "X",
  "vimeo.com": "Vimeo",
  "twitch.tv": "Twitch",
  "dailymotion.com": "Dailymotion",
  "snapchat.com": "Snapchat",
  "threads.net": "Threads",
  "kick.com": "Kick",
  "rumble.com": "Rumble",
};

export class LinkImportError extends Error {
  override readonly name = "LinkImportError";
}

export function platformName(url: URL): string | null {
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const match = Object.keys(PLATFORMS).find((platform) => host === platform || host.endsWith(`.${platform}`));
  return match ? PLATFORMS[match]! : null;
}

/** A web address people may import from: http(s), no credentials in it. */
export function parseImportUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new LinkImportError("That isn't a web address. Paste a link that starts with https://.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new LinkImportError("Only web links (https://…) can be imported.");
  if (url.username || url.password) throw new LinkImportError("Links with a user name or password in them can't be imported.");
  url.hash = "";
  return url;
}

export type CandidateKind = "image" | "video" | "audio";

export interface PageCandidate {
  url: string;
  kind: CandidateKind;
  alt: string;
  width: number | null;
  height: number | null;
  /** Where on the page it was found: the page's share image, an <img>, a <video>, or a link. */
  from: "share" | "img" | "video" | "audio" | "link";
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i;
const VIDEO_EXT = /\.(mp4|m4v|webm|mov)$/i;
const AUDIO_EXT = /\.(mp3|m4a|wav|ogg|oga|opus)$/i;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(value: string): string {
  return value.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const code = /^#x/i.test(entity) ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function attributes(source: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const match of source.matchAll(/([^\s=/"'<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
    const name = match[1]!.toLowerCase();
    if (!(name in found)) found[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "").trim();
  }
  return found;
}

function dimension(value: string | undefined): number | null {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The widest entry of a srcset ("a.jpg 480w, b.jpg 1080w" → b.jpg). */
function largestFromSrcset(srcset: string): string | null {
  let best: { url: string; size: number } | null = null;
  for (const part of srcset.split(/,\s+/)) {
    const [url, descriptor = "1x"] = part.trim().split(/\s+/);
    if (!url) continue;
    const size = Number.parseFloat(descriptor) * (descriptor.endsWith("w") ? 1 : 1000);
    if (!best || (Number.isFinite(size) && size > best.size)) best = { url, size: Number.isFinite(size) ? size : 0 };
  }
  return best?.url ?? null;
}

function kindOf(url: URL, declared?: string): CandidateKind | null {
  const type = (declared ?? "").toLowerCase();
  if (type.startsWith("image/")) return type === "image/svg+xml" ? null : "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (IMAGE_EXT.test(url.pathname)) return "image";
  if (VIDEO_EXT.test(url.pathname)) return "video";
  if (AUDIO_EXT.test(url.pathname)) return "audio";
  return null;
}

/**
 * The pictures and media files a page shows, best first: its share image,
 * then images, videos and audio in page order, then links to media files.
 * Icons, tracking pixels, SVGs and inline data are left out.
 */
export function pageMediaCandidates(html: string, pageUrl: string): { title: string; candidates: PageCandidate[] } {
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, " ");
  let base: URL;
  try {
    base = new URL(pageUrl);
    const href = /<base\b([^>]*)>/i.exec(cleaned)?.[1];
    const baseHref = href ? attributes(href).href : undefined;
    if (baseHref) base = new URL(baseHref, base);
  } catch {
    return { title, candidates: [] };
  }
  const seen = new Set<string>();
  const share: PageCandidate[] = [];
  const inline: PageCandidate[] = [];
  const linked: PageCandidate[] = [];
  const add = (list: PageCandidate[], raw: string | null | undefined, from: PageCandidate["from"], extra: { alt?: string; width?: number | null; height?: number | null; type?: string; kind?: CandidateKind } = {}) => {
    if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) return;
    let url: URL;
    try {
      url = new URL(raw, base);
    } catch {
      return;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return;
    url.hash = "";
    const kind = extra.kind ?? kindOf(url, extra.type);
    if (!kind) return;
    // Icons and tracking pixels.
    if ((extra.width !== null && extra.width !== undefined && extra.width < 48) || (extra.height !== null && extra.height !== undefined && extra.height < 48)) return;
    if (/\.svg$/i.test(url.pathname) || /\b(favicon|apple-touch-icon|sprite|spacer|pixel)\b/i.test(url.pathname)) return;
    const key = url.toString();
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ url: key, kind, alt: (extra.alt ?? "").replace(/\s+/g, " ").trim().slice(0, 160), width: extra.width ?? null, height: extra.height ?? null, from });
  };

  for (const match of cleaned.matchAll(/<(meta|img|video|audio|source|a)\b([^>]*)>/gi)) {
    const tag = match[1]!.toLowerCase();
    const attrs = attributes(match[2] ?? "");
    if (tag === "meta") {
      const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
      if (/^(og:image(:url|:secure_url)?|twitter:image(:src)?)$/.test(key)) add(share, attrs.content, "share", { kind: "image" });
      // og:video is often a player page; only direct files count.
      if (/^og:video(:url|:secure_url)?$/.test(key) && attrs.content && VIDEO_EXT.test(attrs.content.split("?")[0] ?? "")) add(share, attrs.content, "share", { kind: "video" });
    } else if (tag === "img") {
      const src = attrs.srcset ? largestFromSrcset(attrs.srcset) : null;
      add(inline, attrs.src || attrs["data-src"] || src || (attrs["data-srcset"] ? largestFromSrcset(attrs["data-srcset"]) : null), "img", {
        alt: attrs.alt ?? attrs.title ?? "",
        width: dimension(attrs.width),
        height: dimension(attrs.height),
        kind: "image",
      });
    } else if (tag === "video") {
      add(inline, attrs.src, "video", { kind: "video", alt: attrs.title ?? "" });
      if (attrs.poster) add(inline, attrs.poster, "img", { kind: "image", alt: attrs.title ?? "" });
    } else if (tag === "audio") {
      add(inline, attrs.src, "audio", { kind: "audio", alt: attrs.title ?? "" });
    } else if (tag === "source") {
      // <source> inside <picture> carries srcset; inside <video>/<audio>, src + type.
      if (attrs.srcset) add(inline, largestFromSrcset(attrs.srcset), "img", { type: attrs.type ?? "image/" });
      else add(inline, attrs.src, attrs.type?.startsWith("audio/") ? "audio" : "video", { ...(attrs.type ? { type: attrs.type } : {}) });
    } else if (tag === "a" && attrs.href) {
      add(linked, attrs.href, "link", { alt: attrs.title ?? "" });
    }
  }
  return { title, candidates: [...share, ...inline, ...linked].slice(0, MAX_CANDIDATES) };
}

export type FetchedLink =
  | { kind: "page"; url: string; title: string; candidates: PageCandidate[] }
  | { kind: "media"; url: string; bytes: Uint8Array; type: NonNullable<ReturnType<typeof sniffMedia>> };

function describeFetchError(error: unknown, host: string): LinkImportError {
  const reason = error instanceof Error ? error.message : String(error);
  if (reason.startsWith("SSRF blocked")) return new LinkImportError("That address isn't on the public web, so nothing can be imported from it.");
  return new LinkImportError(`Couldn't reach ${host}${/timeout|aborted/i.test(reason) ? " (it took too long to answer)" : ""}. Check the link and try again.`);
}

function refusePlatform(url: URL): void {
  const platform = platformName(url);
  if (platform) {
    throw new LinkImportError(`Crewcut doesn't download from ${platform}: its terms only allow watching there. Upload a file you made or have the rights to instead.`);
  }
}

/** Fetches a link: a media file's bytes, or the media a web page shows. */
export async function fetchLink(raw: string, options: { pagesAllowed?: boolean } = {}): Promise<FetchedLink> {
  const url = parseImportUrl(raw);
  refusePlatform(url);
  let response: Response;
  try {
    response = await ssrfSafeFetch(url.toString(), {
      headers: { "user-agent": USER_AGENT, accept: "image/*,video/*,audio/*,text/html;q=0.8,*/*;q=0.5" },
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    throw describeFetchError(error, url.hostname);
  }
  // The address it ended up at, after redirects (a short link may lead to a video platform).
  let finalUrl = url;
  try {
    if (response.url) finalUrl = new URL(response.url);
  } catch {
    // Keep the requested address.
  }
  try {
    refusePlatform(finalUrl);
  } catch (error) {
    await response.body?.cancel().catch(() => undefined);
    throw error;
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new LinkImportError(
      response.status === 401 || response.status === 403 ? `${finalUrl.hostname} doesn't allow downloading that (HTTP ${response.status}).` : `${finalUrl.hostname} answered with an error (HTTP ${response.status}).`,
    );
  }
  const type = (response.headers.get("content-type") ?? "").toLowerCase();
  if (type.includes("text/html") || type.includes("application/xhtml")) {
    if (options.pagesAllowed === false) {
      await response.body?.cancel().catch(() => undefined);
      throw new LinkImportError("That link is a web page, not a picture, video or sound file.");
    }
    const html = await readTextCapped(response, MAX_PAGE_BYTES);
    const page = pageMediaCandidates(html, finalUrl.toString());
    return { kind: "page", url: finalUrl.toString(), title: page.title, candidates: page.candidates.filter((candidate) => !platformName(new URL(candidate.url))) };
  }
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_MEDIA_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new LinkImportError(`That file is larger than ${MAX_MEDIA_BYTES / 1024 / 1024} MB.`);
  }
  let bytes: Uint8Array;
  try {
    bytes = await readBodyCapped(response, MAX_MEDIA_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLargeError) throw new LinkImportError(`That file is larger than ${MAX_MEDIA_BYTES / 1024 / 1024} MB.`);
    throw describeFetchError(error, finalUrl.hostname);
  }
  if (bytes.byteLength === 0) throw new LinkImportError("That link has nothing in it.");
  const sniffed = sniffMedia(bytes);
  if (!sniffed) {
    if (type.includes("svg")) throw new LinkImportError("SVG pictures can't be used yet. Use a PNG, JPEG, GIF or WebP.");
    throw new LinkImportError("That link isn't a picture, video or sound Crewcut can use (PNG, JPEG, GIF, WebP, MP4, WebM, MP3, M4A, WAV or OGG).");
  }
  return { kind: "media", url: finalUrl.toString(), bytes, type: sniffed };
}

/** A label for media from a link: what the caller gave, the file's name, or the site. */
export function labelFor(url: string, given?: string): string {
  if (given?.trim()) return given.trim().slice(0, 120);
  try {
    const parsed = new URL(url);
    const last = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() ?? "")
      .replace(/\.[a-z0-9]{2,5}$/i, "")
      .replace(/[-_]+/g, " ")
      .trim();
    return (last && last.length >= 3 && !/^[\da-f]{16,}$/i.test(last) ? last : `From ${parsed.hostname}`).slice(0, 120);
  } catch {
    return "From a link";
  }
}
