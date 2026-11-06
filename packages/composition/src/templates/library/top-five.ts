import { fadeIn, growX, kenBurns, motion, photo, punchIn, rect, riseIn, scaleIn, text, textAnimation, wipeIn } from "../kit";
import type { TemplateDefinition, TemplateScene } from "../types";

const ITEMS = [
  { text: "They plan tomorrow *tonight*", query: "bright minimal desk open notebook pen white" },
  { text: "Phones stay out of the *bedroom*", query: "bright airy bedroom white linen morning" },
  { text: "They walk *without* headphones", query: "woman walking sunny park smiling" },
  { text: "One thing at a *time*", query: "bright kitchen hands pouring coffee" },
  { text: "They say *no* kindly", query: "two friends laughing sunny cafe" },
] as const;

/** A light editorial listicle: big numbers, photo cards that slide in on the beat, one idea per card. */
export const topFive: TemplateDefinition = {
  id: "top-five",
  name: "Top Five",
  description: "A clean, editorial list on warm paper: a bold title, then five photo cards with big numbers that slide in on the beat, and a save-for-later ending.",
  category: "listicle",
  tags: ["list", "tips", "habits", "top 5", "education", "carousel", "editorial", "light"],
  ratios: ["9:16", "4:5", "1:1", "16:9"],
  bpm: 110,
  music: { prompt: "Bright upbeat lo-fi pop with plucky guitar, soft claps and a warm bassline, friendly and focused, 110 BPM, instrumental", mood: "bright, friendly" },
  slots: [
    { id: "title", kind: "text", label: "Title", default: "5 habits of *calm* people", maxLength: 40, hint: "A list headline; wrap one word in *stars*" },
    ...ITEMS.map((item, index) => ({ id: `item-${index + 1}`, kind: "text" as const, label: `Point ${index + 1}`, default: item.text, maxLength: 40, hint: "Short and concrete; one *starred* word" })),
    { id: "outro", kind: "text", label: "Ending", default: "Save this for *later*", maxLength: 32 },
    ...ITEMS.map((item, index) => ({ id: `photo-${index + 1}`, kind: "photo" as const, label: `Photo ${index + 1}`, default: item.query, tint: (["#ffb199", "#c8553d"] as const) })),
  ],
  brief: {
    mood: "Warm paper, bold numbers, calm and clear",
    palette: { background: "#f4f1ea", surface: "#ffffff", ink: "#141414", muted: "#6b6660", accent: "#ff5a36", accent2: "#1f6feb" },
    typePairing: { display: "Bricolage Grotesque", body: "Inter Tight", mono: "Geist Mono" },
    layoutGrid: "editorial-columns",
    motionSignature: "spring-snappy",
    transitionSet: ["push"],
    pacing: "brisk",
  },
  scenes: (k) => {
    const { ink, accent, muted, background } = k.palette;
    const landscape = k.shape === "landscape";
    const item = (index: number): TemplateScene => {
      const n = index + 1;
      const photoBox = k.pick({ portrait: { x: 50, y: 33, w: 86, h: 52 }, square: { x: 50, y: 33, w: 84, h: 52 }, landscape: { x: 70, y: 50, w: 52, h: 84 } });
      return {
        name: `Point ${n}`,
        beats: 3,
        background,
        transition: { type: "push", durationMs: 380, direction: "left", easing: "spring-smooth" },
        layers: [
          photo({ id: `p${n}-photo`, slot: `photo-${n}`, src: k.photo(`photo-${n}`), box: photoBox, radius: 28, keyframes: motion(wipeIn(0, "bottom", 560), kenBurns(k.beats(3), n % 2 ? "in" : "out", 0.6)), adjust: { saturation: -8, temperature: 6 } }),
          text({
            id: `p${n}-num`,
            text: `0${n}`,
            x: landscape ? 7 : 7,
            y: k.pick({ portrait: 69, square: 70, landscape: 30 }),
            size: k.pick({ portrait: 240, square: 160, landscape: 220 }),
            font: "display",
            weight: 800,
            color: accent,
            align: "left",
            tracking: -0.06,
            keyframes: punchIn(80, 1.2),
          }),
          text({
            id: `p${n}-text`,
            slot: `item-${n}`,
            text: k.text(`item-${n}`),
            x: 7,
            y: k.pick({ portrait: 84.5, square: 86, landscape: 62 }),
            size: k.pick({ portrait: 98, square: 62, landscape: 64 }),
            font: "display",
            weight: 700,
            color: ink,
            accentColor: accent,
            align: "left",
            leading: 1.04,
            tracking: -0.03,
            maxWidth: landscape ? 38 : 86,
            animation: textAnimation("fade-rise", { delayMs: 160, staggerMs: 50, durationMs: 480, easing: "spring-snappy" }),
          }),
          text({ id: `p${n}-count`, text: `${n} / 5`, x: landscape ? 7 : 93, y: k.pick({ portrait: 4.5, square: 6, landscape: 8 }), size: 26, font: "mono", weight: 500, color: muted, align: landscape ? "left" : "right", keyframes: fadeIn(200, 300) }),
        ],
      };
    };
    return [
      {
        name: "Title",
        beats: 4,
        background,
        layers: [
          text({ id: "t-five", text: "5", x: k.pick({ portrait: 72, landscape: 78 }), y: k.pick({ portrait: 30, square: 36, landscape: 46 }), size: k.pick({ portrait: 600, square: 560, landscape: 600 }), font: "display", weight: 800, color: accent, tracking: -0.08, keyframes: motion(scaleIn(0, 0.9, "spring-smooth"), { rotation: [{ atMs: 0, value: 8, easing: "hold" }, { atMs: 900, value: 4, easing: "spring-smooth" }] }), startMs: -200 }),
          rect({ id: "t-pill", box: { x: 7 + k.pick({ portrait: 11, landscape: 6 }), y: k.pick({ portrait: 56, square: 56, landscape: 30 }), w: k.pick({ portrait: 22, square: 18, landscape: 12 }), h: k.pick({ portrait: 2.8, square: 4.2, landscape: 6.4 }) }, fill: ink, radius: 999, keyframes: scaleIn(150, 0.9) }),
          text({ id: "t-label", text: "THE LIST", x: 7 + k.pick({ portrait: 11, landscape: 6 }), y: k.pick({ portrait: 56, square: 56, landscape: 30 }), size: 28, font: "body", weight: 700, color: background, tracking: 0.2, keyframes: fadeIn(220, 200) }),
          text({
            id: "t-title",
            slot: "title",
            text: k.text("title"),
            x: 7,
            y: k.pick({ portrait: 70, square: 72, landscape: 56 }),
            size: k.pick({ portrait: 132, square: 108, landscape: 120 }),
            font: "display",
            weight: 800,
            color: ink,
            accentColor: accent,
            align: "left",
            leading: 0.96,
            tracking: -0.045,
            maxWidth: landscape ? 52 : 86,
            anchorY: k.shape === "landscape" ? 0.2 : 0.5,
            animation: textAnimation("mask-rise", { delayMs: 200, staggerMs: 80, durationMs: 640, easing: "spring-snappy" }),
          }),
        ],
      },
      ...[0, 1, 2, 3, 4].map(item),
      {
        name: "Ending",
        beats: 4,
        background: ink,
        transition: { type: "push", durationMs: 380, direction: "up", easing: "spring-smooth" },
        layers: [
          text({ id: "e-line", slot: "outro", text: k.text("outro"), x: 50, y: 46, size: k.pick({ portrait: 120, square: 104, landscape: 110 }), font: "display", weight: 800, color: background, accentColor: accent, leading: 0.98, tracking: -0.04, maxWidth: 82, animation: textAnimation("mask-rise", { staggerMs: 90, durationMs: 620, easing: "spring-snappy" }) }),
          rect({ id: "e-bar", box: { x: 50, y: k.pick({ portrait: 58, square: 62, landscape: 64 }), w: 14, h: 0.6 }, fill: accent, keyframes: growX(500, 520) }),
          text({ id: "e-hint", text: "Share it with someone who needs it", x: 50, y: k.pick({ portrait: 64, square: 69, landscape: 72 }), size: k.pick({ portrait: 46, landscape: 36 }), font: "body", weight: 500, color: "#f4f1eab3", keyframes: riseIn(650, 24, "spring-smooth") }),
        ],
      },
    ];
  },
};
