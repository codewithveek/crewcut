import React from "react";
import type { ChartLayer, CodeLayer } from "@proofcut/composition";

import { CODE_THEMES, tokenizeLine } from "../code-highlight";
import { useFrameContext } from "../context";
import { fontCss } from "../styles";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function CodeLayerView({ layer, progress }: { layer: CodeLayer; progress: number }) {
  const { brief, scale, options } = useFrameContext();
  const theme = CODE_THEMES[layer.theme];
  const lines = layer.code.replace(/\t/g, "  ").split("\n");
  const fontSize = layer.fontSize * scale;
  const totalChars = layer.code.length;
  const typedChars = layer.reveal === "type" ? Math.floor(clamp01(progress) * totalChars) : totalChars;
  let consumed = 0;
  const gutterWidth = String(lines.length).length;
  const mono = fontCss("mono", brief.typePairing, 450);
  const reveal = options.reducedMotion && layer.reveal === "lines" ? "none" : layer.reveal;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: theme.background,
        borderRadius: 18 * scale,
        boxShadow: `inset 0 0 0 ${1.5 * scale}px ${theme.border}${layer.shadow ? `, ${layer.shadow.x * scale}px ${layer.shadow.y * scale}px ${layer.shadow.blur * scale}px ${layer.shadow.color}` : ""}`,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 * scale, padding: `${14 * scale}px ${20 * scale}px`, background: theme.chrome }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((color) => (
          <span key={color} style={{ width: 13 * scale, height: 13 * scale, borderRadius: "50%", background: color, display: "inline-block" }} />
        ))}
        {layer.title ? (
          <span style={{ ...mono, marginLeft: 10 * scale, fontSize: fontSize * 0.75, color: theme.gutter }}>{layer.title}</span>
        ) : null}
      </div>
      <div style={{ ...mono, fontSize, lineHeight: 1.6, padding: `${18 * scale}px ${24 * scale}px`, flex: 1, overflow: "hidden" }}>
        {lines.map((line, index) => {
          const lineProgress = reveal === "lines" ? clamp01(progress * lines.length * 1.15 - index) : 1;
          const visibleText = reveal === "type" ? line.slice(0, Math.max(0, typedChars - consumed)) : line;
          consumed += line.length + 1;
          const highlighted = layer.highlightLines.includes(index + 1);
          const showCaret = reveal === "type" && progress < 1 && typedChars >= consumed - line.length - 1 && typedChars < consumed;
          return (
            <div
              key={index}
              style={{
                display: "flex",
                whiteSpace: "pre",
                opacity: lineProgress,
                transform: `translateY(${((1 - lineProgress) * 0.5).toFixed(3)}em)`,
                background: highlighted ? `${brief.palette.accent.slice(0, 7)}26` : undefined,
                boxShadow: highlighted ? `inset ${3 * scale}px 0 0 ${brief.palette.accent}` : undefined,
                margin: `0 ${-24 * scale}px`,
                padding: `0 ${24 * scale}px`,
              }}
            >
              {layer.showLineNumbers ? (
                <span style={{ color: theme.gutter, width: `${gutterWidth + 1.5}ch`, flexShrink: 0, userSelect: "none" }}>{(layer.source?.lineStart ?? 1) + index}</span>
              ) : null}
              <span>
                {tokenizeLine(visibleText).map((token, tokenIndex) => (
                  <span key={tokenIndex} style={{ color: theme.colors[token.kind] }}>
                    {token.text}
                  </span>
                ))}
                {showCaret ? <span style={{ background: brief.palette.accent, width: "0.55ch", display: "inline-block" }}>&nbsp;</span> : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatValue(value: number, layer: ChartLayer): string {
  const formatted = new Intl.NumberFormat("en-US", { minimumFractionDigits: layer.decimals, maximumFractionDigits: layer.decimals }).format(value);
  return `${layer.prefix}${formatted}${layer.suffix}`;
}

export function ChartLayerView({ layer, progress, boxWidth, boxHeight }: { layer: ChartLayer; progress: number; boxWidth: number; boxHeight: number }) {
  const { brief, scale } = useFrameContext();
  const colors = layer.colors.length > 0 ? layer.colors : [brief.palette.accent, brief.palette.accent2 ?? brief.palette.ink, brief.palette.muted];
  const label = { ...fontCss("body", brief.typePairing, 500), fontSize: layer.fontSize * scale, fill: brief.palette.muted, color: brief.palette.muted };
  const p = clamp01(progress);

  if (layer.chart === "number") {
    const value = (layer.data[0]?.value ?? 0) * p;
    return (
      <div
        style={{
          ...fontCss("display", brief.typePairing, 800),
          width: "100%",
          height: "100%",
          display: "grid",
          placeItems: "center",
          fontSize: layer.fontSize * scale,
          letterSpacing: "-0.04em",
          lineHeight: 1,
          color: colors[0],
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {formatValue(value, layer)}
      </div>
    );
  }

  const width = Math.max(1, boxWidth);
  const height = Math.max(1, boxHeight);
  const max = Math.max(...layer.data.map((datum) => Math.abs(datum.value)), 1e-6);
  const labelSpace = layer.showLabels ? layer.fontSize * scale * 1.9 : 0;

  if (layer.chart === "bar") {
    const gap = width * 0.04;
    const barWidth = (width - gap * (layer.data.length - 1)) / layer.data.length;
    const plotHeight = height - labelSpace * 2;
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: "visible" }}>
        {layer.data.map((datum, index) => {
          const staggered = clamp01(p * (1 + layer.data.length * 0.15) - index * 0.15);
          const barHeight = (Math.abs(datum.value) / max) * plotHeight * staggered;
          const x = index * (barWidth + gap);
          const y = labelSpace + plotHeight - barHeight;
          return (
            <g key={index}>
              <rect x={x} y={y} width={barWidth} height={barHeight} rx={Math.min(16 * scale, barWidth / 4)} fill={colors[index % colors.length]} />
              {layer.showLabels ? (
                <>
                  <text x={x + barWidth / 2} y={y - layer.fontSize * scale * 0.5} textAnchor="middle" style={{ ...label, fill: brief.palette.ink, opacity: staggered }}>
                    {formatValue(datum.value * staggered, layer)}
                  </text>
                  <text x={x + barWidth / 2} y={height - layer.fontSize * scale * 0.3} textAnchor="middle" style={label}>
                    {datum.label}
                  </text>
                </>
              ) : null}
            </g>
          );
        })}
      </svg>
    );
  }

  if (layer.chart === "line") {
    const plotHeight = height - labelSpace;
    const points = layer.data.map((datum, index) => ({
      x: (index / Math.max(1, layer.data.length - 1)) * width,
      y: plotHeight - (datum.value / max) * plotHeight * 0.9,
    }));
    const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
    const length = points.reduce((sum, point, index) => {
      const previous = points[index - 1];
      return previous ? sum + Math.hypot(point.x - previous.x, point.y - previous.y) : sum;
    }, 0);
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: "visible" }}>
        <path d={path} fill="none" stroke={colors[0]} strokeWidth={6 * scale} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={length} strokeDashoffset={length * (1 - p)} />
        {points.map((point, index) => (
          <circle key={index} cx={point.x} cy={point.y} r={8 * scale} fill={colors[0]} opacity={p >= index / Math.max(1, points.length - 1) ? 1 : 0} />
        ))}
        {layer.showLabels
          ? layer.data.map((datum, index) => (
              <text key={index} x={points[index]?.x ?? 0} y={height - layer.fontSize * scale * 0.2} textAnchor="middle" style={label}>
                {datum.label}
              </text>
            ))
          : null}
      </svg>
    );
  }

  // Donut
  const size = Math.min(width, height);
  const radius = size * 0.38;
  const circumference = 2 * Math.PI * radius;
  const total = layer.data.reduce((sum, datum) => sum + Math.max(0, datum.value), 0) || 1;
  let offset = 0;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <g transform={`translate(${width / 2} ${height / 2}) rotate(-90)`}>
        <circle r={radius} fill="none" stroke={`${brief.palette.muted.slice(0, 7)}33`} strokeWidth={size * 0.1} />
        {layer.data.map((datum, index) => {
          const share = (Math.max(0, datum.value) / total) * p;
          const dash = share * circumference;
          const element = (
            <circle key={index} r={radius} fill="none" stroke={colors[index % colors.length]} strokeWidth={size * 0.1} strokeDasharray={`${dash} ${circumference}`} strokeDashoffset={-offset} />
          );
          offset += dash;
          return element;
        })}
      </g>
      <text x={width / 2} y={height / 2} textAnchor="middle" dominantBaseline="central" style={{ ...fontCss("display", brief.typePairing, 800), fontSize: layer.fontSize * scale * 1.6, fill: brief.palette.ink }}>
        {formatValue((layer.data[0]?.value ?? 0) * p, layer)}
      </text>
    </svg>
  );
}
