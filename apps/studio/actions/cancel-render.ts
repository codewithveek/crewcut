import { defineAction } from "@agent-native/core/action";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { readAutopilot, updateAutopilot, withDecision } from "../server/lib/autopilot.js";
import { UserError } from "../server/lib/errors.js";
import { cancelRender } from "../server/lib/render-runner.js";
import { loadVideo } from "../server/lib/store.js";

export default defineAction({
  description: "Stop an export that is waiting or in progress. The video itself doesn't change; it can be exported again at any time.",
  schema: z.object({ videoId: z.string(), renderId: z.string() }),
  run: async ({ videoId, renderId }, ctx) => {
    const video = await loadVideo(videoId, ctx, "editor");
    const db = getDb();
    const R = schema.renderJobs;
    const [render] = await db.select({ id: R.id, status: R.status }).from(R).where(and(eq(R.id, renderId), eq(R.videoId, videoId))).limit(1);
    if (!render) throw new UserError("That export doesn't exist.", 404);
    if (render.status !== "queued" && render.status !== "running") return { renderId, cancelled: false, status: render.status };
    // Marked first, so the worker's own exit can't write "failed" over it; then the worker is stopped.
    const updated = await db
      .update(R)
      .set({ status: "cancelled", stage: "cancelled", error: null, updatedAt: new Date().toISOString() })
      .where(and(eq(R.id, renderId), inArray(R.status, ["queued", "running"])))
      .returning({ id: R.id });
    cancelRender(renderId);
    // An autopilot run that was waiting on this export stops for the person instead of waiting for ever.
    const autopilot = readAutopilot(video.row);
    if (autopilot.on && autopilot.status === "exporting" && autopilot.renderId === renderId) {
      await updateAutopilot(videoId, (state) => withDecision({ ...state, status: "needs_you", reason: "The export was stopped. Export the video again from the editor when you're ready." }, "publish", "The export was stopped."));
    }
    return { renderId, cancelled: updated.length > 0, status: "cancelled" };
  },
});
