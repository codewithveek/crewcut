import { defineAction } from "@agent-native/core/action";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { asUntrustedData, htmlToText, redactSecrets } from "../server/lib/content-safety.js";
import { loadVideo } from "../server/lib/store.js";
import { newId, sha256 } from "../server/lib/storage.js";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CHARS = 120_000;

export default defineAction({
  description:
    "Research agent: add a source to the video — fetch a public URL (SSRF-safe, size-capped) or store pasted text (notes, a transcript, a doc). The stored text is redacted of secrets; facts in the dossier must quote it verbatim. Returns an excerpt wrapped as untrusted data.",
  schema: z
    .object({
      videoId: z.string(),
      url: z.string().url().optional(),
      text: z.string().min(20).max(MAX_CHARS).optional(),
      title: z.string().max(300).optional(),
      publisher: z.string().max(120).optional(),
    })
    .refine((value) => Boolean(value.url) !== Boolean(value.text), "Pass either url or text"),
  run: async (args, ctx) => {
    const video = await loadVideo(args.videoId, ctx, "editor");
    let title = args.title ?? "";
    let content = args.text ?? "";
    let kind: "url" | "document" = "document";
    if (args.url) {
      kind = "url";
      const response = await ssrfSafeFetch(args.url, { headers: { "user-agent": "Proofcut research (+https://github.com/codewithveek)", accept: "text/html,text/plain,application/json" }, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`Couldn't fetch ${args.url}: HTTP ${response.status}`);
      const length = Number(response.headers.get("content-length") ?? 0);
      if (length > MAX_BYTES) throw new Error("That page is too large to use as a source (2 MB limit).");
      const raw = (await response.text()).slice(0, MAX_BYTES);
      const type = response.headers.get("content-type") ?? "";
      if (type.includes("html")) {
        const parsed = htmlToText(raw);
        content = parsed.text;
        title ||= parsed.title;
      } else {
        content = raw;
      }
      title ||= new URL(args.url).hostname;
    }
    content = content.slice(0, MAX_CHARS);
    if (content.trim().length < 20) throw new Error("The source has no readable text.");
    const redacted = redactSecrets(content);
    const id = newId("src");
    await getDb().insert(schema.sources).values({
      id,
      videoId: video.row.id,
      kind,
      title: title || "Untitled source",
      url: args.url ?? null,
      publisher: args.publisher ?? (args.url ? new URL(args.url).hostname : null),
      content: redacted.content,
      contentHash: sha256(redacted.content),
      redactions: redacted.redactions,
      ownerEmail: video.row.ownerEmail,
      orgId: video.row.orgId,
    });
    return {
      sourceId: id,
      title,
      length: redacted.content.length,
      redactions: redacted.redactions,
      excerpt: asUntrustedData(`id="${id}"`, redacted.content.slice(0, 6000)),
      next: "Read more with read-source if needed, then call build-dossier with facts that quote this text verbatim.",
    };
  },
});
