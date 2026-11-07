import { defineAction } from "@agent-native/core/action";
import { checkVariety, styleFingerprint } from "@crewcut/composition";
import { z } from "zod";

import { getProject, latestComposition, loadVideo, recentFingerprints } from "../server/lib/store.js";
import { UserError } from "../server/lib/errors.js";

export default defineAction({
  description:
    "Variety guard: compare this video's style fingerprint (palette, type, layout, motion, transitions, pacing) with the workspace's last 10 videos. Flags it when too close, unless the person asked for consistency.",
  schema: z.object({ videoId: z.string() }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ videoId }, ctx) => {
    const video = await loadVideo(videoId, ctx);
    const current = await latestComposition(videoId);
    if (!current) throw new UserError("Create the draft video first.");
    const [recent, project] = await Promise.all([recentFingerprints(video.row.projectId, videoId), getProject(video.row.projectId)]);
    const fingerprint = styleFingerprint(current.composition);
    const report = checkVariety(fingerprint, recent, { threshold: project?.varietyThreshold ?? 0.72, consistencyRequested: video.row.consistencyRequested });
    return { fingerprint, ...report };
  },
});
