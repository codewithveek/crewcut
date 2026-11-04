import { type Fill, type ResolvedTransform, cssFontStack, resolveFontFamily, type FontFamily, type FontRole, type TypePairing, STATIC_WEIGHT_FAMILIES } from "@proofcut/composition";
import type { CSSProperties } from "react";

export function fillToCss(fill: Fill | undefined): string | undefined {
  if (!fill) return undefined;
  if (typeof fill === "string") return fill;
  const stops = fill.gradient.stops.map((stop) => `${stop.color} ${Math.round(stop.at * 100)}%`).join(", ");
  return fill.gradient.kind === "radial" ? `radial-gradient(closest-side, ${stops})` : `linear-gradient(${fill.gradient.angle}deg, ${stops})`;
}

export function fontCss(font: FontRole | FontFamily, pairing: TypePairing, weight: number): Pick<CSSProperties, "fontFamily" | "fontWeight"> {
  const family = resolveFontFamily(font, pairing);
  const fixed = STATIC_WEIGHT_FAMILIES[family];
  return { fontFamily: cssFontStack(family), fontWeight: fixed ?? weight };
}

/**
 * One wrapper owns position and every transform (Cutroom's lesson: never
 * stack a second transform on the same element — wrap instead).
 */
export function frameStyle(
  transform: ResolvedTransform,
  options: { width: number; height: number; scale: number; cameraOffset?: { x: number; y: number }; depth?: number },
): CSSProperties {
  const depth = options.depth ?? 1;
  const offsetX = transform.offsetX * options.scale - (options.cameraOffset?.x ?? 0) * depth * options.scale;
  const offsetY = transform.offsetY * options.scale - (options.cameraOffset?.y ?? 0) * depth * options.scale;
  const parts = [
    `translate(${-transform.anchorX * 100}%, ${-transform.anchorY * 100}%)`,
    `translate(${offsetX.toFixed(2)}px, ${offsetY.toFixed(2)}px)`,
  ];
  if (transform.rotateX || transform.rotateY) parts.push(`perspective(${1600 * options.scale}px) rotateX(${transform.rotateX}deg) rotateY(${transform.rotateY}deg)`);
  if (transform.rotation) parts.push(`rotate(${transform.rotation}deg)`);
  const scaleX = transform.scale * transform.scaleX;
  const scaleY = transform.scale * transform.scaleY;
  if (scaleX !== 1 || scaleY !== 1) parts.push(`scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)})`);
  const hasClip = transform.clipTop || transform.clipRight || transform.clipBottom || transform.clipLeft;
  return {
    position: "absolute",
    left: `${transform.x}%`,
    top: `${transform.y}%`,
    // Auto-sized layers (text) size to their content. Without max-content an
    // absolutely positioned box at left:50% shrinks to the remaining width,
    // and the anchor translate would centre the box rather than the text.
    ...(transform.width !== undefined ? { width: (transform.width / 100) * options.width } : { width: "max-content" }),
    ...(transform.height !== undefined ? { height: (transform.height / 100) * options.height } : {}),
    transform: parts.join(" "),
    transformOrigin: `${transform.originX * 100}% ${transform.originY * 100}%`,
    opacity: transform.opacity,
    ...(transform.blur > 0.05 ? { filter: `blur(${(transform.blur * options.scale).toFixed(2)}px)` } : {}),
    ...(hasClip ? { clipPath: `inset(${transform.clipTop}% ${transform.clipRight}% ${transform.clipBottom}% ${transform.clipLeft}%)` } : {}),
    willChange: "transform, opacity",
  };
}

/** Splits `*accent*` spans; unbalanced stars stay literal (Cutroom's starred text). */
export function parseStarred(text: string): Array<{ text: string; accent: boolean }> {
  const parts: Array<{ text: string; accent: boolean }> = [];
  const pattern = /\*([^*\n]+)\*/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ text: text.slice(last, index), accent: false });
    parts.push({ text: match[1] ?? "", accent: true });
    last = index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), accent: false });
  return parts;
}
