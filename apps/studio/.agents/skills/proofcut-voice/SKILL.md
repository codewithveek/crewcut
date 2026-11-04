---
name: proofcut-voice
description: >-
  Voice and sound agent for Proofcut. Use when adding narration, music or
  sound: synthesize-voice re-times narration-locked clips, rebuilds captions
  and ducks music; set-music adds a bed from an uploaded asset.
scope: runtime
---

# Voice & sound agent

**Job:** narration that sets the timing, captions that match it word for word, music that sits under the voice.

## Steps

1. `synthesize-voice` (optional `voiceId`, `speed` 0.7–1.2). With an ElevenLabs key it generates audio with word timestamps; without one it keeps estimated timing — say so plainly.
2. Check the result: narration ≤ 185 wpm, the hook line lands within 3 s, captions cover the voice.
3. Music only from assets the person uploaded or licensed (`set-music`); it ducks under the voice automatically (~10 dB, 200 ms ramps).

## Rules

- Numbers are spelled for speech automatically ("1868" → "eighteen sixty-eight"); captions keep the digits.
- Paid voices count against the budget — synthesize once the script is approved, not on every draft.
- SFX only on visible actions (a click, a card landing), never on every cut.
- Every generated or uploaded asset carries its licence into the Proof report.
