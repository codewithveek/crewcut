import { defineAction } from "@agent-native/core/action";
import { resolveCredential } from "@agent-native/core/credentials";
import { scriptLines } from "@crewcut/contracts";
import { type LineAudio, applyNarration } from "@crewcut/pipeline";
import { ElevenLabsVoiceProvider } from "@crewcut/voice";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { accessContext } from "../server/lib/identity.js";
import { toJson } from "../server/lib/json.js";
import { beginStage, finishStage } from "../server/lib/pipeline-ops.js";
import { latestComposition, latestScript, loadVideo, saveComposition } from "../server/lib/store.js";
import { deleteAssetFile } from "../server/lib/assets.js";
import { putFile } from "../server/lib/blob-store.js";
import { newId } from "../server/lib/storage.js";
import { lineAudioFor } from "../server/lib/voice-ops.js";
import { UserError } from "../server/lib/errors.js";
import { recordAiUsage } from "../server/lib/ai/usage.js";
import { workspaceOf } from "../server/lib/catalog.js";
import { assertCredits } from "../server/lib/credits.js";
import { voiceCostMicros, voiceOperatorKey } from "../server/lib/voice-billing.js";

/** Versions back that keep their voice files, so undo and "restore version" still have audio. */
const KEEP_VOICE_FOR_VERSIONS = 20;

/**
 * Every re-voice made a new file per line and left the earlier ones in
 * storage for good. This removes the takes that none of the video's latest
 * versions use any more; anything a recent version still plays is kept.
 */
async function removeOldVoiceTakes(videoId: string): Promise<number> {
  const db = getDb();
  const [takes, versions] = await Promise.all([
    db.select().from(schema.assets).where(and(eq(schema.assets.videoId, videoId), eq(schema.assets.kind, "voice"))),
    db.select({ body: schema.compositions.body }).from(schema.compositions).where(eq(schema.compositions.videoId, videoId)).orderBy(desc(schema.compositions.version)).limit(KEEP_VOICE_FOR_VERSIONS),
  ]);
  const inUse = versions.map((entry) => entry.body).join("\n");
  // Only takes this action made (they carry the script line they voice); recordings people made themselves stay.
  const stale = takes.filter((take) => take.provenance.includes('"lineId"') && !inUse.includes(`asset:${take.id}`));
  for (const take of stale) {
    await db.delete(schema.assets).where(eq(schema.assets.id, take.id));
    await deleteAssetFile(take);
  }
  return stale.length;
}

export default defineAction({
  description:
    "Voice & sound agent: synthesize narration for every script line (ElevenLabs when its key is connected; otherwise keeps estimated timing), then re-time narration-locked clips, rebuild the voice and caption tracks, and duck the music. Paid voices count against the budget.",
  schema: z.object({ videoId: z.string(), voiceId: z.string().optional(), speed: z.number().min(0.7).max(1.2).default(1) }),
  run: async ({ videoId, voiceId, speed }, ctx) => {
    const video = await loadVideo(videoId, ctx, "editor");
    const [scriptEntry, compositionEntry] = await Promise.all([latestScript(videoId), latestComposition(videoId)]);
    if (!scriptEntry || !compositionEntry) throw new UserError("Write the script and create the draft video first.");
    const credentialCtx = accessContext(video.who);
    // The person's own ElevenLabs key costs no credits; otherwise Crewcut's
    // key voices it and the video owner's workspace pays in credits.
    const ownKey = await resolveCredential("ELEVENLABS_API_KEY", credentialCtx);
    const crewcutKey = ownKey ? undefined : voiceOperatorKey();
    const owner = { email: video.row.ownerEmail, orgId: video.row.orgId };
    if (crewcutKey) await assertCredits(workspaceOf(owner), "a voice-over");
    const apiKey = ownKey ?? crewcutKey;
    await beginStage(video, "voice");
    const defaultVoice = voiceId ?? (await resolveCredential("ELEVENLABS_VOICE_ID", credentialCtx)) ?? "JBFqnCBsd6RMkjVDRZzb";
    const lineAudio = lineAudioFor(scriptEntry.script, compositionEntry.composition);
    let synthesized = 0;
    let characters = 0;
    const recordVoiceUsage = async () => {
      if (!apiKey || characters === 0) return;
      await recordAiUsage({
        ownerEmail: owner.email,
        orgId: owner.orgId,
        source: crewcutKey ? "managed" : "byok",
        kind: "voice",
        provider: "elevenlabs",
        model: "eleven_multilingual_v2",
        units: characters,
        costMicros: voiceCostMicros(characters),
        videoId,
        stage: "voice",
      });
    };

    if (apiKey) {
      const provider = new ElevenLabsVoiceProvider({ apiKey, defaultVoiceId: defaultVoice });
      const lines = scriptLines(scriptEntry.script);
      try {
      for (const [index, line] of lines.entries()) {
        const result = await provider.synthesize({
          text: line.say ?? line.text,
          speed,
          ...(lines[index - 1] ? { previousText: lines[index - 1]?.text } : {}),
          ...(lines[index + 1] ? { nextText: lines[index + 1]?.text } : {}),
        });
        characters += (line.say ?? line.text).length;
        const assetId = newId("ast");
        const fileName = `${assetId}.wav`;
        await putFile("assets", fileName, result.bytes, "audio/wav", { keepLocal: true });
        await getDb().insert(schema.assets).values({
          id: assetId,
          videoId,
          kind: "voice",
          label: `Voice ${line.id}`,
          fileName,
          mime: result.mime,
          bytes: result.bytes.byteLength,
          durationMs: result.durationMs,
          licence: toJson(result.licence),
          provenance: toJson({ provider: result.provider, voiceId: defaultVoice, lineId: line.id }),
          ownerEmail: video.row.ownerEmail,
          orgId: video.row.orgId,
        });
        const audio: LineAudio = {
          lineId: line.id,
          text: line.text,
          durationMs: result.durationMs,
          src: `asset:${assetId}`,
          assetId,
          words: result.words,
          peaks: result.peaks,
          estimated: result.alignment === "estimated",
        };
        lineAudio.set(line.id, audio);
        synthesized += 1;
      }
      } catch (error) {
        // The lines voiced so far were paid for: record them before giving up.
        await recordVoiceUsage().catch(() => undefined);
        console.error(`[voice] ${videoId}: stopped after ${synthesized} of ${lines.length} lines:`, error);
        throw new UserError(`The voice-over stopped after ${synthesized} of ${lines.length} lines: the voice service didn't answer. Try again in a minute.`);
      }
    }

    await recordVoiceUsage();

    const emphasis = new Map(scriptEntry.script.beats.flatMap((beat) => beat.lines.map((line) => [line.id, line.emphasis] as const)));
    const composition = applyNarration(compositionEntry.composition, lineAudio, { emphasis });
    const version = await saveComposition(video, composition, apiKey ? `Voice: ${synthesized} lines (ElevenLabs)` : "Re-time narration (estimated voice)");
    if (synthesized > 0) await removeOldVoiceTakes(videoId).catch((error: unknown) => console.warn(`[voice] ${videoId}: could not clear earlier takes:`, error));
    const status = await finishStage(video, "voice", {
      note: apiKey ? `${synthesized} lines voiced with ElevenLabs` : "No voice connected yet, so timing is estimated. Connect ElevenLabs in Settings to record the voice-over.",
    });
    return { version, synthesized, provider: apiKey ? "elevenlabs" : "estimated", durationMs: composition.durationMs, status };
  },
});
