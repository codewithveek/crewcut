import { defineAction } from "@agent-native/core/action";
import { approveStage, currentStage } from "@crewcut/pipeline";
import { z } from "zod";

import { AUTOPILOT_MAX_AUTO_RESUMES, autopilotView, readAutopilot, saveAutopilot, startAutopilot, timestampMs, withDecision } from "../server/lib/autopilot.js";
import { UserError } from "../server/lib/errors.js";
import { requireHuman } from "../server/lib/identity.js";
import { nowIso } from "../server/lib/json.js";
import { loadVideo, recordApproval, saveStages, updateVideo } from "../server/lib/store.js";

/**
 * People-only: autopilot stands in for the person's sign-offs, so only the
 * person switches it on, resumes it or stops it. `auto` is the app resuming a
 * stalled run on its own: it only goes ahead when the run really is stalled,
 * a limited number of times, and never twice at once (other open tabs see the fresh resume).
 */
export default defineAction({
  description: "Start, resume, stop or hold autopilot for a video (people only). hold: the crew couldn't start (reason says why); it waits for the person.",
  schema: z.object({
    videoId: z.string(),
    action: z.enum(["start", "resume", "stop", "hold"]),
    auto: z.boolean().default(false).describe("The app resuming a stalled run by itself"),
    reason: z.string().trim().max(400).optional(),
  }),
  uiOnly: true,
  agentTool: false,
  toolCallable: false,
  run: async ({ videoId, action, auto, reason }, ctx) => {
    const who = requireHuman(ctx, "Changing autopilot");
    const video = await loadVideo(videoId, ctx, "editor");
    const state = readAutopilot(video.row);
    const stage = currentStage(video.stages);

    if (action === "stop") {
      if (!state.on) return { changed: false, stage };
      await saveAutopilot(videoId, withDecision({ ...state, on: false, status: "stopped" }, stage, "Autopilot stopped by the person: the remaining steps wait for them again."));
      return { changed: true, stage };
    }

    if (action === "hold") {
      if (!state.on) return { changed: false, stage };
      await saveAutopilot(videoId, withDecision({ ...state, status: "needs_you", reason: reason ?? "The crew couldn't start working." }, stage, "Autopilot couldn't start the crew."));
      return { changed: true, stage };
    }

    if (action === "start") {
      if (stage === "publish" || stage === "analytics") throw new UserError("This video is already made. Export or publish it from the editor.");
      let next = { ...startAutopilot(who.email), decisions: state.decisions };
      // The person's switch is their sign-off: a step already waiting for it is approved now
      // (at the ideas step, the strongest idea is picked). A blocked fact-check stays for the crew to fix.
      const waiting = video.stages[stage].status === "awaiting_approval" ? stage : null;
      if (waiting) {
        if (waiting === "trend") {
          const top = [...video.ideas].sort((a, b) => b.score - a.score)[0];
          if (!top) throw new UserError("There are no ideas to pick from yet.");
          await updateVideo(videoId, { pickedIdeaId: top.id, title: top.title });
          next = withDecision(next, "trend", `Picked “${top.title}” (score ${top.score}) out of ${video.ideas.length} ideas.`);
        }
        video.stages = approveStage(video.stages, waiting, { now: nowIso(), actor: { kind: "human", id: who.email }, note: "Approved by switching on autopilot" });
        await saveStages(videoId, video.stages);
      }
      await saveAutopilot(videoId, next);
      await recordApproval(video, { stage, decision: "approved", reason: "Switched on autopilot: the crew finishes the video without stopping at each step (publishing still waits for the person).", actor: who });
      return { changed: true, stage: currentStage(video.stages) };
    }

    // resume
    if (!state.on) throw new UserError("Autopilot is off for this video. Switch it on to let the crew finish it.");
    if (auto) {
      const view = await autopilotView(video.row);
      const recentlyResumed = state.lastResumeAt ? Date.now() - timestampMs(state.lastResumeAt) < 2 * 60 * 1000 : false;
      if (!view?.canAutoResume || recentlyResumed || state.resumes >= AUTOPILOT_MAX_AUTO_RESUMES) return { changed: false, stage };
    }
    const fromNeedsYou = state.status === "needs_you";
    await saveAutopilot(
      videoId,
      withDecision(
        { ...state, status: "running", reason: undefined, resumes: state.resumes + (auto ? 1 : 0), lastResumeAt: nowIso(), ...(fromNeedsYou ? { qaRounds: 0 } : {}) },
        stage,
        auto ? "Autopilot had stopped working; it picked up again where it left off." : "Resumed by the person.",
      ),
    );
    return { changed: true, stage };
  },
});
