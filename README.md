# Proofcut

**An agent-native video studio.** Agents research, script, fact-check, animate, voice, publish and learn from analytics — and a person sees and approves every stage. Every claim in a video links to the source line that proves it.

Built for the Builder.io Agent-Native Hackathon (Nov 2026) on [Agent-Native](https://www.agent-native.com), Remotion 4 and the ideas of [Cutroom](https://github.com/codewithveek/cutroom) and [vid-skills](https://github.com/codewithveek/vid-skills). The plan is in [`Proofcut Masterplan.md`](./Proofcut%20Masterplan.md).

## What it does

```
idea → trend → research → script → QA ⇄ (send back) → motion → voice → render → publish → analytics → next idea
        pick     notify     approve   blocks on         approve   notify            always       notify
                                      unsupported claims                            a person
```

- **Eight specialist agents, one action layer.** The Agent-Native agent loads a stage skill (`proofcut-trend` … `proofcut-analytics`) and works only through typed actions — the same actions the UI buttons, MCP, A2A and the CLI call.
- **Proof over claims.** Research stores sources (secrets redacted, SSRF-safe fetch) and every fact quotes its source verbatim — checked mechanically. The claim audit (from Cutroom) blocks numbers the evidence doesn't contain, unsourced facts and unqualified absolutes; QA offers one-click fixes; overrides need a person and a reason.
- **Freeform motion, not templates.** The motion director writes an art direction brief and composes layers (text, shape, image, video, code, chart, icon, group, camera) with keyframes. Cutroom's ten blocks survive only as editable recipes. A variety guard compares each video's style fingerprint with the last ten.
- **Physical motion.** Apple-style springs (damping ratio + response, converted to Remotion stiffness/damping), entrances from 0.9–0.95, ease-out entrances, symmetric exits, 40–80 ms stagger, blur-bridged crossfades — enforced by a motion lint in QA.
- **A pro timeline.** Millisecond timecode (or frames), frame stepping, J/K/L, I/O, trim/split/ripple/snapping, keyframe lanes, markers, zoom down to single frames, one-step undo through versioned history, and a phone layout.
- **Publishing with people in charge.** YouTube OAuth (PKCE, signed state, vault-stored tokens, revoke), resumable private uploads, platform specs checked before rendering.
- **Analytics that teaches.** Retention drops are mapped to the exact scene and line ("Viewers dropped 39% at 00:09 during the code card; the hook ran 9 s."), comments are grouped, and learnings feed the next script.
- **Proof report.** Every claim with its source, every human decision, every AI-generated asset — printable.

## Repository

| Path | What |
| --- | --- |
| `packages/motion` | Springs (Apple ↔ Remotion), cubic-bezier, keyframe evaluation, ambient motion, motion rules |
| `packages/composition` | Layer composition schema (Zod), edit ops (trim/split/move/keyframes/…), motion presets, recipes, looks, variety guard, motion lint, snapping, timecode |
| `packages/contracts` | Pipeline, idea, dossier, script, claim, QA, platform and analytics schemas |
| `packages/claim-audit` | Deterministic claim audit, quote verification, fixes, approval gate |
| `packages/pipeline` | Orchestrator (stages, gates, send-back), QA, narration timing, deterministic motion director, demo seed |
| `packages/voice` | ElevenLabs (timestamps) + silent providers, word timing, captions, number normalisation, WAV |
| `packages/renderer` | The single Remotion renderer used by the editor's Player and the render worker |
| `packages/distribute` | YouTube OAuth + resumable upload + analytics reader, copy adaptation |
| `packages/analytics` | Retention drops → timeline moments, insights, learnings, outlier scoring |
| `apps/studio` | The Agent-Native app: actions, skills, DB, pipeline board, editor, Proof report, Connections |
| `apps/render-worker` | Render worker (Postgres queue, or spawned per job) and a render CLI |

## Run it

Requirements: Node ≥ 22.22, pnpm 10, a Chromium-based browser for rendering.

```bash
pnpm install
cp .env.example apps/studio/.env          # AUTH_DISABLED=true for local use
pnpm dev                                  # studio on http://localhost:8080
```

Open the Studio and click **Load demo workspace** (no API keys needed), or type an idea and let the agents work (connect a model in agent settings).

Rendering runs outside the web process. With the default local database (PGlite) the studio spawns a worker per render; with Postgres, run the queue worker:

```bash
docker compose up -d postgres             # optional: shared Postgres for studio + worker
pnpm worker                               # claims render jobs from Postgres
pnpm render --demo --ratio 9:16 --out storage/renders/demo.mp4   # one-off render, no database
```

If Remotion can't download Chrome Headless Shell, point it at a local browser: `PROOFCUT_BROWSER_EXECUTABLE=/path/to/chrome`.

### Checks

```bash
pnpm test                                 # 91 unit tests across the domain packages
pnpm typecheck                            # packages + render worker
pnpm --filter @proofcut/studio typecheck  # the app
pnpm --filter @proofcut/studio e2e        # 19-step pipeline check through the real actions on a throwaway DB
```

## Demo script (≈ 3 minutes)

1. Type an idea; the trend and research agents return sourced idea cards. Pick one.
2. The script arrives with a source on every claim. Approve it — QA flags the one unsupported claim; apply its fix.
3. The motion director composes a freeform video and shows its art direction brief.
4. In the editor, trim a clip to the millisecond, nudge a keyframe, apply a motion preset. Ask the agent to "make the hook punchier", then undo it once.
5. Ask for a different look; the variety guard shows it differs from the last video.
6. Render, approve publishing, upload to YouTube as **private** (unaudited API projects stay private until Google's audit).
7. Open the analytics insight on the sample video, then ask for a mini-app comparing retention across videos (`list-metrics`).
8. End on the Proof report.

## Prior-work disclosure

The hackathon rules allow prior code but require naming what existed before 27 October 2026 and what changed during the event.

| Existed before | Licence | Used for | New during the event |
| --- | --- | --- | --- |
| Cutroom (`codewithveek/cutroom`) | MIT | Ideas and rules re-implemented: claim audit checks and approval gate, overclaim lexicon, timing solver, secret redaction, four looks, editor layout and design tokens, Remotion lessons | Layer composition schema and renderer; freeform motion director; springs; pro timeline; redesigned responsive editor |
| vid-skills (`codewithveek/vid-skills`) | Apache-2.0 | YouTube uploader and OAuth (ported and fixed: PKCE, revoke, single-flight refresh, 308 resume, quota errors), caption chunking, word timing, number normalisation, QA checks, platform specs, prompts | Connections page, publish approvals, analytics and trend agents |
| Agent-Native (`@agent-native/core` 0.223.0) | MIT | App shell, actions, auth, vault, sharing, extensions, agent chat | All Proofcut actions, skills, pipeline board, gates, authorship log |
| Emil Kowalski's skills | MIT | Motion and design rules | Proofcut's motion kit, preset library and motion lint |
| Remotion 4.0.536 | Remotion licence (free for teams ≤ 3) | Player and renderer | — |

No source files were copied from Cutroom or vid-skills; their code was studied and rewritten for this architecture. Commits after the 9 November deadline will be listed here.

## Credits

Motion rules after Emil Kowalski's `emil-design-eng`, `apple-design` and `animation-vocabulary` skills. Visual styles and craft rules descend from the author's MIT-licensed `product-videos` skill via Cutroom.
