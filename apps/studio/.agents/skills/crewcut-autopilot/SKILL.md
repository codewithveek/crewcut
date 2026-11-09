---
name: crewcut-autopilot
description: >-
  Autopilot for Crewcut. Use when a video is on autopilot (get-video shows
  autopilot.on, or you're asked to run or continue autopilot): run every stage
  yourself, from ideas to an exported draft, without waiting for the person.
  Fact-check failures go back to the script until they pass. Never publish.
scope: runtime
---

# Autopilot

**Job:** the person switched autopilot on and left. Make the whole video, in order, and stop with an exported draft they can review, re-edit, export again or publish.

The server enforces the rules: on autopilot every gate up to publishing notifies instead of waiting, the trend step picks the top-scored idea itself, failed fact-checks are counted (3 at most), and publishing always waits for the person. You never call `approve-stage`; you don't need to.

## Before each step

`get-video` and read `autopilot.phase` and `progress.current`:

- `making` or `paused`: carry on from `progress.current` (a resumed run starts mid-way; skip finished stages).
- `needs_you`: stop. Tell the person, in one or two sentences, what needs them (`autopilot.reason`).
- `stopped`: the person switched it off. Stop without doing more.
- `exporting` or `ready`: the video is made. Stop.

## The stages

Load each stage's skill before doing it, and follow it fully: autopilot skips the waiting, not the care.

1. **Ideas** (`crewcut-trend`): research the person's brief and call `find-trends` with 3–5 ideas. Score them honestly: the top score is picked automatically. If the brief is already a precise topic, make it the top idea.
2. **Research** (`crewcut-research`): sources, then `build-dossier`. Facts must quote their sources word for word.
3. **Script** (`crewcut-script`): read learnings (`save-learning` with no text), then `write-script`. Every factual line cites facts.
4. **Fact-check** (`crewcut-qa`): `audit-claims`.
   - Blockers: fix every one in the script (cite a fact that says it, use the source's figure, soften, or cut the line) with `apply-fix` or a new `write-script`, then `audit-claims` again. If research is missing, add sources and facts first.
   - When the result says autopilot stopped (`autopilot.stopped`), stop and tell the person which claims still have no source.
   - Never invent a source, and never ask for an override: only the person can override.
5. **Animation** (`crewcut-motion-director`): `compose-video` with a fresh art direction brief. Use the person's media first, then free stock photos (`search-stock-photos`, `import-stock-photo`).
6. **Voice and sound** (`crewcut-voice`): `synthesize-voice` (without a connected voice it keeps estimated timing: carry on), then `set-music`.
7. **Export**: `render-video` (1080p). This is the last step: autopilot ends once the export finishes.

Don't prepare or publish posts, and don't touch analytics.

## When something fails

- An action error you can fix (bad input, a missing step): fix it and retry once.
- Anything else (a service down, no model access, out of credits): stop and say what happened in plain words. The person can resume autopilot from the pipeline page.

## At the end

Write a short note for the person (they'll read it when they come back): the idea you picked, what the video says in one line, anything you cut or softened in fact-check, and that the exported draft is ready to review, re-edit, export or publish.
