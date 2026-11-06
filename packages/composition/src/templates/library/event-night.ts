import { fadeIn, growX, kenBurns, motion, photo, punchIn, rect, riseIn, scaleIn, scrim, slideIn, text, textAnimation } from "../kit";
import type { TemplateDefinition } from "../types";

/** Night-event promo: neon duotone photos, letter-by-letter title, date punch, lineup, tickets. */
export const eventNight: TemplateDefinition = {
  id: "event-night",
  name: "Event Night",
  description: "A neon promo for a party, gig or launch night: the name blurs in letter by letter, a colour-washed crowd shot carries the date, the lineup slides in and the ticket link pulses at the end.",
  category: "event",
  tags: ["event", "party", "concert", "club", "festival", "nightlife", "dj", "neon", "tickets"],
  ratios: ["9:16", "4:5", "1:1", "16:9"],
  bpm: 124,
  music: { prompt: "Driving deep house groove with a punchy four-on-the-floor kick, shimmering synth stabs and a rising build, club night energy, 124 BPM, instrumental", mood: "electric, nocturnal" },
  slots: [
    { id: "event", kind: "text", label: "Event name", default: "NEON GARDEN", maxLength: 18, hint: "1–2 words, all caps" },
    { id: "date", kind: "text", label: "Date", default: "SAT 14 DEC", maxLength: 14 },
    { id: "time", kind: "text", label: "Time", default: "10PM – LATE", maxLength: 16 },
    { id: "lineup", kind: "text", label: "Line-up", default: "DJ Tems\nKayla B\nOso Live", maxLength: 60, hint: "One act per line (up to 4 lines)" },
    { id: "venue", kind: "text", label: "Venue", default: "The Warehouse, Lagos", maxLength: 32 },
    { id: "cta", kind: "text", label: "Tickets", default: "Tickets · neongarden.co", maxLength: 30 },
    { id: "photo-1", kind: "photo", label: "Crowd photo", default: "concert crowd hands up neon lights", tint: ["#7c4dff", "#ff3d8b"] },
    { id: "photo-2", kind: "photo", label: "Performer photo", default: "dj performing club lights", tint: ["#ff3d8b", "#1a0b2e"] },
  ],
  brief: {
    mood: "Neon after dark: violet, hot pink, heavy kick",
    palette: { background: "#0b0614", surface: "#1a1030", ink: "#ffffff", muted: "#b9a8d9", accent: "#ff3d8b", accent2: "#7c4dff" },
    typePairing: { display: "Syne", body: "Space Grotesk", mono: "Geist Mono" },
    layoutGrid: "full-bleed",
    motionSignature: "kinetic",
    transitionSet: ["zoom-through", "cut"],
    pacing: "brisk",
  },
  scenes: (k) => {
    const { accent, accent2, muted } = k.palette;
    const night = "#0b0614";
    const landscape = k.shape === "landscape";
    // Duotone wash: the photo in black and white under a violet→pink gradient in colour blend.
    const wash = (id: string) => rect({ id, box: { x: 50, y: 50, w: 100, h: 100 }, fill: { gradient: { kind: "linear", angle: 160, stops: [{ color: `${accent2}d9`, at: 0 }, { color: `${accent}b3`, at: 1 }] } }, blend: "soft-light", name: "Neon wash" });
    return [
      {
        name: "Name",
        beats: 2,
        background: night,
        layers: [
          rect({ id: "n-glow", box: { x: 50, y: 50, w: 90, h: k.pick({ portrait: 40, landscape: 70 }) }, fill: { gradient: { kind: "radial", angle: 0, stops: [{ color: `${accent}59`, at: 0 }, { color: `${accent}00`, at: 1 }] } }, keyframes: fadeIn(0, 500), startMs: -200 }),
          text({ id: "n-name", slot: "event", text: k.text("event"), x: 50, y: 50, size: k.pick({ portrait: 116, square: 120, landscape: 170 }), font: "display", weight: 800, color: "#ffffff", leading: 0.92, maxWidth: 90, startMs: -250, animation: textAnimation("blur-in", { unit: "char", staggerMs: 30, durationMs: 420, easing: "entrance" }) }),
        ],
      },
      {
        name: "Date",
        beats: 5,
        transition: { type: "zoom-through", durationMs: 380 },
        layers: [
          photo({ id: "d-photo", slot: "photo-1", src: k.photo("photo-1"), keyframes: kenBurns(k.beats(5), "in", 1.3), filter: { preset: "mono", intensity: 1 }, adjust: { contrast: 25, brightness: -10 } }),
          wash("d-wash"),
          scrim("d-scrim", landscape ? "left" : "bottom", 0.82, night),
          text({ id: "d-date", slot: "date", text: k.text("date"), x: 7, y: k.pick({ portrait: 70, square: 66, landscape: 58 }), size: k.pick({ portrait: 168, square: 140, landscape: 150 }), font: "display", weight: 800, color: "#ffffff", align: "left", leading: 0.9, maxWidth: landscape ? 60 : 88, keyframes: punchIn(0, 1.18) }),
          rect({ id: "d-bar", box: { x: 7, y: k.pick({ portrait: 79, square: 77, landscape: 71 }), w: k.pick({ portrait: 30, landscape: 18 }), h: 0.7 }, fill: accent, originX: 0, keyframes: growX(300, 420) }),
          text({ id: "d-time", slot: "time", text: k.text("time"), x: 7, y: k.pick({ portrait: 84, square: 83, landscape: 78 }), size: k.pick({ portrait: 58, landscape: 50 }), font: "body", weight: 700, color: "#ffffff", align: "left", tracking: 0.08, keyframes: slideIn(420, "left", 60, "spring-snappy") }),
        ],
      },
      {
        name: "Line-up",
        beats: 5,
        transition: { type: "zoom-through", durationMs: 380 },
        layers: [
          photo({ id: "l-photo", slot: "photo-2", src: k.photo("photo-2"), box: landscape ? { x: 72, y: 50, w: 56, h: 100 } : { x: 50, y: 50, w: 100, h: 100 }, keyframes: kenBurns(k.beats(5), "left", 1.2), filter: { preset: "mono", intensity: 1 }, adjust: { contrast: 20, brightness: landscape ? 0 : -25 } }),
          wash("l-wash"),
          ...(landscape ? [rect({ id: "l-panel", box: { x: 22, y: 50, w: 44, h: 100 }, fill: night, name: "Panel" })] : [scrim("l-scrim", "full", 0.45, night)]),
          text({ id: "l-label", text: "LINE-UP", x: landscape ? 6 : 50, y: k.pick({ portrait: 30, square: 24, landscape: 26 }), size: 34, font: "body", weight: 700, color: accent, align: landscape ? "left" : "center", tracking: 0.3, keyframes: fadeIn(0, 300) }),
          text({
            id: "l-acts",
            slot: "lineup",
            text: k.text("lineup"),
            x: landscape ? 6 : 50,
            y: k.pick({ portrait: 50, square: 52, landscape: 54 }),
            size: k.pick({ portrait: 104, square: 88, landscape: 80 }),
            font: "display",
            weight: 800,
            color: "#ffffff",
            align: landscape ? "left" : "center",
            leading: 1.02,
            maxWidth: landscape ? 38 : 88,
            animation: textAnimation("fade-rise", { unit: "line", delayMs: 150, staggerMs: 140, durationMs: 520, easing: "spring-snappy" }),
          }),
        ],
      },
      {
        name: "Tickets",
        beats: 6,
        transition: { type: "cut", durationMs: 0 },
        background: { gradient: { kind: "linear", angle: 155, stops: [{ color: "#1a0b2e", at: 0 }, { color: "#3a0d3d", at: 0.6 }, { color: "#6b1048", at: 1 }] } },
        layers: [
          text({ id: "t-name", slot: "event", text: k.text("event"), x: 50, y: k.pick({ portrait: 36, square: 32, landscape: 32 }), size: k.pick({ portrait: 110, square: 104, landscape: 120 }), font: "display", weight: 800, color: "#ffffff", leading: 0.92, maxWidth: 90, keyframes: scaleIn(0, 0.92, "spring-smooth") }),
          text({ id: "t-venue", slot: "venue", text: k.text("venue"), x: 50, y: k.pick({ portrait: 50, square: 52, landscape: 54 }), size: k.pick({ portrait: 48, landscape: 42 }), font: "body", weight: 600, color: muted, keyframes: riseIn(250, 30, "spring-smooth") }),
          rect({ id: "t-pill", box: { x: 50, y: k.pick({ portrait: 64, square: 70, landscape: 72 }), w: k.pick({ portrait: 74, square: 62, landscape: 40 }), h: k.pick({ portrait: 6.4, square: 9, landscape: 11 }) }, fill: accent, radius: 999, keyframes: scaleIn(450, 0.9, "spring-bouncy"), ambient: { kind: "pulse", amplitude: 0.04, periodMs: Math.round(k.beats(2)) } }),
          text({ id: "t-cta", slot: "cta", text: k.text("cta"), x: 50, y: k.pick({ portrait: 64, square: 70, landscape: 72 }), size: k.pick({ portrait: 46, landscape: 40 }), font: "body", weight: 700, color: "#ffffff", keyframes: fadeIn(560, 220) }),
          text({ id: "t-date", text: `${k.text("date")} · ${k.text("time")}`, x: 50, y: k.pick({ portrait: 76, square: 84, landscape: 86 }), size: 34, font: "mono", weight: 500, color: "#ffffffb3", tracking: 0.06, keyframes: fadeIn(750, 400) }),
        ],
      },
    ];
  },
};
