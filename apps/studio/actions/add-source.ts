import { defineAction } from "@agent-native/core/action";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { asUntrustedData, htmlToText, redactSecrets } from "../server/lib/content-safety.js";
import { readTextCapped } from "../server/lib/http.js";
import { loadVideo } from "../server/lib/store.js";
import { newId, sha256 } from "../server/lib/storage.js";
import { UserError } from "../server/lib/errors.js";

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
      if (!/^https?:\/\//i.test(args.url)) throw new UserError("Sources need a web address that starts with https:// or http://.");
      let response: Response;
      try {
        response = await ssrfSafeFetch(args.url, { headers: { "user-agent": "Crewcut research (+https://github.com/codewithveek)", accept: "text/html,text/plain,application/json" }, signal: AbortSignal.timeout(15_000) });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (reason.startsWith("SSRF blocked")) throw new UserError("That address isn't on the public web, so it can't be used as a source.");
        throw new UserError(`Couldn't reach ${new URL(args.url).hostname}${/timeout|aborted/i.test(reason) ? " (it took too long to answer)" : ""}. Check the address, or paste the text instead.`);
      }
      if (!response.ok) throw new UserError(`Couldn't fetch ${args.url}: HTTP ${response.status}`);
      const length = Number(response.headers.get("content-length") ?? 0);
      if (length > MAX_BYTES) throw new UserError("That page is too large to use as a source (2 MB limit).");
      // Reads at most the limit: a page without Content-Length can't fill memory.
      const raw = await readTextCapped(response, MAX_BYTES);
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
    if (content.trim().length < 20) throw new UserError("The source has no readable text.");
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
