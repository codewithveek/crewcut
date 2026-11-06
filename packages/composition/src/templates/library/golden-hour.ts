import { fadeIn, focusIn, growX, kenBurns, motion, photo, rect, riseIn, scrim, text, textAnimation } from "../kit";
import type { TemplateDefinition } from "../types";

const WARM: readonly [string, string] = ["#f2a65a", "#5b2a1c"];

/** Travel / lifestyle story: five photos in warm light, an editorial serif title, a handwritten note. */
export const goldenHour: TemplateDefinition = {
  id: "golden-hour",
  name: "Golden Hour",
  description: "A warm travel story: five photos drift in soft light, an editorial title, a handwritten note and a slow fade out.",
  category: "travel",
  tags: ["travel", "lifestyle", "summer", "vlog", "photo story", "warm", "cinematic"],
  ratios: ["9:16", "4:5", "1:1", "16:9"],
  bpm: 96,
  music: { prompt: "Warm indie acoustic guitar with soft brushed drums and a mellow bass, sunny and nostalgic, 96 BPM, instrumental", mood: "warm, nostalgic" },
  slots: [
    { id: "title", kind: "text", label: "Title", default: "Somewhere *golden*", maxLength: 28, hint: "2–3 words; wrap the key word in *stars*" },
    { id: "place", kind: "text", label: "Place and date", default: "Lisbon · Summer 2026", maxLength: 32 },
    { id: "note", kind: "text", label: "Handwritten note", default: "best day ever", maxLength: 24 },
    { id: "outro", kind: "text", label: "Closing line", default: "See you out there", maxLength: 32 },
    { id: "photo-1", kind: "photo", label: "Opening photo", default: "golden hour coastline city rooftops", tint: WARM },
    { id: "photo-2", kind: "photo", label: "Photo 2", default: "friends laughing at sunset", tint: ["#e8794a", "#2b1a24"] },
    { id: "photo-3", kind: "photo", label: "Photo 3", default: "old street tram warm light", tint: ["#d9a066", "#3a2618"] },
    { id: "photo-4", kind: "photo", label: "Polaroid photo", default: "beach picnic summer", tint: ["#f6c784", "#6b3b2a"] },
    { id: "photo-5", kind: "photo", label: "Closing photo", default: "sunset silhouette ocean", tint: ["#f08a4b", "#1c1426"] },
  ],
  brief: {
    mood: "Warm late-afternoon light, film-like and unhurried",
    palette: { background: "#1a1410", surface: "#2a2018", ink: "#fff6ea", muted: "#e9d8c2", accent: "#f2a65a", accent2: "#e8794a" },
    typePairing: { display: "Playfair Display", body: "DM Sans", mono: "Geist Mono" },
    layoutGrid: "full-bleed",
    motionSignature: "ease-glide",
    transitionSet: ["blur-crossfade", "crossfade"],
    pacing: "measured",
  },
  scenes: (k) => {
    const { ink, accent } = k.palette;
    const warmFilm = { preset: "warm" as const, intensity: 0.35 };
    const film = { contrast: 8, vignette: 28 };
    const titleSize = k.pick({ portrait: 156, square: 136, landscape: 132 });
    const counter = (id: string, index: number) =>
      text({ id, text: `0${index} / 05`, x: k.pick({ portrait: 8, landscape: 5 }), y: k.pick({ portrait: 6, landscape: 8 }), size: 26, font: "mono", weight: 500, color: "#fff6eacc", align: "left", tracking: 0.12, keyframes: fadeIn(200, 500) });
    const scene1 = k.beats(6);
    const end = k.beats(5);
    return [
      {
        name: "Opening",
        beats: 6,
        layers: [
          photo({ id: "open-photo", slot: "photo-1", src: k.photo("photo-1"), keyframes: kenBurns(scene1, "in"), filter: warmFilm, adjust: film }),
          scrim("open-scrim", "bottom", 0.66, "#140c06"),
          text({
            id: "open-place",
            slot: "place",
            text: k.text("place"),
            x: 50,
            y: k.pick({ portrait: 60, square: 58, landscape: 56 }),
            size: k.pick({ portrait: 30, landscape: 28 }),
            font: "body",
            weight: 600,
            color: "#fff6eae6",
            uppercase: true,
            tracking: 0.32,
            keyframes: riseIn(150, 30, "spring-gentle"),
          }),
          text({
            id: "open-title",
            slot: "title",
            text: k.text("title"),
            x: 50,
            y: k.pick({ portrait: 70, square: 70, landscape: 70 }),
            size: titleSize,
            font: "display",
            weight: 500,
            italic: true,
            color: ink,
            accentColor: accent,
            leading: 0.98,
            maxWidth: k.pick({ portrait: 86, landscape: 70 }),
            animation: textAnimation("mask-rise", { delayMs: 250, staggerMs: 110, durationMs: 900, easing: "spring-smooth" }),
            shadow: true,
          }),
          rect({ id: "open-rule", box: { x: 50, y: k.pick({ portrait: 81, square: 83, landscape: 84 }), w: k.pick({ portrait: 18, landscape: 10 }), h: 0.25 }, fill: accent, keyframes: growX(900, 700) }),
        ],
      },
      {
        name: "Moment 1",
        beats: 3,
        transition: { type: "blur-crossfade", durationMs: 520 },
        layers: [photo({ id: "m1-photo", slot: "photo-2", src: k.photo("photo-2"), keyframes: kenBurns(k.beats(3), "left"), filter: warmFilm, adjust: film }), counter("m1-count", 2)],
      },
      {
        name: "Moment 2",
        beats: 3,
        transition: { type: "crossfade", durationMs: 420 },
        layers: [photo({ id: "m2-photo", slot: "photo-3", src: k.photo("photo-3"), keyframes: kenBurns(k.beats(3), "out"), filter: warmFilm, adjust: film }), counter("m2-count", 3)],
      },
      {
        name: "Polaroid",
        beats: 4,
        transition: { type: "blur-crossfade", durationMs: 520 },
        background: { gradient: { kind: "radial", angle: 0, stops: [{ color: "#f4e7d3", at: 0 }, { color: "#dcc6a6", at: 1 }] } },
        layers: [
          rect({
            id: "pol-card",
            box: k.pick({ portrait: { x: 50, y: 46, w: 76, h: 50 }, square: { x: 50, y: 47, w: 60, h: 72 }, landscape: { x: 50, y: 47, w: 34, h: 74 } }),
            fill: "#fffdf8",
            radius: 6,
            keyframes: motion(riseIn(0, 120, "spring-smooth"), { rotation: [{ atMs: 0, value: -7, easing: "hold" }, { atMs: 900, value: -3, easing: "spring-smooth" }] }),
            name: "Polaroid frame",
          }),
          photo({
            id: "pol-photo",
            slot: "photo-4",
            src: k.photo("photo-4"),
            box: k.pick({ portrait: { x: 50, y: 42.5, w: 68, h: 38 }, square: { x: 50, y: 42, w: 53, h: 53 }, landscape: { x: 50, y: 41.5, w: 29.5, h: 52.5 } }),
            keyframes: motion(riseIn(0, 120, "spring-smooth"), { rotation: [{ atMs: 0, value: -7, easing: "hold" }, { atMs: 900, value: -3, easing: "spring-smooth" }] }),
            filter: { preset: "vintage", intensity: 0.45 },
          }),
          text({
            id: "pol-note",
            slot: "note",
            text: k.text("note"),
            x: 50,
            y: k.pick({ portrait: 66.5, square: 76, landscape: 76 }),
            size: k.pick({ portrait: 86, square: 64, landscape: 58 }),
            font: "Caveat",
            weight: 600,
            color: "#3a2618",
            keyframes: motion(fadeIn(650, 500), { rotation: [{ atMs: 0, value: -3, easing: "hold" }] }),
          }),
        ],
      },
      {
        name: "Closing",
        beats: 5,
        transition: { type: "crossfade", durationMs: 480 },
        layers: [
          photo({ id: "end-photo", slot: "photo-5", src: k.photo("photo-5"), keyframes: kenBurns(end, "up", 0.8), filter: warmFilm, adjust: { ...film, brightness: -8 } }),
          scrim("end-scrim", "full", 0.32, "#140c06"),
          text({ id: "end-line", slot: "outro", text: k.text("outro"), x: 50, y: 50, size: k.pick({ portrait: 104, landscape: 96 }), font: "display", weight: 500, italic: true, color: ink, maxWidth: 80, keyframes: focusIn(300, 900) }),
          rect({ id: "end-fade", box: { x: 50, y: 50, w: 100, h: 100 }, fill: "#000000", keyframes: { opacity: [{ atMs: end - 650, value: 0, easing: "hold" }, { atMs: end, value: 1, easing: "standard" }] }, name: "Fade to black" }),
        ],
      },
    ];
  },
};
