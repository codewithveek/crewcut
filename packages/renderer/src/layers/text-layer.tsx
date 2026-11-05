import React from "react";
import type { CSSProperties, ReactNode } from "react";
import { easedSegmentProgress } from "@crewcut/motion";
import type { TextAnimation, TextLayer } from "@crewcut/composition";

import { useFrameContext } from "../context";
import { fontCss, parseStarred } from "../styles";

interface Word {
  text: string;
  accent: boolean;
  /** Only where the source had whitespace: "*no overshoot*." keeps the period attached. */
  spaceBefore: boolean;
}

function splitLine(line: string): Word[] {
  const words: Word[] = [];
  let pendingSpace = false;
  for (const segment of parseStarred(line)) {
    for (const part of segment.text.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        pendingSpace = true;
        continue;
      }
      words.push({ text: part, accent: segment.accent, spaceBefore: pendingSpace && words.length > 0 });
      pendingSpace = false;
    }
  }
  return words;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function unitStyle(animation: TextAnimation, progress: number, reducedMotion: boolean): { outer?: CSSProperties; inner: CSSProperties } {
  const visible = clamp01(progress);
  if (reducedMotion) return { inner: { opacity: visible } };
  switch (animation.preset) {
    case "mask-rise":
      return {
        outer: { display: "inline-block", overflow: "hidden", verticalAlign: "top", paddingBottom: "0.12em", marginBottom: "-0.12em" },
        inner: { display: "inline-block", transform: `translateY(${((1 - progress) * 110).toFixed(2)}%)` },
      };
    case "blur-in":
      return { inner: { display: "inline-block", opacity: visible, filter: visible < 0.999 ? `blur(${((1 - visible) * 0.14).toFixed(3)}em)` : undefined } };
    case "scale-in":
      return { inner: { display: "inline-block", opacity: visible, transform: `scale(${(0.9 + 0.1 * progress).toFixed(4)})` } };
    case "typewriter":
      return { inner: { opacity: progress > 0 ? 1 : 0 } };
    case "highlight":
      return { inner: { display: "inline-block", opacity: visible } };
    case "fade-rise":
    default:
      return { inner: { display: "inline-block", opacity: visible, transform: `translateY(${((1 - progress) * 0.45).toFixed(3)}em)` } };
  }
}

export function TextLayerView({ layer, localMs }: { layer: TextLayer; localMs: number }) {
  const { brief, scale, width, options } = useFrameContext();
  const { style, animation } = layer;
  const accentColor = style.accentColor ?? brief.palette.accent;
  const highlightColor = style.highlight ?? (animation?.preset === "highlight" ? `${brief.palette.accent.slice(0, 7)}55` : undefined);
  const lines = layer.text.split("\n");
  let wordIndex = 0;
  let charIndex = 0;

  const progressFor = (index: number) =>
    animation ? easedSegmentProgress(animation.easing, localMs - (animation.delayMs + index * animation.staggerMs), animation.durationMs) : 1;

  const renderWord = (word: Word, key: string, lineProgress: number | null): ReactNode => {
    const accentStyle: CSSProperties = word.accent ? { color: accentColor } : {};
    if (word.accent && highlightColor) {
      const sweep = clamp01(animation?.preset === "highlight" ? progressFor(wordIndex) : 1);
      Object.assign(accentStyle, {
        backgroundImage: `linear-gradient(${highlightColor}, ${highlightColor})`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "0 88%",
        backgroundSize: `${(sweep * 100).toFixed(1)}% 0.4em`,
      });
    }
    if (!animation || animation.unit === "line") {
      wordIndex += 1;
      charIndex += word.text.length + 1;
      return (
        <span key={key} style={accentStyle}>
          {word.text}
        </span>
      );
    }
    if (animation.unit === "char") {
      const chars = [...word.text].map((character, index) => {
        const progress = lineProgress ?? progressFor(charIndex + index);
        const { outer, inner } = unitStyle(animation, progress, options.reducedMotion);
        const span = (
          <span key={`${key}-${index}`} style={inner}>
            {character}
          </span>
        );
        return outer ? (
          <span key={`${key}-${index}-o`} style={outer}>
            {span}
          </span>
        ) : (
          span
        );
      });
      charIndex += word.text.length + 1;
      wordIndex += 1;
      return (
        <span key={key} style={{ ...accentStyle, display: "inline-block", whiteSpace: "nowrap" }}>
          {chars}
        </span>
      );
    }
    const progress = progressFor(wordIndex);
    wordIndex += 1;
    charIndex += word.text.length + 1;
    const { outer, inner } = unitStyle(animation, progress, options.reducedMotion);
    const span = (
      <span key={key} style={{ ...inner, ...accentStyle }}>
        {word.text}
      </span>
    );
    return outer ? (
      <span key={`${key}-o`} style={outer}>
        {span}
      </span>
    ) : (
      span
    );
  };

  const font = fontCss(style.font, brief.typePairing, style.weight);
  return (
    <div
      style={{
        ...font,
        width: "max-content",
        maxWidth: (style.maxWidth / 100) * width,
        fontSize: style.size * scale,
        color: style.color ?? brief.palette.ink,
        textAlign: style.align,
        letterSpacing: `${style.tracking}em`,
        lineHeight: style.leading,
        textTransform: style.uppercase ? "uppercase" : "none",
        fontStyle: style.italic ? "italic" : "normal",
        textWrap: "balance",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "pre-wrap",
        ...(style.background ? { background: style.background, borderRadius: style.radius * scale } : {}),
        ...(style.padding ? { padding: style.padding * scale } : {}),
        ...(style.strokeWidth > 0 && style.strokeColor ? { WebkitTextStroke: `${(style.strokeWidth * scale).toFixed(2)}px ${style.strokeColor}`, paintOrder: "stroke fill" } : {}),
        ...(layer.shadow ? { textShadow: `${layer.shadow.x * scale}px ${layer.shadow.y * scale}px ${layer.shadow.blur * scale}px ${layer.shadow.color}` } : {}),
      }}
    >
      {lines.map((line, lineIndex) => {
        const lineProgress = animation?.unit === "line" ? progressFor(lineIndex) : null;
        const words = splitLine(line);
        const content = words.flatMap((word, index) => [
          word.spaceBefore ? " " : null,
          renderWord(word, `${lineIndex}-${index}`, lineProgress),
        ]);
        if (animation?.unit === "line" && lineProgress !== null) {
          const { outer, inner } = unitStyle(animation, lineProgress, options.reducedMotion);
          const innerNode = <span style={{ ...inner, display: "inline-block" }}>{content}</span>;
          return (
            <div key={lineIndex} style={{ display: "block" }}>
              {outer ? <span style={outer}>{innerNode}</span> : innerNode}
            </div>
          );
        }
        return (
          <div key={lineIndex} style={{ display: "block" }}>
            {content}
          </div>
        );
      })}
    </div>
  );
}
