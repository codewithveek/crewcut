import type { Adjust, Filter, FilterPreset } from "./schema";

/**
 * Colour effects as CSS filter functions, so the editor preview, the filter
 * thumbnails and the render worker (all Chromium) draw identical pixels.
 * Each preset is a list of filter functions with their identity values; an
 * intensity below 1 interpolates every function toward identity.
 */
type FilterFn = "grayscale" | "sepia" | "saturate" | "contrast" | "brightness" | "hue-rotate";
type FilterStep = [fn: FilterFn, value: number];

const IDENTITY: Record<FilterFn, number> = { grayscale: 0, sepia: 0, saturate: 1, contrast: 1, brightness: 1, "hue-rotate": 0 };

export const FILTER_PRESET_INFO: Record<FilterPreset, { label: string; steps: FilterStep[] }> = {
  mono: { label: "Mono", steps: [["grayscale", 1], ["contrast", 1.08]] },
  noir: { label: "Noir", steps: [["grayscale", 1], ["contrast", 1.45], ["brightness", 0.9]] },
  sepia: { label: "Sepia", steps: [["sepia", 0.85], ["contrast", 1.05]] },
  warm: { label: "Warm", steps: [["sepia", 0.22], ["saturate", 1.3], ["hue-rotate", -6]] },
  cool: { label: "Cool", steps: [["saturate", 1.1], ["hue-rotate", 14], ["brightness", 1.03]] },
  vivid: { label: "Vivid", steps: [["saturate", 1.65], ["contrast", 1.1]] },
  fade: { label: "Fade", steps: [["contrast", 0.8], ["brightness", 1.1], ["saturate", 0.8]] },
  dramatic: { label: "Dramatic", steps: [["contrast", 1.35], ["saturate", 1.2], ["brightness", 0.9]] },
  vintage: { label: "Vintage", steps: [["sepia", 0.45], ["contrast", 0.9], ["saturate", 0.85], ["brightness", 1.06]] },
  dreamy: { label: "Dreamy", steps: [["brightness", 1.1], ["contrast", 0.88], ["saturate", 1.15], ["hue-rotate", -4]] },
};

function formatStep([fn, value]: FilterStep): string {
  if (fn === "hue-rotate") return `hue-rotate(${value.toFixed(1)}deg)`;
  return `${fn}(${Number(value.toFixed(3))})`;
}

export function filterPresetCss(filter: Filter | undefined): string[] {
  if (!filter) return [];
  const preset = FILTER_PRESET_INFO[filter.preset];
  return preset.steps.map(([fn, value]) => formatStep([fn, IDENTITY[fn] + (value - IDENTITY[fn]) * filter.intensity]));
}

/** Brightness/contrast/saturation/hue as CSS; temperature and tint need the colour matrix below. */
export function adjustCss(adjust: Adjust | undefined): string[] {
  if (!adjust) return [];
  const parts: string[] = [];
  if (adjust.brightness) parts.push(formatStep(["brightness", 1 + adjust.brightness / 200]));
  if (adjust.contrast) parts.push(formatStep(["contrast", 1 + adjust.contrast / 100]));
  if (adjust.saturation) parts.push(formatStep(["saturate", 1 + adjust.saturation / 100]));
  if (adjust.hue) parts.push(formatStep(["hue-rotate", adjust.hue]));
  return parts;
}

/**
 * White balance as an feColorMatrix (R and B scale against each other for
 * temperature, G against R+B for tint). Null when neutral.
 */
export function colorBalanceMatrix(adjust: Adjust | undefined): string | null {
  if (!adjust || (!adjust.temperature && !adjust.tint)) return null;
  const t = adjust.temperature / 100;
  const g = adjust.tint / 100;
  const r = 1 + 0.18 * t + 0.06 * g;
  const gg = 1 - 0.12 * g;
  const b = 1 - 0.18 * t + 0.06 * g;
  const fmt = (value: number) => Number(value.toFixed(4));
  return `${fmt(r)} 0 0 0 0  0 ${fmt(gg)} 0 0 0  0 0 ${fmt(b)} 0 0  0 0 0 1 0`;
}

export function hasColorEffects(target: { adjust?: Adjust | undefined; filter?: Filter | undefined }): boolean {
  const adjust = target.adjust;
  return Boolean(
    target.filter ||
      (adjust && (adjust.brightness || adjust.contrast || adjust.saturation || adjust.hue || adjust.temperature || adjust.tint || adjust.vignette)),
  );
}

/** Full CSS `filter` value (optionally referencing an SVG colour-matrix filter by id). */
export function colorFilterCss(target: { adjust?: Adjust | undefined; filter?: Filter | undefined }, options: { matrixFilterId?: string; blurPx?: number } = {}): string | undefined {
  const parts = [...filterPresetCss(target.filter), ...adjustCss(target.adjust)];
  if (options.matrixFilterId && colorBalanceMatrix(target.adjust)) parts.unshift(`url(#${options.matrixFilterId})`);
  if (options.blurPx && options.blurPx > 0.05) parts.push(`blur(${options.blurPx.toFixed(2)}px)`);
  return parts.length ? parts.join(" ") : undefined;
}

export function vignetteCss(adjust: Adjust | undefined): string | undefined {
  if (!adjust?.vignette) return undefined;
  const strength = adjust.vignette / 100;
  return `radial-gradient(ellipse at center, transparent ${Math.round(62 - strength * 22)}%, rgba(0,0,0,${(0.25 + strength * 0.55).toFixed(2)}) 100%)`;
}

export const DEFAULT_ADJUST: Adjust = { brightness: 0, contrast: 0, saturation: 0, hue: 0, temperature: 0, tint: 0, vignette: 0 };
