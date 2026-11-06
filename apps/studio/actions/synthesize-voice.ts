import { defineAction } from "@agent-native/core/action";
import { resolveCredential } from "@agent-native/core/credentials";
import { scriptLines } from "@crewcut/contracts";
import { type LineAudio, applyNarration } from "@crewcut/pipeline";
import { ElevenLabsVoiceProvider } from "@crewcut/voice";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { accessContext } from "../server/lib/identity.js";
import { toJson } from "../server/lib/json.js";
import { beginStage, finishStage } from "../server/lib/pipeline-ops.js";
import { latestComposition, latestScript, loadVideo, saveComposition } from "../server/lib/store.js";
import { putFile } from "../server/lib/blob-store.js";
import { newId } from "../server/lib/storage.js";
import { lineAudioFor } from "../server/lib/voice-ops.js";

export default defineAction({
  description:
    "Voice & sound agent: synthesize narration for every script line (ElevenLabs when its key is connected; otherwise keeps estimated timing), then re-time narration-locked clips, rebuild the voice and caption tracks, and duck the music. Paid voices count against the budget.",
  schema: z.object({ videoId: z.string(), voiceId: z.string().optional(), speed: z.number().min(0.7).max(1.2).default(1) }),
  run: async ({ videoId, voiceId, speed }, ctx) => {
    const video = await loadVideo(videoId, ctx, "editor");
    const [scriptEntry, compositionEntry] = await Promise.all([latestScript(videoId), latestComposition(videoId)]);
    if (!scriptEntry || !compositionEntry) throw new Error("Write the script and create the draft video first.");
    await beginStage(video, "voice");
    const credentialCtx = accessContext(video.who);
    const apiKey = await resolveCredential("ELEVENLABS_API_KEY", credentialCtx);
    const defaultVoice = voiceId ?? (await resolveCredential("ELEVENLABS_VOICE_ID", credentialCtx)) ?? "JBFqnCBsd6RMkjVDRZzb";
    const lineAudio = lineAudioFor(scriptEntry.script, compositionEntry.composition);
    let synthesized = 0;

    if (apiKey) {
      const provider = new ElevenLabsVoiceProvider({ apiKey, defaultVoiceId: defaultVoice });
      const lines = scriptLines(scriptEntry.script);
      for (const [index, line] of lines.entries()) {
        const result = await provider.synthesize({
          text: line.say ?? line.text,
          speed,
          ...(lines[index - 1] ? { previousText: lines[index - 1]?.text } : {}),
          ...(lines[index + 1] ? { nextText: lines[index + 1]?.text } : {}),
        });
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
    }

    const emphasis = new Map(scriptEntry.script.beats.flatMap((beat) => beat.lines.map((line) => [line.id, line.emphasis] as const)));
    const composition = applyNarration(compositionEntry.composition, lineAudio, { emphasis });
    const version = await saveComposition(video, composition, apiKey ? `Voice: ${synthesized} lines (ElevenLabs)` : "Re-time narration (estimated voice)");
    const status = await finishStage(video, "voice", {
      note: apiKey ? `${synthesized} lines voiced with ElevenLabs` : "No voice connected yet, so timing is estimated. Connect ElevenLabs in Settings to record the voice-over.",
    });
    return { version, synthesized, provider: apiKey ? "elevenlabs" : "estimated", durationMs: composition.durationMs, status };
  },
});
