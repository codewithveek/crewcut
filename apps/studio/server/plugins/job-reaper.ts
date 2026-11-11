import { failStaleRenders, pruneOldRenders } from "../lib/render-runner.js";
import { notifyNewPrivacyRequests } from "../lib/privacy-requests.js";
import { failStaleUploads } from "../lib/youtube.js";

/**
 * Closes exports and uploads that lost the process doing them.
 *
 * Both run inside this server (an export as a child process, an upload as a
 * background task), so a restart, a deploy or the container going to sleep
 * ends them without anyone writing "failed". Their rows would then say
 * "exporting" or "uploading" for ever: the editor would keep showing a
 * progress bar, the post couldn't be published again and autopilot would wait
 * on an export that will never arrive. This checks shortly after the server
 * starts and every couple of minutes after that.
 */
const STARTUP_DELAY_MS = 20_000;
const INTERVAL_MS = 2 * 60 * 1000;

/** Old exports are cleared out every this many checks (about every half hour). */
const PRUNE_EVERY = 15;

let started = false;
let sweeps = 0;

async function sweep(): Promise<void> {
  try {
    const renders = await failStaleRenders();
    const uploads = await failStaleUploads();
    if (renders || uploads) console.info(`[job-reaper] closed ${renders} interrupted export(s) and ${uploads} interrupted upload(s).`);
    if (sweeps % PRUNE_EVERY === 0) {
      const pruned = await pruneOldRenders();
      if (pruned) console.info(`[job-reaper] removed ${pruned} old export(s).`);
      // People's data requests (copy, deletion): the operator hears about each one once.
      await notifyNewPrivacyRequests().catch((error: unknown) => console.warn("[job-reaper] could not check data requests:", error instanceof Error ? error.message : error));
    }
    sweeps += 1;
  } catch (error) {
    // The database may not be ready yet (first boot runs migrations); the next run tries again.
    console.warn("[job-reaper] check failed, will retry:", error instanceof Error ? error.message : error);
  }
}

export default function jobReaperPlugin(): void {
  if (started || process.env.CREWCUT_JOB_REAPER === "off") return;
  started = true;
  setTimeout(() => {
    void sweep();
    setInterval(() => void sweep(), INTERVAL_MS).unref?.();
  }, STARTUP_DELAY_MS).unref?.();
}
