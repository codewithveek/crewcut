import { fadeIn, growX, kenBurns, motion, photo, punchIn, rect, riseIn, scaleIn, scrim, text, textAnimation } from "../kit";
import type { TemplateDefinition } from "../types";

/** Launch promo: hard cuts on the beat, giant condensed type, acid accent, price and a call to action. */
export const productDrop: TemplateDefinition = {
  id: "product-drop",
  name: "Product Drop",
  description: "A fast launch promo cut to the beat: brand flash, hero shot over giant type, lifestyle shot, price punch and a clear call to action.",
  category: "promo",
  tags: ["product", "launch", "ecommerce", "sale", "ad", "fashion", "sneakers", "bold"],
  ratios: ["9:16", "4:5", "1:1"],
  bpm: 120,
  music: { prompt: "Punchy modern electronic beat with deep 808 bass, crisp claps and a confident synth hook, energetic product launch ad, 120 BPM, instrumental", mood: "energetic, confident" },
  slots: [
    { id: "brand", kind: "text", label: "Brand", default: "NORTHWIND", maxLength: 14 },
    { id: "product", kind: "text", label: "Product name", default: "AERO RUNNER", maxLength: 16, hint: "1–2 short words, all caps reads best" },
    { id: "tagline", kind: "text", label: "Tagline", default: "Lighter than *air*.", maxLength: 28 },
    { id: "price", kind: "text", label: "Price", default: "$129", maxLength: 8 },
    { id: "offer", kind: "text", label: "Offer", default: "Launch week · free shipping", maxLength: 34 },
    { id: "cta", kind: "text", label: "Call to action", default: "Shop now", maxLength: 16 },
    { id: "photo-1", kind: "photo", label: "Product photo", default: "sneaker product photo studio colorful background", tint: ["#d4ff3a", "#2b3a0a"] },
    { id: "photo-2", kind: "photo", label: "Lifestyle photo", default: "runner street city motion", tint: ["#ff4d2e", "#1b0d0a"] },
  ],
  brief: {
    mood: "Loud launch energy: black, acid lime and hard cuts",
    palette: { background: "#0d0d0f", surface: "#17171b", ink: "#ffffff", muted: "#a1a1aa", accent: "#d4ff3a", accent2: "#ff4d2e" },
    typePairing: { display: "Anton", body: "Inter Tight", mono: "Geist Mono" },
    layoutGrid: "stacked",
    motionSignature: "staccato",
    transitionSet: ["cut", "zoom-through", "push"],
    pacing: "brisk",
  },
  scenes: (k) => {
    const { accent, accent2 } = k.palette;
    const black = "#0d0d0f";
    const giant = k.pick({ portrait: 250, square: 200, landscape: 200 });
    return [
      {
        name: "Brand flash",
        beats: 2,
        background: black,
        layers: [
          rect({ id: "flash-pill", box: { x: 50, y: 40, w: k.pick({ portrait: 30, square: 22, landscape: 18 }), h: k.pick({ portrait: 3.2, square: 4.4, landscape: 5 }) }, fill: accent, radius: 999, keyframes: scaleIn(120, 0.9) }),
          text({ id: "flash-new", text: "NEW DROP", x: 50, y: 40, size: 34, font: "body", weight: 800, color: black, tracking: 0.18, keyframes: fadeIn(200, 200) }),
          text({ id: "flash-brand", slot: "brand", text: k.text("brand"), x: 50, y: 52, size: k.pick({ portrait: 190, square: 170, landscape: 170 }), color: "#ffffff", tracking: 0.04, uppercase: true, startMs: -150, keyframes: punchIn(0, 1.3) }),
        ],
      },
      {
        name: "Hero",
        beats: 4,
        background: accent,
        transition: { type: "zoom-through", durationMs: 420 },
        layers: [
          text({
            id: "hero-name",
            slot: "product",
            text: k.text("product").split(" ").join("\n"),
            x: 50,
            y: k.pick({ portrait: 30, square: 25, landscape: 25 }),
            size: giant,
            color: black,
            leading: 0.86,
            uppercase: true,
            maxWidth: 96,
            animation: textAnimation("mask-rise", { unit: "line", staggerMs: 90, durationMs: 560, easing: "spring-snappy" }),
          }),
          photo({
            id: "hero-photo",
            slot: "photo-1",
            src: k.photo("photo-1"),
            box: k.pick({ portrait: { x: 50, y: 64, w: 78, h: 44 }, square: { x: 50, y: 69, w: 60, h: 50 }, landscape: { x: 50, y: 69, w: 60, h: 50 } }),
            radius: 36,
            shadow: true,
            keyframes: motion(riseIn(200, 160, "spring-smooth"), { rotation: [{ atMs: 200, value: -5, easing: "hold" }, { atMs: 1100, value: -1.5, easing: "spring-smooth" }] }),
          }),
        ],
      },
      {
        name: "Lifestyle",
        beats: 3,
        transition: { type: "push", durationMs: 420, direction: "up" },
        layers: [
          photo({ id: "life-photo", slot: "photo-2", src: k.photo("photo-2"), keyframes: kenBurns(k.beats(3), "right", 1.4), filter: { preset: "vivid", intensity: 0.3 }, adjust: { contrast: 12 } }),
          scrim("life-scrim", "bottom", 0.78),
          text({
            id: "life-tagline",
            slot: "tagline",
            text: k.text("tagline"),
            x: 7,
            y: k.pick({ portrait: 78, square: 76, landscape: 76 }),
            size: k.pick({ portrait: 118, square: 104, landscape: 104 }),
            font: "body",
            weight: 800,
            color: "#ffffff",
            accentColor: accent,
            align: "left",
            leading: 0.95,
            tracking: -0.04,
            maxWidth: 86,
            animation: textAnimation("fade-rise", { staggerMs: 70, durationMs: 520, easing: "spring-snappy" }),
          }),
          rect({ id: "life-bar", box: { x: 7, y: k.pick({ portrait: 88, square: 89, landscape: 89 }), w: 22, h: 0.8 }, fill: accent, originX: 0, keyframes: growX(450, 500) }),
        ],
      },
      {
        name: "Price",
        beats: 3,
        background: black,
        layers: [
          rect({ id: "price-ring", box: { x: k.pick({ portrait: 74, landscape: 72 }), y: k.pick({ portrait: 28, landscape: 26 }), w: k.pick({ portrait: 30, square: 22, landscape: 22 }), h: k.pick({ portrait: 17, square: 22, landscape: 22 }) }, fill: accent2, shape: "ellipse", keyframes: motion(scaleIn(250, 0.85, "spring-bouncy"), { rotation: [{ atMs: 0, value: -12, easing: "hold" }, { atMs: k.beats(3), value: 18, easing: "linear" }] }) }),
          text({ id: "price-new", text: "NEW", x: k.pick({ portrait: 74, landscape: 72 }), y: k.pick({ portrait: 28, landscape: 26 }), size: 64, color: "#ffffff", keyframes: motion(scaleIn(300, 0.85, "spring-bouncy"), { rotation: [{ atMs: 0, value: -12, easing: "hold" }, { atMs: k.beats(3), value: 18, easing: "linear" }] }) }),
          text({ id: "price-value", slot: "price", text: k.text("price"), x: 50, y: 50, size: k.pick({ portrait: 330, square: 280, landscape: 280 }), color: accent, keyframes: punchIn(0, 1.35) }),
          text({ id: "price-offer", slot: "offer", text: k.text("offer"), x: 50, y: k.pick({ portrait: 64, square: 70, landscape: 70 }), size: k.pick({ portrait: 50, landscape: 44 }), font: "body", weight: 600, color: "#ffffffcc", tracking: 0.02, keyframes: riseIn(350, 40, "spring-smooth") }),
        ],
      },
      {
        name: "Call to action",
        beats: 4,
        background: black,
        transition: { type: "crossfade", durationMs: 300 },
        layers: [
          photo({
            id: "cta-photo",
            slot: "photo-1",
            src: k.photo("photo-1"),
            box: k.pick({ portrait: { x: 50, y: 37, w: 86, h: 48 }, square: { x: 50, y: 38, w: 58, h: 52 }, landscape: { x: 50, y: 38, w: 58, h: 52 } }),
            radius: 36,
            keyframes: motion(scaleIn(0, 0.94, "spring-smooth"), kenBurns(k.beats(4), "in", 0.5)),
          }),
          text({ id: "cta-product", slot: "product", text: k.text("product"), x: 50, y: k.pick({ portrait: 69, square: 70, landscape: 70 }), size: k.pick({ portrait: 130, square: 92, landscape: 92 }), color: "#ffffff", uppercase: true, keyframes: riseIn(150, 50, "spring-snappy") }),
          rect({ id: "cta-button", box: { x: 50, y: k.pick({ portrait: 80, square: 82, landscape: 82 }), w: k.pick({ portrait: 52, square: 36, landscape: 36 }), h: k.pick({ portrait: 6.2, square: 8.6, landscape: 8.6 }) }, fill: accent, radius: 999, keyframes: scaleIn(400, 0.9, "spring-bouncy") }),
          text({ id: "cta-label", slot: "cta", text: k.text("cta"), x: 50, y: k.pick({ portrait: 80, square: 82, landscape: 82 }), size: k.pick({ portrait: 52, landscape: 44 }), font: "body", weight: 800, color: black, keyframes: fadeIn(480, 200) }),
          text({ id: "cta-brand", slot: "brand", text: k.text("brand"), x: 50, y: k.pick({ portrait: 91, square: 94, landscape: 94 }), size: k.pick({ portrait: 38, landscape: 30 }), color: "#ffffff99", tracking: 0.3, uppercase: true, keyframes: fadeIn(700, 400) }),
        ],
      },
    ];
  },
};

