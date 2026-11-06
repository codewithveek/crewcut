/**
 * Generated music and sound effects (ElevenLabs Eleven Music and Sound
 * Effects). Paid plans may use generated songs commercially; film, TV and
 * large-studio game use needs an Enterprise plan. Both return MP3 bytes.
 */

export class SoundGenerationError extends Error {
  override readonly name = "SoundGenerationError";
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

interface ElevenOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
}

async function post(options: ElevenOptions, path: string, body: unknown): Promise<Uint8Array> {
  const send = () =>
    (options.fetchImpl ?? fetch)(`https://api.elevenlabs.io${path}`, {
      method: "POST",
      headers: { "xi-api-key": options.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify(body),
    });
  let response = await send();
  // "system_busy" 429s are ElevenLabs-side load, not our quota: back off and retry twice.
  for (const waitMs of [4000, 10_000]) {
    if (response.status !== 429) break;
    const detail = await response.clone().text().catch(() => "");
    if (!/system_busy|heavy traffic/i.test(detail)) break;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    response = await send();
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 401) throw new SoundGenerationError("The ElevenLabs API key was refused. Check ELEVENLABS_API_KEY.", 401);
    if (response.status === 402 || /quota|credits|subscription/i.test(detail)) throw new SoundGenerationError("ElevenLabs says the plan's music or credit allowance is used up.", response.status);
    throw new SoundGenerationError(`ElevenLabs request failed (${response.status}): ${detail.slice(0, 200)}`, response.status);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** An instrumental track of an exact length (3 s – 10 min). */
export async function composeMusic(options: ElevenOptions & { prompt: string; durationMs: number }): Promise<Uint8Array> {
  const length = Math.round(Math.min(Math.max(options.durationMs, 3000), 600_000));
  return post(options, "/v1/music?output_format=mp3_44100_128", { prompt: options.prompt, music_length_ms: length, force_instrumental: true });
}

/** A one-shot sound effect (whoosh, riser, impact…), 0.5–30 s. */
export async function generateSoundEffect(options: ElevenOptions & { prompt: string; durationSeconds?: number; loop?: boolean }): Promise<Uint8Array> {
  return post(options, "/v1/sound-generation?output_format=mp3_44100_128", {
    text: options.prompt,
    ...(options.durationSeconds ? { duration_seconds: Math.min(Math.max(options.durationSeconds, 0.5), 30) } : {}),
    ...(options.loop ? { loop: true } : {}),
    prompt_influence: 0.5,
  });
}
