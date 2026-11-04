import React from "react";
import { type CaptionTrack, clipEndMs } from "@proofcut/composition";
import { springProgress, SPRINGS } from "@proofcut/motion";
import { AbsoluteFill } from "remotion";

import { useFrameContext } from "./context";
import { fontCss } from "./styles";

/** Burned-in captions: karaoke (vid-skills' per-word highlight), clean, pop or boxed. */
export function CaptionsView({ track, timeMs }: { track: CaptionTrack; timeMs: number }) {
  const { brief, scale, composition } = useFrameContext();
  const cue = track.clips.find((clip) => timeMs >= clip.startMs && timeMs < clipEndMs(clip));
  if (!cue) return null;
  const { style } = track;
  const portrait = composition.height > composition.width;
  // Vertical video keeps captions clear of the platform UI (Cutroom's 20% bottom inset).
  const top = style.position === "top" ? 14 : style.position === "middle" ? 50 : portrait ? 80 : 89;
  const appear = Math.min(1, (timeMs - cue.startMs) / 100);
  const words = cue.words.length > 0 ? cue.words : cue.text.split(/\s+/).map((text) => ({ text, startMs: cue.startMs, endMs: clipEndMs(cue) }));
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: `${top}%`,
          transform: `translate(-50%, -50%) translateY(${((1 - appear) * 10 * scale).toFixed(2)}px)`,
          opacity: appear,
          maxWidth: composition.width * (portrait ? 0.84 : 0.72),
          textAlign: "center",
          ...fontCss(style.font, brief.typePairing, style.weight),
          fontSize: style.size * scale,
          lineHeight: 1.18,
          color: style.color,
          textTransform: style.uppercase ? "uppercase" : "none",
          textShadow: style.preset === "boxed" ? "none" : `0 ${2 * scale}px ${12 * scale}px rgba(0,0,0,0.65)`,
          ...(style.preset === "boxed" || style.background
            ? { background: style.background ?? "rgba(0,0,0,0.72)", padding: `${10 * scale}px ${20 * scale}px`, borderRadius: 14 * scale }
            : {}),
        }}
      >
        {words.map((word, index) => {
          const active = timeMs >= word.startMs && timeMs < word.endMs;
          const spoken = timeMs >= word.startMs;
          const emphasized = cue.emphasis.includes(index);
          let wordStyle: React.CSSProperties = {};
          if (style.preset === "karaoke") {
            wordStyle = { color: active || emphasized ? style.highlightColor : style.color, display: "inline-block", transform: active ? "scale(1.06)" : undefined };
          } else if (style.preset === "boxed") {
            wordStyle = { color: active || emphasized ? style.highlightColor : style.color, opacity: spoken ? 1 : 0.62 };
          } else if (style.preset === "pop") {
            const p = spoken ? springProgress(SPRINGS.snappy, (timeMs - word.startMs) / 1000) : 0;
            wordStyle = { display: "inline-block", opacity: Math.min(1, p * 1.4), transform: `scale(${(0.9 + 0.1 * p).toFixed(3)})`, color: emphasized ? style.highlightColor : style.color };
          } else if (emphasized) {
            wordStyle = { color: style.highlightColor };
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
