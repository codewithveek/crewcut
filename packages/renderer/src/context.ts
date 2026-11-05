import type { ArtDirectionBrief, Composition } from "@crewcut/composition";
import { createContext, useContext } from "react";

export interface RenderOptions {
  /** Burn captions into the frame (default for 9:16 and 1:1 cuts). */
  burnCaptions: boolean;
  /** Reduced-motion export: positional motion becomes crossfades. */
  reducedMotion: boolean;
  /** Draw selection/debug outlines (editor only). */
  showSafeArea: boolean;
}

export const DEFAULT_RENDER_OPTIONS: RenderOptions = { burnCaptions: true, reducedMotion: false, showSafeArea: false };

export interface FrameContextValue {
  composition: Composition;
  brief: ArtDirectionBrief;
  width: number;
  height: number;
  /** Design px → output px. */
  scale: number;
  seed: number;
  options: RenderOptions;
  resolveSrc: (src: string) => string | null;
}

export const FrameContext = createContext<FrameContextValue | null>(null);

/** True inside a visual track whose sound is muted (video layers go silent). */
export const TrackMutedContext = createContext(false);

export function useFrameContext(): FrameContextValue {
  const value = useContext(FrameContext);
  if (!value) throw new Error("Crewcut layers must render inside <CrewcutVideo>");
  return value;
}

/** `asset:<id>` → its (signed) URL; `estimated:` audio → nothing; anything else passes through. */
export function createSrcResolver(assetUrls: Record<string, string>): (src: string) => string | null {
  return (src) => {
    if (src.startsWith("asset:")) return assetUrls[src.slice("asset:".length)] ?? null;
    if (src.startsWith("estimated:")) return null;
    if (/^(https?:|data:|blob:|file:|\/)/.test(src)) return src;
    return assetUrls[src] ?? null;
  };
}
