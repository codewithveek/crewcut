import dmSans from "@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2";
import fraunces from "@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2";
import geistMono from "@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2";
import geist from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2";
import interTight from "@fontsource-variable/inter-tight/files/inter-tight-latin-wght-normal.woff2";
import inter from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2";
import jetbrainsMono from "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2";
import plusJakartaSans from "@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2";
import spaceGrotesk from "@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2";
import instrumentSerif from "@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2";
import anton from "@fontsource/anton/files/anton-latin-400-normal.woff2";
import bricolage from "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2";
import playfair from "@fontsource-variable/playfair-display/files/playfair-display-latin-wght-normal.woff2";
import syne from "@fontsource-variable/syne/files/syne-latin-wght-normal.woff2";
import caveat from "@fontsource-variable/caveat/files/caveat-latin-wght-normal.woff2";
import type { FontFamily } from "@crewcut/composition";
import { loadFont } from "@remotion/fonts";

/**
 * Self-hosted fonts, bundled as assets by both Vite (player) and Remotion's
 * webpack (render). Never fetched from Google Fonts at render time.
 */
const FONT_FILES: Record<FontFamily, { url: string; weight: string }> = {
  Inter: { url: inter, weight: "100 900" },
  "Inter Tight": { url: interTight, weight: "100 900" },
  Geist: { url: geist, weight: "100 900" },
  "Space Grotesk": { url: spaceGrotesk, weight: "300 700" },
  "Plus Jakarta Sans": { url: plusJakartaSans, weight: "200 800" },
  "DM Sans": { url: dmSans, weight: "100 1000" },
  Fraunces: { url: fraunces, weight: "100 900" },
  "Instrument Serif": { url: instrumentSerif, weight: "400" },
  Anton: { url: anton, weight: "400" },
  "Bricolage Grotesque": { url: bricolage, weight: "200 800" },
  "Playfair Display": { url: playfair, weight: "400 900" },
  Syne: { url: syne, weight: "400 800" },
  Caveat: { url: caveat, weight: "400 700" },
  "Geist Mono": { url: geistMono, weight: "100 900" },
  "JetBrains Mono": { url: jetbrainsMono, weight: "100 800" },
};

let fontsPromise: Promise<void> | null = null;

/** Loads every family once (each loadFont holds the render until it's ready). */
export function loadCrewcutFonts(): Promise<void> {
  if (!fontsPromise) {
    fontsPromise = Promise.all(
      Object.entries(FONT_FILES).map(([family, file]) =>
        loadFont({ family, url: file.url, weight: file.weight, style: "normal", display: "block", format: "woff2" }),
      ),
    ).then(() => undefined);
  }
  return fontsPromise;
}
