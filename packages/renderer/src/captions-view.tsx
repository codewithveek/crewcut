import React from "react";
import { type CaptionClip, type CaptionStyle, type CaptionTrack, clipEndMs, contrastRatio } from "@crewcut/composition";
import { springProgress, SPRINGS } from "@crewcut/motion";
import { AbsoluteFill } from "remotion";

import { useFrameContext } from "./context";
import { fontCss } from "./styles";

/** Default caption anchor: vertical video keeps captions clear of platform UI (Cutroom's 20% bottom inset). */
export function captionAnchor(style: CaptionStyle, portrait: boolean): { x: number; y: number; maxWidth: number } {
  const y = style.positionY ?? (style.position === "top" ? 14 : style.position === "middle" ? 50 : portrait ? 80 : 89);
  return { x: style.positionX ?? 50, y, maxWidth: style.maxWidth ?? (portrait ? 84 : 72) };
}

/** Words with timings; cues typed by hand (no word timings) share the cue evenly by length. */
export function captionWords(cue: CaptionClip): Array<{ text: string; startMs: number; endMs: number }> {
  if (cue.words.length > 0) return cue.words;
  const tokens = cue.text.split(/\s+/).filter(Boolean);
  const total = tokens.reduce((sum, token) => sum + Math.max(1, token.length), 0) || 1;
  let cursor = cue.startMs;
  return tokens.map((text) => {
    const duration = (cue.durationMs * Math.max(1, text.length)) / total;
    const word = { text, startMs: cursor, endMs: cursor + duration };
    cursor += duration;
    return word;
  });
}

function hotWordStyle(style: CaptionStyle, scale: number, karaokeActive: boolean): React.CSSProperties {
  switch (style.highlightStyle) {
    case "box": {
      const dark = contrastRatio(style.highlightColor, "#000000") >= contrastRatio(style.highlightColor, "#ffffff");
      return { background: style.highlightColor, color: dark ? "#000000" : "#ffffff", borderRadius: 0.18 * style.size * scale, padding: `0 ${0.16 * style.size * scale}px`, margin: `0 ${-0.04 * style.size * scale}px`, WebkitTextStroke: "0px transparent", boxDecorationBreak: "clone" };
    }
    case "underline":
      return { textDecorationLine: "underline", textDecorationColor: style.highlightColor, textDecorationThickness: `${Math.max(2, 0.1 * style.size * scale)}px`, textUnderlineOffset: `${0.14 * style.size * scale}px` };
    case "bounce":
      // A lift, not a scale: scaling a word makes it overlap the spaces around it.
      return { color: style.highlightColor, display: "inline-block", transform: karaokeActive ? "translateY(-0.12em)" : undefined };
    default:
      return { color: style.highlightColor };
  }
}

/** Burned-in captions: karaoke (per-word highlight), clean, pop, boxed or outline. */
export function CaptionsView({ track, timeMs }: { track: CaptionTrack; timeMs: number }) {
  const { brief, scale, composition } = useFrameContext();
  const cue = track.clips.find((clip) => timeMs >= clip.startMs && timeMs < clipEndMs(clip));
  if (!cue) return null;
  const { style } = track;
  const portrait = composition.height > composition.width;
  const anchor = captionAnchor(style, portrait);
  const outline = style.preset === "outline";
  const strokeWidth = style.strokeWidth || (outline ? 5 : 0);
  const appear = Math.min(1, (timeMs - cue.startMs) / 100);
  const words = captionWords(cue);
  const boxed = style.preset === "boxed" || Boolean(style.background);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        data-caption-box={cue.id}
        style={{
          position: "absolute",
          left: `${anchor.x}%`,
          top: `${anchor.y}%`,
          transform: `translate(-50%, -50%) translateY(${((1 - appear) * 10 * scale).toFixed(2)}px)`,
          opacity: appear,
          // max-content: an absolutely positioned box at left:50% would otherwise shrink to the remaining half.
          width: "max-content",
          maxWidth: (composition.width * anchor.maxWidth) / 100,
          textAlign: style.align,
          textWrap: "balance",
          ...fontCss(style.font, brief.typePairing, style.weight),
          fontStyle: style.italic ? "italic" : "normal",
          fontSize: style.size * scale,
          lineHeight: 1.18,
          color: style.color,
          textTransform: style.uppercase ? "uppercase" : "none",
          textShadow: !style.shadow || boxed || strokeWidth > 0 ? "none" : `0 ${2 * scale}px ${12 * scale}px rgba(0,0,0,0.65)`,
          ...(strokeWidth > 0 ? { WebkitTextStroke: `${(strokeWidth * scale).toFixed(2)}px ${style.strokeColor ?? "#000000"}`, paintOrder: "stroke fill" } : {}),
          ...(boxed ? { background: style.background ?? "rgba(0,0,0,0.72)", padding: `${10 * scale}px ${20 * scale}px`, borderRadius: 14 * scale } : {}),
        }}
      >
        {words.map((word, index) => {
          const active = timeMs >= word.startMs && timeMs < word.endMs;
          const spoken = timeMs >= word.startMs;
          // Key words light up once they're said and stay lit; before that they look like
          // every other upcoming word. Lit early, they read as the highlight skipping words.
          const emphasized = cue.emphasis.includes(index) && spoken;
          let wordStyle: React.CSSProperties = {};
          if (style.preset === "karaoke" || style.preset === "outline") {
            wordStyle = active || emphasized ? hotWordStyle(style, scale, active) : {};
          } else if (style.preset === "boxed") {
            wordStyle = active || emphasized ? hotWordStyle(style, scale, active) : { opacity: spoken ? 1 : 0.62 };
          } else if (style.preset === "pop") {
            const p = spoken ? springProgress(SPRINGS.snappy, (timeMs - word.startMs) / 1000) : 0;
            wordStyle = { display: "inline-block", opacity: Math.min(1, p * 1.4), transform: `scale(${(0.9 + 0.1 * p).toFixed(3)})`, ...(emphasized ? hotWordStyle(style, scale, false) : {}) };
            if (emphasized && wordStyle.transform === undefined) wordStyle.transform = `scale(${(0.9 + 0.1 * p).toFixed(3)})`;
          } else if (cue.emphasis.includes(index)) {
            wordStyle = hotWordStyle(style, scale, false);
          }
          return (
            <React.Fragment key={index}>
              <span style={wordStyle}>{word.text}</span>
              {index < words.length - 1 ? " " : null}
            </React.Fragment>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}
