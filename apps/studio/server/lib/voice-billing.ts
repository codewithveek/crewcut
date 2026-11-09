/**
 * AI voice-overs on Crewcut's own ElevenLabs account: the key, and what a
 * character costs us. People who add their own ElevenLabs key use theirs and
 * pay no credits.
 *
 * - CREWCUT_VOICE_ELEVENLABS_KEY: the key for voice-overs (falls back to
 *   ELEVENLABS_API_KEY, the key the template music uses). CREWCUT_VOICE=off
 *   stops Crewcut voicing videos on its own key.
 * - CREWCUT_VOICE_USD_PER_1K_CHARS: our cost per 1,000 characters. Default
 *   0.10 (ElevenLabs API list price for Multilingual v2). On a subscription
 *   plan, set it to plan price ÷ included characters × 1,000.
 */

type Env = Record<string, string | undefined>;
const clean = (value: string | undefined) => value?.replace(/\r/g, "").trim() || undefined;

export function voiceOperatorKey(env: Env = process.env): string | undefined {
  if (clean(env.CREWCUT_VOICE)?.toLowerCase() === "off") return undefined;
  return clean(env.CREWCUT_VOICE_ELEVENLABS_KEY) ?? clean(env.ELEVENLABS_API_KEY);
}

export function voiceCostMicros(characters: number, env: Env = process.env): number {
  const perThousand = Number(clean(env.CREWCUT_VOICE_USD_PER_1K_CHARS) ?? "0.10");
  const rate = Number.isFinite(perThousand) && perThousand >= 0 ? perThousand : 0.1;
  // dollars per 1,000 characters × characters ÷ 1,000 × 1,000,000 micro-dollars
  return Math.round(characters * rate * 1000);
}
