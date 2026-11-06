import { fadeIn, growX, kenBurns, motion, photo, rect, riseIn, scaleIn, scrim, text, textAnimation } from "../kit";
import type { TemplateDefinition } from "../types";

/** One quote, revealed word by word over a slow, darkened photo; the key words light up. */
export const kineticQuote: TemplateDefinition = {
  id: "kinetic-quote",
  name: "Kinetic Quote",
  description: "A quote revealed word by word in an editorial serif over a slow, darkened photo, with the key words in gold and the author signing off.",
  category: "quote",
  tags: ["quote", "motivation", "inspiration", "typography", "thought leadership", "minimal"],
  ratios: ["9:16", "4:5", "1:1", "16:9"],
  bpm: 84,
  music: { prompt: "Calm cinematic piano with warm ambient pads and a soft pulse, reflective and hopeful, 84 BPM, instrumental", mood: "reflective, hopeful" },
  slots: [
    { id: "quote", kind: "text", label: "Quote", default: "The best way to predict the future is to *create it*.", maxLength: 120, hint: "One sentence; wrap the 1–3 most important words in *stars*" },
    { id: "author", kind: "text", label: "Author", default: "Peter Drucker", maxLength: 32 },
    { id: "role", kind: "text", label: "Who they are", default: "Management thinker", maxLength: 36 },
    { id: "photo-1", kind: "photo", label: "Background photo", default: "moody mountain landscape fog dawn", tint: ["#3a4a5c", "#0b0f14"] },
  ],
  brief: {
    mood: "Quiet, editorial and confident",
    palette: { background: "#0e1216", surface: "#1a2026", ink: "#f5f1e8", muted: "#c9c3b6", accent: "#ffcf5c", accent2: "#f0a53b" },
    typePairing: { display: "Fraunces", body: "Inter Tight", mono: "Geist Mono" },
    layoutGrid: "centered",
    motionSignature: "spring-soft",
    transitionSet: ["crossfade"],
    pacing: "slow",
  },
  scenes: (k) => {
    const { ink, accent, muted } = k.palette;
    const total = k.beats(14);
    const words = k.text("quote").split(/\s+/).length;
    // The author signs once the last word has landed (plus a breath).
    const authorAt = Math.min(total - 2200, 700 + words * 140 + 900);
    const left = k.shape === "landscape";
    return [
      {
        name: "Quote",
        beats: 14,
        layers: [
          photo({ id: "q-photo", slot: "photo-1", src: k.photo("photo-1"), keyframes: kenBurns(total, "in", 0.9), filter: { preset: "noir", intensity: 0.5 }, adjust: { brightness: -12, vignette: 40 } }),
          scrim("q-scrim", left ? "left" : "full", left ? 0.85 : 0.5, "#0b0f14"),
          text({
            id: "q-mark",
            text: "“",
            x: left ? 8 : 50,
            y: k.pick({ portrait: 24, square: 20, landscape: 20 }),
            size: k.pick({ portrait: 300, landscape: 260 }),
            font: "display",
            weight: 600,
            color: accent,
            align: left ? "left" : "center",
            keyframes: scaleIn(0, 0.88, "spring-smooth"),
          }),
          text({
            id: "q-text",
            slot: "quote",
            text: k.text("quote"),
            x: left ? 8 : 50,
            y: k.pick({ portrait: 45, square: 48, landscape: 50 }),
            size: k.pick({ portrait: 124, square: 88, landscape: 80 }),
            font: "display",
            weight: 500,
            color: ink,
            accentColor: accent,
            align: left ? "left" : "center",
            leading: 1.12,
            maxWidth: k.pick({ portrait: 84, square: 82, landscape: 58 }),
            animation: textAnimation("fade-rise", { staggerMs: 140, durationMs: 700, delayMs: 500, easing: "spring-gentle" }),
            shadow: true,
          }),
          rect({ id: "q-rule", box: { x: left ? 8 : 50, y: k.pick({ portrait: 68, square: 76, landscape: 76 }), w: 8, h: 0.3 }, fill: accent, originX: left ? 0 : 0.5, startMs: authorAt, keyframes: growX(0, 600) }),
          text({ id: "q-author", slot: "author", text: k.text("author"), x: left ? 8 : 50, y: k.pick({ portrait: 72, square: 81, landscape: 81 }), size: k.pick({ portrait: 54, landscape: 46 }), font: "body", weight: 700, color: ink, uppercase: true, tracking: 0.16, align: left ? "left" : "center", startMs: authorAt, keyframes: riseIn(150, 30, "spring-smooth") }),
          text({ id: "q-role", slot: "role", text: k.text("role"), x: left ? 8 : 50, y: k.pick({ portrait: 76, square: 86, landscape: 86 }), size: k.pick({ portrait: 38, landscape: 32 }), font: "body", weight: 500, color: muted, align: left ? "left" : "center", startMs: authorAt, keyframes: fadeIn(450, 500) }),
          rect({ id: "q-fade", box: { x: 50, y: 50, w: 100, h: 100 }, fill: "#000000", keyframes: motion({ opacity: [{ atMs: total - 700, value: 0, easing: "hold" }, { atMs: total, value: 1, easing: "standard" }] }), name: "Fade to black" }),
        ],
      },
    ];
  },
};
