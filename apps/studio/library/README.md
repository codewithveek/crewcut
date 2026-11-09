# Built-in audio library (shipped with the app)

`music/<id>.mp3` and `sfx/<id>.mp3` are the built-in tracks and sounds listed by
`list-audio-library`. They were made with ElevenLabs (Eleven Music and Sound
Effects, paid plan, commercial use) and processed once:

- **Music:** 60 s instrumental beds. Leading and trailing silence trimmed, 1.5 s
  fade out, two-pass loudness normalisation to -16 LUFS / -1.5 dBTP.
- **Sound effects:** leading and trailing silence trimmed, a short fade at the
  end, takes that repeated the event (click, shutter) cut to the first hit,
  levelled to about -15 dB RMS with peaks capped at -1 dBFS.

All files are MP3 VBR (q 2). The list, labels, durations, tempos and the prompt
each item was made from live in `server/lib/audio-library.ts` (`MUSIC`, `SFX`).
The first time an item is needed the app copies it into storage as
`lib-<id>.mp3` (or R2 when configured).

## Tempo

`bpm` is measured from the file, not taken from the prompt: Eleven Music drifts
from the asked tempo (Upbeat pulse was asked for 112 and plays at 114.75), and
beat sync places cuts on the stored value. Measure by fitting a beat grid to the
kick drum (low-passed onsets) across the whole track.

## Adding or replacing an item

1. Generate it from the prompt (`/v1/music` or `/v1/sound-generation`).
2. Process it the same way and save it here as `music/<id>.mp3` or `sfx/<id>.mp3`.
3. Add or update its entry (`durationMs` = the processed length; `bpm` measured).
4. A replaced file only reaches servers whose storage doesn't already hold
   `lib-<id>.mp3`: give a changed item a new id, or delete the stored copy.

Templates keep their own music in `templates/music/`.
