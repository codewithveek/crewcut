import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { promoteToRemote } from "./blob-store.js";
import { storagePath, WORKSPACE_ROOT, writeStorageFile } from "./storage.js";

/**
 * Crewcut's built-in audio library: music beds and sound effects made with
 * ElevenLabs (Eleven Music and Sound Effects, paid plan, commercial use) and
 * shipped with the app in library/music/ and library/sfx/. Each file is put
 * into storage/assets once as lib-<id>.mp3 and shared by every asset row that
 * references it. The prompts are kept so an item can be regenerated the same
 * way (see library/README.md).
 *
 * Before 2026-11-09 these were synthesised on the server as lib-<id>.wav;
 * projects that used them keep those files.
 */

export interface LibraryItem {
  id: string;
  label: string;
  kind: "music" | "sfx";
  mood: string;
  /** Measured from the file (beat sync relies on it), not the prompt's tempo. */
  bpm?: number;
  durationMs: number;
  /** The ElevenLabs prompt the recording was made from. */
  prompt: string;
}

/**
 * 60 s instrumental beds, trimmed and loudness-normalised to -16 LUFS
 * (-1.5 dBTP) with a 1.5 s fade out.
 */
const MUSIC: Array<Omit<LibraryItem, "kind">> = [
  { id: "music-calm-pads", label: "Calm pads", mood: "ambient · reflective", durationMs: 57_443, prompt: "Calm ambient background music for video narration: warm soft synth pads and gentle felt piano, slow evolving chords, reflective and peaceful, no drums, steady and unobtrusive, 70 BPM, instrumental" },
  { id: "music-upbeat-pulse", label: "Upbeat pulse", mood: "energetic · tech", bpm: 114.75, durationMs: 58_018, prompt: "Upbeat energetic modern tech background music: punchy four-on-the-floor kick, crisp claps, bright plucked synth arpeggios and a driving bass, optimistic product launch vibe, steady tempo throughout, 112 BPM, instrumental" },
  { id: "music-lofi-keys", label: "Lo-fi keys", mood: "chill · warm", bpm: 83.8, durationMs: 59_402, prompt: "Chill lo-fi hip hop beat: warm Rhodes electric piano chords, dusty swung boom-bap drums, soft vinyl crackle, mellow round bass, relaxed and cozy, steady tempo throughout, 84 BPM, instrumental" },
];

/**
 * One-shots: trimmed, cut to one hit and levelled to about -15 dB RMS with
 * peaks at -1 dBFS.
 */
const SFX: Array<Omit<LibraryItem, "kind">> = [
  { id: "sfx-whoosh", label: "Whoosh", mood: "transition", durationMs: 1045, prompt: "Clean cinematic air whoosh passing fast from left to right, smooth airy swoosh, video edit transition, high quality studio recording, no music" },
  { id: "sfx-swish", label: "Quick swish", mood: "transition", durationMs: 261, prompt: "Very short quick swish, a fast flick of air like a cane swung once, crisp and tight, video transition, no music" },
  { id: "sfx-swoosh-in", label: "Swoosh in", mood: "transition", durationMs: 1228, prompt: "Whoosh building in towards the listener that lands on a soft punchy hit, title reveal transition, cinematic and clean" },
  { id: "sfx-glitch", label: "Glitch", mood: "transition", durationMs: 1045, prompt: "Short digital glitch transition, electronic stutter, data corruption bleeps and crackle, modern video edit glitch effect" },
  { id: "sfx-pop", label: "Pop", mood: "ui", durationMs: 496, prompt: "Single clean bubbly pop, satisfying mouth pop for a text or sticker appearing on screen, bright and short, UI sound" },
  { id: "sfx-click", label: "Click", mood: "ui", durationMs: 131, prompt: "Single crisp clean mouse click, one short tactile button click, close mic, UI sound, nothing else" },
  { id: "sfx-typing", label: "Keyboard typing", mood: "ui", durationMs: 2456, prompt: "Fast typing on a laptop keyboard, steady natural keystrokes, close and clean, quiet room, no voices" },
  { id: "sfx-shutter", label: "Camera shutter", mood: "ui", durationMs: 235, prompt: "Single camera shutter click, crisp DSLR shutter snap, one photo taken, clean" },
  { id: "sfx-error", label: "Error buzz", mood: "ui", durationMs: 836, prompt: "Short negative error buzz, low dull double buzzer for a wrong answer or failed action, app UI sound" },
  { id: "sfx-ding", label: "Ding", mood: "notification", durationMs: 1515, prompt: "Single bright clear bell ding, pleasant notification ding with a soft natural ring out, high quality" },
  { id: "sfx-notification", label: "Notification", mood: "notification", durationMs: 1045, prompt: "Modern smartphone message notification, soft two-tone pleasant ping, clean app alert sound" },
  { id: "sfx-success", label: "Success chime", mood: "notification", durationMs: 1515, prompt: "Video game level complete jingle, three quick ascending bright marimba and bell notes, cheerful success sound, short and polished" },
  { id: "sfx-cash", label: "Cash register", mood: "notification", durationMs: 1515, prompt: "Cash register ka-ching, coins and a bright bell, money earned sound, clean and satisfying" },
  { id: "sfx-impact", label: "Impact", mood: "emphasis", durationMs: 2038, prompt: "Deep cinematic impact boom hit, powerful trailer slam with low sub bass and a short tail, punchy and clean" },
  { id: "sfx-bass-drop", label: "Bass drop", mood: "emphasis", durationMs: 2508, prompt: "Heavy sub bass drop, deep 808 boom with a downward pitch sweep, powerful and clean, for a big reveal" },
  { id: "sfx-record-scratch", label: "Record scratch", mood: "emphasis", durationMs: 1045, prompt: "Vinyl record scratch that stops abruptly, classic comedic record scratch freeze moment" },
  { id: "sfx-cheer", label: "Crowd cheer", mood: "emphasis", durationMs: 3866, prompt: "Crowd cheering and applauding excitedly, medium sized audience clapping and whooping, celebration" },
  { id: "sfx-riser", label: "Riser", mood: "tension", durationMs: 2769, prompt: "Cinematic tension riser building up steadily, rising white noise and pitch sweep that gets louder and brighter, ends right at its peak, no drums" },
  { id: "sfx-heartbeat", label: "Heartbeat", mood: "tension", durationMs: 2691, prompt: "Deep slow heartbeat, two thumps per beat, tense suspense heartbeat with low thumping bass, clean" },
];

export const AUDIO_LIBRARY: readonly LibraryItem[] = [...MUSIC.map((item) => ({ ...item, kind: "music" as const })), ...SFX.map((item) => ({ ...item, kind: "sfx" as const }))];

/** Library recordings committed with the app (music/<id>.mp3, sfx/<id>.mp3). */
export const AUDIO_LIBRARY_DIR = path.resolve(process.env.CREWCUT_AUDIO_LIBRARY_DIR ?? path.join(WORKSPACE_ROOT, "apps", "studio", "library"));

export function libraryFileName(item: LibraryItem): string {
  return `lib-${item.id}.mp3`;
}

export const LIBRARY_MIME = "audio/mpeg";

export function libraryLicence(item: LibraryItem): Record<string, unknown> {
  const model = item.kind === "music" ? "Eleven Music" : "Sound Effects";
  return { name: `Crewcut built-in library (ElevenLabs ${model}, paid plan)`, commercialUse: true, aiGenerated: true };
}

const pending = new Map<string, Promise<number>>();

/** Copies the item's recording into storage once; returns its size in bytes. */
export function ensureLibraryFile(item: LibraryItem): Promise<number> {
  let promise = pending.get(item.id);
  if (!promise) {
    promise = (async () => {
      const fileName = libraryFileName(item);
      let size: number;
      try {
        size = (await stat(storagePath("assets", fileName))).size;
      } catch {
        const bytes = new Uint8Array(await readFile(path.join(AUDIO_LIBRARY_DIR, item.kind, `${item.id}.mp3`)));
        await writeStorageFile("assets", fileName, bytes);
        size = bytes.byteLength;
      }
      await promoteToRemote("assets", fileName, LIBRARY_MIME).catch(() => undefined);
      return size;
    })();
    promise.catch(() => pending.delete(item.id));
    pending.set(item.id, promise);
  }
  return promise;
}
