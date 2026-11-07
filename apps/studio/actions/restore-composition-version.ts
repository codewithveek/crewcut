import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { compositionAt, listCompositionVersions, loadVideo, saveComposition } from "../server/lib/store.js";
import { UserError } from "../server/lib/errors.js";

export default defineAction({
  description:
    "Undo/redo through history: restore an earlier composition version as a new version (history is never rewritten, so agent and human steps stay labelled).",
  schema: z.object({ videoId: z.string(), version: z.number().int().positive(), returnFull: z.boolean().default(false) }),
  run: async ({ videoId, version, returnFull }, ctx) => {
    const video = await loadVideo(videoId, ctx, "editor");
    const composition = await compositionAt(videoId, version);
    if (!composition) throw new UserError(`No version ${version}`);
    const versions = await listCompositionVersions(videoId, 200);
    const label = versions.find((entry) => entry.version === version)?.label ?? `v${version}`;
    const saved = await saveComposition(video, composition, `Restore v${version} (${label.replace(/^Agent: /, "")})`);
    return { version: saved, restoredFrom: version, ...(returnFull ? { composition } : {}) };
  },
});
