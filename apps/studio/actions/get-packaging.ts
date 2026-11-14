import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { fileUrl } from "../server/lib/blob-store.js";
import { packagingHistory, readPackaging, scorePackaging } from "../server/lib/packaging.js";
import { loadVideo } from "../server/lib/store.js";

export default defineAction({
  description:
    "Thumbnail & title lab: a video's title and thumbnail options, each scored against the channel's own click-through history (predictedCtr, vsTypical, confidence, reasons) plus plain checks, and which ones are chosen for publishing. Scores need 5+ published videos with YouTube click-through data; before that predictedCtr is null and only the checks apply, so say so instead of ranking by guesswork.",
  schema: z.object({ videoId: z.string() }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ videoId }, ctx) => {
    const video = await loadVideo(videoId, ctx, "viewer");
    // Scores come from the owner's YouTube analytics, which only the owner sees.
    const owner = video.who.email === video.row.ownerEmail;
    const [packaging, history] = await Promise.all([readPackaging(videoId), owner ? packagingHistory(video.row.ownerEmail, videoId) : Promise.resolve([])]);
    const scored = scorePackaging(packaging, history);
    const renderedUrl = packaging.rendered ? await fileUrl("renders", packaging.rendered.fileName).catch(() => null) : null;
    return {
      ...scored,
      ...(owner ? {} : { note: "Scores come from the video owner's YouTube results, so only they see them. The checks still apply." }),
      rendered: packaging.rendered && renderedUrl ? { key: packaging.rendered.key, url: renderedUrl } : null,
    };
  },
});
