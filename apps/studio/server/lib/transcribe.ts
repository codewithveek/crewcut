import { readFile } from "node:fs/promises";

import { resolveCredential } from "@agent-native/core/credentials";
import { type WordTiming, wordsFromScribe } from "@crewcut/voice";
import { eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { recordAiUsage } from "./ai/usage.js";
import { localCopy } from "./blob-store.js";
import { workspaceOf } from "./catalog.js";
import { assertCredits } from "./credits.js";
import { UserError } from "./errors.js";
import { toJson } from "./json.js";
import { mediaDurationMs } from "./media-duration.js";
import { sniffMedia } from "./sniff.js";
import { voiceOperatorKey } from "./voice-billing.js";

/**
 * Speech-to-text for captions (ElevenLabs Scribe). The person's own
 * ElevenLabs key costs no credits; otherwise Crewcut's key is used and the
 * video owner's workspace pays. A file is transcribed once: the words are
 * kept per stored file and reused in any video.
 *
 * - CREWCUT_STT_MODEL: Scribe model id (default scribe_v2).
 * - CREWCUT_STT_USD_PER_HOUR: our cost per hour of audio (default 0.22, the
 *   ElevenLabs API list price for Scribe v2).
 */

const ENDPOINT = "https://api.elevenlabs.io/v1/speech-to-text";
const TIMEOUT_MS = 10 * 60 * 1000;
const clean = (value: string | undefined) => value?.replace(/\r/g, "").trim() || undefined;

export function sttModel(env: Record<string, string | undefined> = process.env): string {
  return clean(env.CREWCUT_STT_MODEL) ?? "scribe_v2";
}

export function sttCostMicros(durationMs: number, env: Record<string, string | undefined> = process.env): number {
  const perHour = Number(clean(env.CREWCUT_STT_USD_PER_HOUR) ?? "0.22");
  const rate = Number.isFinite(perHour) && perHour >= 0 ? perHour : 0.22;
  // dollars per hour × hours × 1,000,000 micro-dollars
  return Math.round((Math.max(0, durationMs) / 3_600_000) * rate * 1_000_000);
}

export interface TranscriptAsset {
  id: string;
  fileName: string;
  mime: string;
  durationMs: number | null;
}

export interface Transcript {
  words: WordTiming[];
  language: string | null;
  durationMs: number;
  /** True when it came from an earlier transcription (nothing charged). */
  cached: boolean;
}

/** Transcriptions running now, by file: two requests for the same file share one (and one charge). */
const running = new Map<string, Promise<Transcript>>();

async function savedTranscript(fileName: string): Promise<Transcript | null> {
  const [row] = await getDb().select().from(schema.transcripts).where(eq(schema.transcripts.fileName, fileName)).limit(1);
  if (!row) return null;
  let words: WordTiming[] = [];
  try {
    const parsed = JSON.parse(row.words) as unknown;
    if (Array.isArray(parsed)) words = parsed.filter((word): word is WordTiming => Boolean(word) && typeof (word as WordTiming).text === "string" && Number.isFinite((word as WordTiming).startMs) && Number.isFinite((word as WordTiming).endMs));
  } catch {
    return null;
  }
  return { words, language: row.language, durationMs: row.durationMs, cached: true };
}

async function callScribe(apiKey: string, bytes: Uint8Array, mime: string, fileName: string, language?: string): Promise<unknown> {
  const form = new FormData();
  form.append("model_id", sttModel());
  form.append("file", new Blob([bytes as BlobPart], { type: mime }), fileName);
  form.append("timestamps_granularity", "word");
  form.append("tag_audio_events", "false");
  form.append("diarize", "false");
  if (language) form.append("language_code", language);
  let response: Response;
  try {
    response = await fetch(ENDPOINT, { method: "POST", headers: { "xi-api-key": apiKey }, body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new UserError(/timeout|aborted/i.test(reason) ? "Transcribing took too long. Try a shorter clip." : "The speech-to-text service didn't answer. Try again in a minute.");
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    console.error(`[captions] ElevenLabs speech-to-text ${response.status}: ${detail}`);
    if (response.status === 401) throw new UserError("ElevenLabs refused the key. Check the ElevenLabs key under Connect.");
    if (response.status === 429) throw new UserError("ElevenLabs is busy (rate limit). Try again in a minute.");
    if (response.status === 402 || /quota|credits/i.test(detail)) throw new UserError("The ElevenLabs account has no transcription quota left.");
    throw new UserError(`Speech-to-text failed (ElevenLabs ${response.status}). Try again, or caption it by hand.`);
  }
  return response.json();
}

/**
 * The words spoken in an asset's file, in the file's own time. Throws
 * UserError when no speech-to-text is available or the service fails.
 */
export async function transcribeAsset(
  asset: TranscriptAsset,
  who: { userEmail: string; orgId: string | null; owner: { email: string; orgId: string | null } },
  options: { videoId?: string; language?: string } = {},
): Promise<Transcript> {
  const saved = await savedTranscript(asset.fileName);
  if (saved) return saved;
  const inFlight = running.get(asset.fileName);
  if (inFlight) return { ...(await inFlight), cached: true };

  const job = (async (): Promise<Transcript> => {
    const ownKey = await resolveCredential("ELEVENLABS_API_KEY", { userEmail: who.userEmail, ...(who.orgId ? { orgId: who.orgId } : {}) });
    const crewcutKey = ownKey ? undefined : voiceOperatorKey();
    const apiKey = ownKey ?? crewcutKey;
    if (!apiKey) throw new UserError("Captions from speech need ElevenLabs. Add your ElevenLabs key under Connect.");
    if (crewcutKey) await assertCredits(workspaceOf(who.owner), "captions from speech");

    const bytes = new Uint8Array(await readFile(await localCopy("assets", asset.fileName)));
    const type = sniffMedia(bytes);
    if (!type || type.kind === "image") throw new UserError("That file has no sound to transcribe.");
    const started = Date.now();
    let body: unknown;
    try {
      body = await callScribe(apiKey, bytes, asset.mime || type.mime, asset.fileName, options.language);
    } catch (error) {
      await recordAiUsage({
        ownerEmail: who.owner.email,
        orgId: who.owner.orgId,
        source: crewcutKey ? "managed" : "byok",
        kind: "transcription",
        provider: "elevenlabs",
        model: sttModel(),
        costMicros: 0,
        ...(options.videoId ? { videoId: options.videoId } : {}),
        stage: "captions",
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    const { words, language } = wordsFromScribe(body);
    const durationMs = asset.durationMs ?? mediaDurationMs(bytes, type.ext) ?? words[words.length - 1]?.endMs ?? 0;
    await recordAiUsage({
      ownerEmail: who.owner.email,
      orgId: who.owner.orgId,
      source: crewcutKey ? "managed" : "byok",
      kind: "transcription",
      provider: "elevenlabs",
      model: sttModel(),
      units: Math.round(durationMs / 1000),
      costMicros: sttCostMicros(durationMs),
      ...(options.videoId ? { videoId: options.videoId } : {}),
      stage: "captions",
      durationMs: Date.now() - started,
    });
    await getDb()
      .insert(schema.transcripts)
      .values({ fileName: asset.fileName, assetId: asset.id, provider: "elevenlabs", model: sttModel(), language, words: toJson(words), durationMs, ownerEmail: who.owner.email, orgId: who.owner.orgId })
      .onConflictDoNothing();
    return { words, language, durationMs, cached: false };
  })().finally(() => running.delete(asset.fileName));
  running.set(asset.fileName, job);
  return job;
}
