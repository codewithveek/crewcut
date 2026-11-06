import { fadeIn, growX, motion, photo, rect, riseIn, scaleIn, text, textAnimation, wipeIn } from "../kit";
import type { TemplateDefinition } from "../types";

/** Logo intro: shapes assemble, the logo lands, the name and tagline resolve, the address signs off. */
export const brandReveal: TemplateDefinition = {
  id: "brand-reveal",
  name: "Brand Reveal",
  description: "A clean logo intro: geometric shapes assemble into a stage, your logo lands with a soft glow, the name rises letter by letter and the tagline and web address sign off.",
  category: "brand",
  tags: ["logo", "intro", "outro", "brand", "startup", "agency", "minimal", "corporate"],
  ratios: ["16:9", "1:1", "9:16", "4:5"],
  bpm: 100,
  music: { prompt: "Modern minimal corporate intro, airy synth pad swell, crisp percussive hits and a confident resolving chord, sleek and premium, 100 BPM, instrumental", mood: "sleek, confident" },
  slots: [
    { id: "logo", kind: "photo", label: "Logo", default: "L", logo: true, hint: "A transparent PNG or SVG works best" },
    { id: "name", kind: "text", label: "Brand name", default: "LUMEN", maxLength: 14 },
    { id: "tagline", kind: "text", label: "Tagline", default: "Light for the way you *work*", maxLength: 40 },
    { id: "url", kind: "text", label: "Web address", default: "lumen.studio", maxLength: 28 },
  ],
  brief: {
    mood: "Sleek, quiet confidence: deep ink and electric blue",
    palette: { background: "#0f1115", surface: "#181b22", ink: "#f5f5f2", muted: "#9aa3b2", accent: "#4f7cff", accent2: "#8fe3ff" },
    typePairing: { display: "Geist", body: "Inter", mono: "Geist Mono" },
    layoutGrid: "centered",
    motionSignature: "spring-soft",
    transitionSet: ["blur-crossfade"],
    pacing: "measured",
  },
  scenes: (k) => {
    const { ink, accent, accent2, muted, background } = k.palette;
    const unit = k.pick({ portrait: 46, square: 40, landscape: 26 });
    const ringH = (unit * k.width) / k.height;
    const total = k.beats(10);
    return [
      {
        name: "Reveal",
        beats: 10,
        background: { gradient: { kind: "radial", angle: 0, stops: [{ color: "#1b2233", at: 0 }, { color: background, at: 1 }] } },
        layers: [
          // Stage: a ring and two bars build the frame the logo lands in.
          rect({ id: "r-ring", box: { x: 50, y: 40, w: unit, h: ringH }, fill: "#00000000", shape: "ring", stroke: accent, strokeWidth: 6, keyframes: motion(scaleIn(0, 0.88, "spring-smooth"), { rotation: [{ atMs: 0, value: -40, easing: "hold" }, { atMs: 1100, value: 0, easing: "spring-smooth" }] }), startMs: -150 }),
          rect({ id: "r-bar-l", box: { x: 50 - unit * 0.75, y: 40, w: unit * 0.4, h: 0.35 }, fill: accent2, originX: 1, keyframes: growX(350, 520) }),
          rect({ id: "r-bar-r", box: { x: 50 + unit * 0.75, y: 40, w: unit * 0.4, h: 0.35 }, fill: accent2, originX: 0, keyframes: growX(350, 520) }),
          rect({ id: "r-glow", box: { x: 50, y: 40, w: unit * 1.8, h: ringH * 1.8 }, shape: "ellipse", fill: { gradient: { kind: "radial", angle: 0, stops: [{ color: `${accent}66`, at: 0 }, { color: `${accent}00`, at: 1 }] } }, keyframes: fadeIn(600, 700) }),
          photo({ id: "r-logo", slot: "logo", src: k.photo("logo"), fit: "contain", box: { x: 50, y: 40, w: unit * 0.62, h: ringH * 0.62 }, keyframes: motion(scaleIn(650, 0.86, "spring-bouncy"), { blur: [{ atMs: 650, value: 10, easing: "hold" }, { atMs: 1050, value: 0, easing: "entrance" }] }) }),
          text({ id: "r-name", slot: "name", text: k.text("name"), x: 50, y: k.pick({ portrait: 62, square: 66, landscape: 68 }), size: k.pick({ portrait: 150, square: 130, landscape: 120 }), font: "display", weight: 700, color: ink, tracking: 0.12, startMs: k.beats(2), animation: textAnimation("mask-rise", { unit: "char", staggerMs: 45, durationMs: 560, easing: "spring-smooth" }) }),
          text({ id: "r-tagline", slot: "tagline", text: k.text("tagline"), x: 50, y: k.pick({ portrait: 70, square: 76, landscape: 79 }), size: k.pick({ portrait: 52, landscape: 44 }), font: "body", weight: 400, color: muted, accentColor: accent2, maxWidth: 80, startMs: k.beats(3.5), keyframes: riseIn(0, 24, "spring-smooth") }),
          rect({ id: "r-rule", box: { x: 50, y: k.pick({ portrait: 82, square: 86, landscape: 88 }), w: k.pick({ portrait: 30, landscape: 14 }), h: 0.2 }, fill: "#ffffff26", startMs: k.beats(5.5), keyframes: growX(0, 600) }),
          text({ id: "r-url", slot: "url", text: k.text("url"), x: 50, y: k.pick({ portrait: 86, square: 91, landscape: 93 }), size: 30, font: "mono", weight: 500, color: ink, tracking: 0.08, startMs: k.beats(5.5), keyframes: motion(fadeIn(150, 500), wipeIn(150, "left", 700)) }),
          rect({ id: "r-out", box: { x: 50, y: 50, w: 100, h: 100 }, fill: background, keyframes: { opacity: [{ atMs: total - 700, value: 0, easing: "hold" }, { atMs: total, value: 1, easing: "standard" }] }, name: "Fade out" }),
        ],
      },
    ];
  },
};
