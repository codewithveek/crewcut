/**
 * Self-hosted font library (never fetched at render time). The art direction
 * brief picks a pairing; text layers reference a role or a family.
 */
export const FONT_FAMILIES = [
  "Inter",
  "Inter Tight",
  "Geist",
  "Space Grotesk",
  "Plus Jakarta Sans",
  "DM Sans",
  "Fraunces",
  "Instrument Serif",
  // Display faces for templates: condensed impact, expressive grotesque, editorial serif, art/fashion, handwritten.
  "Anton",
  "Bricolage Grotesque",
  "Playfair Display",
  "Syne",
  "Caveat",
  "Geist Mono",
  "JetBrains Mono",
] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

export const FONT_ROLES = ["display", "body", "mono"] as const;
export type FontRole = (typeof FONT_ROLES)[number];

export const MONO_FAMILIES: ReadonlySet<FontFamily> = new Set(["Geist Mono", "JetBrains Mono"]);
export const SERIF_FAMILIES: ReadonlySet<FontFamily> = new Set(["Fraunces", "Instrument Serif", "Playfair Display"]);

/** Families whose files only ship one weight; the renderer must not fake bold. */
export const STATIC_WEIGHT_FAMILIES: Readonly<Partial<Record<FontFamily, number>>> = {
  "Instrument Serif": 400,
  Anton: 400,
};

export interface TypePairing {
  display: FontFamily;
  body: FontFamily;
  mono: FontFamily;
}

export function resolveFontFamily(font: FontRole | FontFamily, pairing: TypePairing): FontFamily {
  if (font === "display" || font === "body" || font === "mono") return pairing[font];
  return font;
}

export function cssFontStack(family: FontFamily): string {
  if (MONO_FAMILIES.has(family)) return `"${family}", ui-monospace, monospace`;
  if (SERIF_FAMILIES.has(family)) return `"${family}", ui-serif, Georgia, serif`;
  return `"${family}", ui-sans-serif, system-ui, sans-serif`;
}
