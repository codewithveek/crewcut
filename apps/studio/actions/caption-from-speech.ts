import { defineAction } from "@agent-native/core/action";
import { applyCompositionOps } from "@crewcut/composition";
import { placeWords } from "@crewcut/voice";
import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { UserError } from "../server/lib/errors.js";
import { accessContext } from "../server/lib/identity.js";
import { editComposition } from "../server/lib/pipeline-ops.js";
import { speechCaptionOps, speechSources } from "../server/lib/speech-captions.js";
import { latestComposition, loadVideo } from "../server/lib/store.js";
import { type Transcript, transcribeAsset } from "../server/lib/transcribe.js";

export default defineAction({
  description:
    "Captions from speech: transcribe what is said in the video's own media (uploaded videos with sound, recorded voice clips) with ElevenLabs speech-to-text and write it to the caption track, word-timed, replacing the captions where those clips play. Pass clipId (and layerId for one video layer) to caption one clip, even a muted one; leave it out for every clip people can hear (music, sound effects and AI narration are skipped: narration already has its words). Each file is transcribed once, then reused for free. Uses the person's ElevenLabs key if connected, otherwise AI credits (about 1 credit per 4 minutes of audio).",
  schema: z.object({
    videoId: z.string(),
    clipId: z.string().optional(),
    layerId: z.string().optional(),
    language: z
      .string()
      .regex(/^[A-Za-z]{2,3}$/)
      .optional()
      .describe("Spoken language code (en, es, fr…); detected when left out"),
  }),
  run: async ({ videoId, clipId, layerId, language }, ctx) => {
    const video = await loadVideo(videoId, ctx, "editor");
    const current = await latestComposition(videoId);
    if (!current) throw new UserError("This video has nothing to caption yet.");
    const sources = speechSources(current.composition, { ...(clipId ? { clipId } : {}), ...(layerId ? { layerId } : {}) });
    if (sources.length === 0) {
      throw new UserError(
        clipId
          ? "That clip has no uploaded video or recording to transcribe."
          : "Nothing to caption: there are no uploaded videos with sound or recorded voice clips. (Narration from the script gets its captions from Captions → From narration.)",
      );
    }

    // Only this video's files and its owner's library, as for exports.
    const A = schema.assets;
    const ids = [...new Set(sources.map((source) => source.assetId))];
    const assets = await getDb()
      .select()
      .from(A)
      .where(and(inArray(A.id, ids), or(eq(A.videoId, video.row.id), eq(A.ownerEmail, video.row.ownerEmail))));
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    const usable = sources.filter((source) => byId.get(source.assetId)?.mime.match(/^(audio|video)\//));
    if (usable.length === 0) throw new UserError("The media in those clips isn't available to transcribe.");

    const who = { ...accessContext(video.who), orgId: video.who.orgId, owner: { email: video.row.ownerEmail, orgId: video.row.orgId } };
    const transcripts = new Map<string, Transcript>();
    // One file at a time: a failure stops before more is spent.
    for (const assetId of new Set(usable.map((source) => source.assetId))) {
      const asset = byId.get(assetId)!;
      transcripts.set(assetId, await transcribeAsset(asset, who, { videoId, ...(language ? { language } : {}) }));
    }

    const placed = usable.map((source) => {
      const transcript = transcripts.get(source.assetId)!;
      const asset = byId.get(source.assetId)!;
      const loopSourceMs = source.loop ? (asset.durationMs ?? transcript.durationMs ?? null) : null;
      return {
        windowStartMs: source.placement.windowStartMs,
        windowEndMs: source.placement.windowEndMs,
        words: placeWords(transcript.words, { ...source.placement, loopSourceMs }),
      };
    });
    const spoken = placed.reduce((sum, entry) => sum + entry.words.length, 0);
    if (spoken === 0) {
      return {
        captioned: false as const,
        clips: usable.length,
        message: "No speech was found in the part of the media the video plays, so the captions were left as they were.",
        cached: [...transcripts.values()].every((transcript) => transcript.cached),
      };
    }

    let summary = { cues: 0, words: 0 };
    const label = usable.length === 1 ? `Captions from speech: ${usable[0]!.label}`.slice(0, 80) : `Captions from speech (${usable.length} clips)`;
    const { version } = await editComposition(video, label, (composition) => {
      // Re-run on the latest version: if clips moved since, use where they are now.
      const now = speechSources(composition, { ...(clipId ? { clipId } : {}), ...(layerId ? { layerId } : {}) }).filter((source) => transcripts.has(source.assetId));
      const windows = now.map((source) => {
        const transcript = transcripts.get(source.assetId)!;
        const asset = byId.get(source.assetId);
        const loopSourceMs = source.loop ? (asset?.durationMs ?? transcript.durationMs ?? null) : null;
        return { windowStartMs: source.placement.windowStartMs, windowEndMs: source.placement.windowEndMs, words: placeWords(transcript.words, { ...source.placement, loopSourceMs }) };
      });
      const { ops, cues, words } = speechCaptionOps(composition, windows);
      summary = { cues, words };
      return applyCompositionOps(composition, ops);
    });
    const languages = [...new Set([...transcripts.values()].map((transcript) => transcript.language).filter(Boolean))];
    return {
      captioned: true as const,
      version,
      clips: usable.length,
      cues: summary.cues,
      words: summary.words,
      ...(languages.length ? { language: languages.join(", ") } : {}),
      cached: [...transcripts.values()].every((transcript) => transcript.cached),
    };
  },
});
