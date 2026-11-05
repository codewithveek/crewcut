import { MOTION_RULES, isEntranceSafeEasing } from "@crewcut/motion";

import { contrastRatio } from "./fingerprint";
import { iterateLayers } from "./query";
import type { Composition, Keyframe } from "./schema";

export interface MotionFinding {
  severity: "blocker" | "major" | "minor";
  code: string;
  message: string;
  fix: string;
  clipId: string;
  layerId?: string;
}

/**
 * Reviews a composition against the masterplan's motion rules (from Emil
 * Kowalski's `emil-design-eng` / `apple-design` skills) and on-screen text
 * contrast. Findings carry a concrete fix the agent or the user can apply.
 */
export function lintMotion(composition: Composition): MotionFinding[] {
  const findings: MotionFinding[] = [];
  const background = composition.brief.palette.background;

  for (const { clip, layer, parent } of iterateLayers(composition)) {
    const where = { clipId: clip.id, layerId: layer.id };
    const scale = layer.keyframes.scale;
    const firstScale = scale?.[0];
    if (scale && firstScale && scale.length > 1 && firstScale.value < MOTION_RULES.enterScaleMin - 0.05) {
      const growing = (scale[scale.length - 1]?.value ?? 1) > firstScale.value;
      if (growing) {
        findings.push({
          ...where,
          severity: firstScale.value <= 0.01 ? "major" : "minor",
          code: "enter_from_nothing",
          message: `"${layer.name ?? layer.id}" scales in from ${firstScale.value.toFixed(2)}. Nothing appears from nothing.`,
          fix: `Start the scale at ${MOTION_RULES.enterScaleMin}–${MOTION_RULES.enterScaleMax} and pair it with opacity.`,
        });
      }
    }

    const entrance = entranceSegment(layer.keyframes.opacity);
    if (entrance) {
      if (!isEntranceSafeEasing(entrance.to.easing)) {
        findings.push({
          ...where,
          severity: "minor",
          code: "ease_in_entrance",
          message: `"${layer.name ?? layer.id}" enters with an ease-in curve, which feels sluggish.`,
          fix: "Use the entrance curve cubic-bezier(0.23, 1, 0.32, 1) or a critically damped spring.",
        });
      }
      const durationMs = entrance.to.atMs - entrance.from.atMs;
      if (durationMs > 0 && durationMs < MOTION_RULES.entranceMinMs - 120) {
        findings.push({
          ...where,
          severity: "minor",
          code: "entrance_too_fast",
          message: `"${layer.name ?? layer.id}" enters in ${Math.round(durationMs)} ms; viewers need time to read.`,
          fix: `Video entrances read best at ${MOTION_RULES.entranceMinMs}–${MOTION_RULES.entranceMaxMs} ms.`,
        });
      }
    }

    const maxBlur = Math.max(layer.transform.blur, ...(layer.keyframes.blur ?? []).map((keyframe) => keyframe.value));
    if (maxBlur > MOTION_RULES.blurCeilingPx) {
      findings.push({
        ...where,
        severity: "minor",
        code: "blur_ceiling",
        message: `Blur reaches ${maxBlur}px on "${layer.name ?? layer.id}".`,
        fix: `Keep blur at or under ${MOTION_RULES.blurCeilingPx}px; 2–8px is enough to bridge a crossfade.`,
      });
    }

    if (layer.type === "text") {
      const animation = layer.animation;
      if (animation && animation.unit !== "char" && (animation.staggerMs < MOTION_RULES.staggerMinMs || animation.staggerMs > MOTION_RULES.staggerMaxMs)) {
        findings.push({
          ...where,
          severity: "minor",
          code: "stagger_range",
          message: `Text stagger is ${animation.staggerMs} ms on "${layer.name ?? layer.id}".`,
          fix: `Stagger lists by ${MOTION_RULES.staggerMinMs}–${MOTION_RULES.staggerMaxMs} ms so they read as one motion.`,
        });
      }
      const color = layer.style.color ?? composition.brief.palette.ink;
      // Text inside a group sits on the group's filled shape (cards, pills).
      const groupSurface =
        parent?.type === "group"
          ? parent.children.find((child) => child.type === "shape" && typeof child.fill === "string")
          : undefined;
      const groupFill = groupSurface?.type === "shape" && typeof groupSurface.fill === "string" ? groupSurface.fill : undefined;
      const surface = layer.style.background ?? groupFill ?? (typeof clip.background === "string" ? clip.background : background);
      const ratio = contrastRatio(color, surface);
      if (ratio < 3) {
        findings.push({
          ...where,
          severity: ratio < 2 ? "major" : "minor",
          code: "text_contrast",
          message: `Text "${layer.text.slice(0, 40)}" has ${ratio.toFixed(1)}:1 contrast against its background.`,
          fix: "Use the palette's ink colour or add a surface behind the text (aim for 4.5:1).",
        });
      }
      const scale = Math.min(composition.width, composition.height) / 1080;
      if (layer.style.size * scale < 26) {
        findings.push({
          ...where,
          severity: "minor",
          code: "text_too_small",
          message: `Text "${layer.text.slice(0, 40)}" renders at ${Math.round(layer.style.size * scale)}px.`,
          fix: "Nothing read on screen should be under 28px at 1080 wide.",
        });
      }
    }
  }

  for (const track of composition.tracks) {
    if (track.kind !== "visual") continue;
    for (const clip of track.clips) {
      const simultaneous = new Map<number, number>();
      for (const layer of clip.layers) {
        const entrance = entranceSegment(layer.keyframes.opacity);
        if (!entrance) continue;
        const bucket = Math.round((layer.startMs + entrance.from.atMs) / 100);
        simultaneous.set(bucket, (simultaneous.get(bucket) ?? 0) + 1);
      }
      const crowded = Math.max(0, ...simultaneous.values());
      if (crowded >= 5) {
        findings.push({
          clipId: clip.id,
          severity: "minor",
          code: "unstaggered_entrances",
          message: `${crowded} layers enter at the same moment in "${clip.name ?? clip.id}".`,
          fix: "Stagger related layers by 40–80 ms and hold back secondary ones.",
        });
      }
      if (clip.transitionIn && clip.transitionIn.type === "blur-crossfade" && clip.transitionIn.durationMs > 900) {
        findings.push({
          clipId: clip.id,
          severity: "minor",
          code: "slow_transition",
          message: `The transition into "${clip.name ?? clip.id}" lasts ${clip.transitionIn.durationMs} ms.`,
          fix: "Crossfades read as one change at 300–600 ms.",
        });
      }
    }
  }
  return findings;
}

function entranceSegment(keyframes: Keyframe[] | undefined): { from: Keyframe; to: Keyframe } | null {
  if (!keyframes || keyframes.length < 2) return null;
  for (let index = 1; index < keyframes.length; index += 1) {
    const from = keyframes[index - 1];
    const to = keyframes[index];
    if (from && to && from.value <= 0.05 && to.value >= 0.9) return { from, to };
  }
  return null;
}
