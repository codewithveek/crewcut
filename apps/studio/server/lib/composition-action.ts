import type { ActionRunContext } from "@agent-native/core/action";
import { type Composition, lintMotion } from "@crewcut/composition";

import { editComposition, summarizeComposition } from "./pipeline-ops.js";
import { loadVideo } from "./store.js";

/**
 * Shared body of every composition-editing action: load with editor access,
 * apply one pure edit from @crewcut/composition, save it as the next
 * version (one undoable step), and report back compactly.
 */
export async function runCompositionEdit(
  ctx: ActionRunContext | undefined,
  videoId: string,
  label: string,
  edit: (composition: Composition) => Composition,
  options: { returnFull?: boolean } = {},
) {
  const video = await loadVideo(videoId, ctx, "editor");
  const { version, composition } = await editComposition(video, label, edit);
  const findings = lintMotion(composition).filter((finding) => finding.severity !== "minor");
  return {
    version,
    label,
    durationMs: composition.durationMs,
    ...(options.returnFull ? { composition } : { summary: summarizeComposition(composition) }),
    ...(findings.length > 0 ? { motionWarnings: findings.slice(0, 5) } : {}),
  };
}
