import {
  type Composition,
  type StyleFingerprint,
  checkVariety,
  iterateLayers,
  layerWindow,
  lintMotion,
  styleFingerprint,
} from "@proofcut/composition";
import {
  type AuditReport,
  type Dossier,
  type Platform,
  PLATFORM_SPECS,
  type QaFinding,
  type QaReport,
  type Script,
  countWords,
  scriptLines,
  scriptWordCount,
  wordBudget,
} from "@proofcut/contracts";

/**
 * The QA agent's deterministic checks: claims, hook, pacing, reading speed,
 * licences, platform rules, sameness, motion and caption coverage. Every
 * finding names where it is and how to fix it. Pass = no blockers.
 */
export const QA_LIMITS = {
  hookMaxWords: 12,
  hookHardMaxWords: 14,
  hookMaxMs: 3000,
  maxWordsPerMinute: 185,
  /** On-screen text: characters per second a viewer can read (with the narration). */
  maxOnScreenCharsPerSecond: 22,
  maxLineWords: 22,
  maxShortSceneMs: 6000,
  maxLongSceneMs: 12_000,
  captionCoverage: 0.7,
} as const;

const SEVERITY_COST = { blocker: 40, major: 10, minor: 3 } as const;

export interface QaAsset {
  id: string;
  label: string;
  kind: string;
  licence: { name: string; commercialUse: boolean; aiGenerated?: boolean } | null;
}

export interface RunQaInput {
  script: Script;
  dossier: Dossier | null;
  audit: AuditReport | null;
  composition: Composition | null;
  platforms: readonly Platform[];
  assets?: readonly QaAsset[];
  recent?: ReadonlyArray<{ id: string; title: string; fingerprint: StyleFingerprint }>;
  varietyThreshold?: number;
  consistencyRequested?: boolean;
  now?: () => Date;
}

export function runQa(input: RunQaInput): QaReport {
  const findings: QaFinding[] = [
    ...claimFindings(input.audit),
    ...scriptFindings(input.script),
    ...(input.composition ? compositionFindings(input) : []),
    ...licenceFindings(input.assets ?? []),
  ];
  const score = Math.max(0, 100 - findings.reduce((sum, finding) => sum + SEVERITY_COST[finding.severity], 0));
  const words = scriptWordCount(input.script);
  const durationMs = input.composition?.durationMs ?? 0;
  return {
    pass: !findings.some((finding) => finding.severity === "blocker"),
    score,
    findings,
    metrics: {
      words,
      wordBudget: wordBudget(input.script),
      durationSec: Math.round(durationMs / 100) / 10,
      wordsPerMinute: durationMs > 0 ? Math.round((words / durationMs) * 60_000) : 0,
      claims: input.audit?.results.length ?? 0,
      unsupportedClaims: input.audit?.counts.unsupported ?? 0,
    },
    createdAt: (input.now?.() ?? new Date()).toISOString(),
  };
}

function claimFindings(audit: AuditReport | null): QaFinding[] {
  if (!audit) {
    return [{ severity: "blocker", code: "claims_unaudited", area: "claims", message: "The script's claims haven't been audited.", fix: "Run audit-claims." }];
  }
  return audit.results.flatMap((result): QaFinding[] => {
    if (result.verdict === "unsupported" && !result.overrideReason) {
      return [{ severity: "blocker", code: "unsupported_claim", area: "claims", where: result.lineId, message: `Unsupported: "${result.text}"`, fix: result.suggestion ?? "Cite a verified fact, soften, or cut the line." }];
    }
    if (result.verdict === "weak") {
      return [{ severity: "minor", code: "weak_claim", area: "claims", where: result.lineId, message: `Weak: "${result.text}"`, fix: result.suggestion ?? "Qualify the claim." }];
    }
    return [];
  });
}

function scriptFindings(script: Script): QaFinding[] {
  const findings: QaFinding[] = [];
  const lines = scriptLines(script);
  const hook = script.beats[0]?.lines[0];
  if (hook) {
    const hookWords = countWords(hook.text);
    if (hookWords > QA_LIMITS.hookMaxWords) {
      findings.push({
        severity: hookWords > QA_LIMITS.hookHardMaxWords ? "major" : "minor",
        code: "hook_long",
        area: "hook",
        where: hook.id,
        message: `The hook is ${hookWords} words.`,
        fix: `Cut it to ${QA_LIMITS.hookMaxWords} words or fewer: a direct question or an imperative, no greeting.`,
      });
    }
    if (/^(hi|hey|hello|welcome|in this video|today we)/i.test(hook.text)) {
      findings.push({ severity: "major", code: "hook_greeting", area: "hook", where: hook.id, message: "The video opens with a greeting.", fix: "Open on the claim or the question itself." });
    }
  }
  if (script.beats[0]?.kind !== "hook") {
    findings.push({ severity: "minor", code: "no_hook_beat", area: "hook", message: "The first beat isn't a hook.", fix: "Start with a hook beat." });
  }
  for (const line of lines) {
    const words = countWords(line.text);
    if (words > QA_LIMITS.maxLineWords) {
      findings.push({ severity: "minor", code: "line_long", area: "reading", where: line.id, message: `Line ${line.id} is ${words} words.`, fix: "One sentence per line, 22 words or fewer." });
    }
  }
  const budget = wordBudget(script);
  const total = scriptWordCount(script);
  if (total > budget * 1.15) {
    findings.push({ severity: "major", code: "over_budget", area: "pacing", message: `The script is ${total} words for a ${budget}-word budget.`, fix: `Cut about ${total - budget} words.` });
  } else if (total < budget * 0.6) {
    findings.push({ severity: "minor", code: "under_budget", area: "pacing", message: `The script is ${total} words for a ${budget}-word budget.`, fix: "Shorten the target length or add a proof beat." });
  }
  return findings;
}

function compositionFindings(input: RunQaInput): QaFinding[] {
  const composition = input.composition as Composition;
  const findings: QaFinding[] = [];
  const voiceTrack = composition.tracks.find((track) => track.kind === "audio" && track.role === "voice");
  const voiceClips = voiceTrack?.kind === "audio" ? voiceTrack.clips : [];
  const voicedMs = voiceClips.reduce((sum, clip) => sum + clip.durationMs, 0);
  const words = scriptWordCount(input.script);

  // Reading speed of the narration itself.
  if (voicedMs > 0) {
    const wpm = (words / voicedMs) * 60_000;
    if (wpm > QA_LIMITS.maxWordsPerMinute) {
      findings.push({ severity: "major", code: "narration_fast", area: "reading", message: `Narration runs at ${Math.round(wpm)} wpm.`, fix: `Slow the voice or cut words (≤ ${QA_LIMITS.maxWordsPerMinute} wpm).` });
    }
  }
  const firstVoice = [...voiceClips].sort((a, b) => a.startMs - b.startMs)[0];
  if (firstVoice && firstVoice.startMs + firstVoice.durationMs > QA_LIMITS.hookMaxMs + 600) {
    findings.push({
      severity: "minor",
      code: "hook_slow",
      area: "hook",
      where: firstVoice.lineId,
      message: `The hook line runs ${((firstVoice.startMs + firstVoice.durationMs) / 1000).toFixed(1)} s.`,
      fix: "Land the hook within 3 seconds.",
    });
  }

  // On-screen text that can't be read in the time it's visible.
  for (const { clip, layer } of iterateLayers(composition)) {
    if (layer.type !== "text") continue;
    const window = layerWindow(clip, layer);
    const visibleSec = Math.max(0.1, (window.endMs - window.startMs) / 1000);
    const chars = layer.text.replace(/\*/g, "").length;
    if (chars > 24 && chars / visibleSec > QA_LIMITS.maxOnScreenCharsPerSecond) {
      findings.push({
        severity: "minor",
        code: "text_unreadable",
        area: "reading",
        where: `${clip.id}/${layer.id}`,
        message: `"${layer.text.slice(0, 40)}…" is on screen ${visibleSec.toFixed(1)} s for ${chars} characters.`,
        fix: "Hold it longer or shorten the text.",
      });
    }
  }

  // Pacing: average and longest scene.
  const sceneTrack = composition.tracks.find((track) => track.kind === "visual");
  const scenes = sceneTrack?.kind === "visual" ? sceneTrack.clips : [];
  const isShort = composition.ratio !== "16:9" || composition.durationMs <= 90_000;
  const maxScene = isShort ? QA_LIMITS.maxShortSceneMs : QA_LIMITS.maxLongSceneMs;
  for (const scene of scenes) {
    if (scene.durationMs > maxScene * 1.5) {
      findings.push({ severity: "minor", code: "long_hold", area: "pacing", where: scene.id, message: `"${scene.name ?? scene.id}" holds for ${(scene.durationMs / 1000).toFixed(1)} s.`, fix: "Split it or add a beat of motion inside it." });
    }
  }
  const average = scenes.length ? scenes.reduce((sum, scene) => sum + scene.durationMs, 0) / scenes.length : 0;
  if (average > maxScene) {
    findings.push({ severity: "major", code: "slow_pacing", area: "pacing", message: `Scenes average ${(average / 1000).toFixed(1)} s.`, fix: `Aim for a new visual every ${isShort ? "2–4" : "4–8"} s.` });
  }

  // Captions cover the voice.
  const captionTrack = composition.tracks.find((track) => track.kind === "caption");
  const captionMs = captionTrack?.kind === "caption" ? captionTrack.clips.reduce((sum, clip) => sum + clip.durationMs, 0) : 0;
  if (voicedMs > 0 && captionMs / voicedMs < QA_LIMITS.captionCoverage) {
    findings.push({ severity: "minor", code: "caption_gaps", area: "accessibility", message: `Captions cover ${Math.round((captionMs / voicedMs) * 100)}% of the narration.`, fix: "Regenerate captions from the voice track." });
  }

  // Platform rules: duration and aspect, before anything is rendered.
  for (const platform of input.platforms) {
    const spec = PLATFORM_SPECS[platform];
    const seconds = composition.durationMs / 1000;
    if (seconds < spec.minSec || seconds > spec.maxSec) {
      findings.push({ severity: "blocker", code: "platform_duration", area: "platform", where: platform, message: `${spec.label} accepts ${spec.minSec}–${spec.maxSec} s; this is ${seconds.toFixed(1)} s.`, fix: "Cut a version for this platform or drop it from the targets." });
    }
    if (!spec.aspects.includes(composition.ratio)) {
      findings.push({ severity: "major", code: "platform_aspect", area: "platform", where: platform, message: `${spec.label} expects ${spec.aspects.join(" or ")}, the master is ${composition.ratio}.`, fix: "Render a reframed cut for this platform." });
    }
  }

  // Sameness: compare against recent videos in the workspace.
  if (input.recent && input.recent.length > 0) {
    const report = checkVariety(styleFingerprint(composition), input.recent, {
      ...(input.varietyThreshold !== undefined ? { threshold: input.varietyThreshold } : {}),
      ...(input.consistencyRequested !== undefined ? { consistencyRequested: input.consistencyRequested } : {}),
    });
    if (report.tooSimilar && report.closest) {
      findings.push({
        severity: "major",
        code: "too_similar",
        area: "sameness",
        where: report.closest.id,
        message: `Looks ${Math.round(report.closest.score * 100)}% like "${report.closest.title}" (shared: ${report.closest.sharedTraits.join(", ") || "overall feel"}).`,
        fix: "Ask the motion director for a fresh art direction brief, or say you want consistency.",
      });
    }
  }

  for (const finding of lintMotion(composition)) {
    findings.push({ severity: finding.severity, code: finding.code, area: finding.code === "text_contrast" ? "accessibility" : "motion", where: `${finding.clipId}${finding.layerId ? `/${finding.layerId}` : ""}`, message: finding.message, fix: finding.fix });
  }
  return findings;
}

function licenceFindings(assets: readonly QaAsset[]): QaFinding[] {
  return assets.flatMap((asset): QaFinding[] => {
    if (!asset.licence) return [{ severity: "blocker", code: "licence_missing", area: "licence", where: asset.id, message: `"${asset.label}" has no recorded licence.`, fix: "Record its licence or replace it." }];
    if (!asset.licence.commercialUse) return [{ severity: "blocker", code: "licence_noncommercial", area: "licence", where: asset.id, message: `"${asset.label}" (${asset.licence.name}) doesn't allow commercial use.`, fix: "Replace it with a commercially licensed or generated asset." }];
    return [];
  });
}
