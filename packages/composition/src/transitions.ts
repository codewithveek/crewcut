import type { Transition, TransitionType } from "./schema";

/**
 * The transition catalogue: what each type is called, which group it sits in,
 * its natural length and which directions it understands. The renderer
 * (`@crewcut/renderer` → transitions/) draws them; this file is plain data so
 * the editor, the agent and the composer all agree on names and defaults.
 */

export const TRANSITION_GROUPS = ["basic", "zoom", "spin", "motion", "glitch", "light", "shapes"] as const;
export type TransitionGroup = (typeof TRANSITION_GROUPS)[number];

export const TRANSITION_GROUP_LABELS: Record<TransitionGroup, string> = {
  basic: "Basic",
  zoom: "Zoom",
  spin: "Spin",
  motion: "Motion",
  glitch: "Glitch",
  light: "Light",
  shapes: "Shapes",
};

export type TransitionDirection = Transition["direction"];

const ALL: readonly TransitionDirection[] = ["left", "right", "up", "down"];
const SIDEWAYS: readonly TransitionDirection[] = ["left", "right"];
const NONE: readonly TransitionDirection[] = [];

export interface TransitionInfo {
  label: string;
  group: TransitionGroup;
  /** One line for menus and the agent. */
  description: string;
  durationMs: number;
  /** Directions the type reads; empty when it has none. left/right on spins mean anticlockwise/clockwise. */
  directions: readonly TransitionDirection[];
  /** Where an editor thumbnail rests (raw progress 0..1) so the effect is visible. */
  stillAt: number;
  /** Bounce types run their own spring and ignore `easing`. */
  ownTiming?: boolean;
}

export const TRANSITION_CATALOG: Record<TransitionType, TransitionInfo> = {
  cut: { label: "Cut", group: "basic", description: "A hard cut.", durationMs: 0, directions: NONE, stillAt: 0.5 },
  crossfade: { label: "Crossfade", group: "basic", description: "Fades one clip into the next.", durationMs: 400, directions: NONE, stillAt: 0.42 },
  "blur-crossfade": { label: "Crossfade with blur", group: "basic", description: "A crossfade softened with blur.", durationMs: 500, directions: NONE, stillAt: 0.42 },
  push: { label: "Push", group: "basic", description: "The next clip pushes the last one out, with motion blur.", durationMs: 560, directions: ALL, stillAt: 0.45 },
  slide: { label: "Slide", group: "basic", description: "The next clip slides over the last one.", durationMs: 560, directions: ALL, stillAt: 0.45 },
  "zoom-through": { label: "Zoom through", group: "basic", description: "Flies through the last clip into the next.", durationMs: 600, directions: NONE, stillAt: 0.38 },
  wipe: { label: "Wipe", group: "basic", description: "A straight-edged wipe.", durationMs: 520, directions: ALL, stillAt: 0.5 },
  "scale-fade": { label: "Scale fade", group: "basic", description: "Fades in while settling from slightly small.", durationMs: 480, directions: NONE, stillAt: 0.35 },

  "zoom-in": { label: "Zoom in", group: "zoom", description: "Inward zoom between clips with blurred edges.", durationMs: 650, directions: NONE, stillAt: 0.42 },
  "zoom-out": { label: "Reverse zoom", group: "zoom", description: "Outward zoom between clips with blurred edges.", durationMs: 650, directions: NONE, stillAt: 0.42 },
  "zoom-in-out": { label: "In and out zoom", group: "zoom", description: "Pushes in a little, then pulls back onto the next clip.", durationMs: 700, directions: NONE, stillAt: 0.6 },
  "zoom-bounce": { label: "Zoom bounce", group: "zoom", description: "Zooms in hard and lands the next clip with a bounce.", durationMs: 750, directions: NONE, stillAt: 0.55, ownTiming: true },
  "zoom-out-bounce": { label: "Outwards zoom", group: "zoom", description: "Zooms out and lands the next clip with a bounce.", durationMs: 750, directions: NONE, stillAt: 0.3, ownTiming: true },
  "bounce-zoom": { label: "Bouncing zoom", group: "zoom", description: "A soft bounce between clips that zooms in slightly.", durationMs: 650, directions: NONE, stillAt: 0.3, ownTiming: true },
  "zoom-burn": { label: "Zoom burn", group: "zoom", description: "A sharp zoom through a burst of film burn.", durationMs: 700, directions: NONE, stillAt: 0.42 },
  "zoom-spin": { label: "Zoom and spin", group: "zoom", description: "Zooms in while the frame spins.", durationMs: 700, directions: SIDEWAYS, stillAt: 0.4 },
  "zoom-distort": { label: "Distort and zoom", group: "zoom", description: "Zooms while the picture warps.", durationMs: 650, directions: NONE, stillAt: 0.42 },
  "countdown-zoom": { label: "Countdown zoom", group: "zoom", description: "Ticks like a countdown: the frame jumps closer in three hard, held steps, cuts at peak blur, and steps back out in two. No tweening.", durationMs: 240, directions: NONE, stillAt: 0.4, ownTiming: true },

  spin: { label: "Spin", group: "spin", description: "A full blurred spin into the next clip.", durationMs: 700, directions: SIDEWAYS, stillAt: 0.4 },
  twist: { label: "Twist", group: "spin", description: "A warped quarter twist.", durationMs: 650, directions: SIDEWAYS, stillAt: 0.42 },
  "double-twist": { label: "Double twist", group: "spin", description: "Twists one way, then snaps back the other.", durationMs: 750, directions: SIDEWAYS, stillAt: 0.42 },
  "spin-twist": { label: "Spin and twist", group: "spin", description: "The frame turns in depth while it spins, with a light blur.", durationMs: 800, directions: SIDEWAYS, stillAt: 0.4 },
  "spin-up": { label: "Upwards spin", group: "spin", description: "Scrolls up with a tilt and a warp.", durationMs: 650, directions: SIDEWAYS, stillAt: 0.45 },
  "spin-3d": { label: "3D spin", group: "spin", description: "Tips the frame back and spins it up into the next clip.", durationMs: 800, directions: SIDEWAYS, stillAt: 0.4 },
  "twist-burn": { label: "Twist burn", group: "spin", description: "A turn to the right through bright film burn.", durationMs: 750, directions: SIDEWAYS, stillAt: 0.4 },

  swipe: { label: "Swipe", group: "motion", description: "A fast motion-blurred swipe that bumps at the edge.", durationMs: 600, directions: ALL, stillAt: 0.3, ownTiming: true },
  "zoom-swipe": { label: "Sideways zoom", group: "motion", description: "Scrolls across while pulling back slightly.", durationMs: 650, directions: ALL, stillAt: 0.45 },
  "motion-scroll": { label: "Motion scroll", group: "motion", description: "A blurred scroll with a wave of distortion.", durationMs: 600, directions: ALL, stillAt: 0.45 },
  "distort-slide": { label: "Distort sideways", group: "motion", description: "Scrolls across with stretched, warped edges.", durationMs: 650, directions: ALL, stillAt: 0.45 },
  "quick-distort": { label: "Quick distort", group: "motion", description: "A quick, glitchy scroll with colour fringing.", durationMs: 400, directions: ALL, stillAt: 0.45 },
  "bounce-in": { label: "Bounce in", group: "motion", description: "The next clip springs in from the side with a bounce.", durationMs: 650, directions: ALL, stillAt: 0.3, ownTiming: true },
  fracture: { label: "Fracture", group: "motion", description: "A quick move that splits the frame into staggered bands.", durationMs: 500, directions: ALL, stillAt: 0.45 },
  "split-bounce": { label: "Split and bounce", group: "motion", description: "Panels of the next clip drop in and bounce.", durationMs: 850, directions: ["down", "up"], stillAt: 0.35, ownTiming: true },
  "frame-split": { label: "Frame split", group: "motion", description: "Three panels slide in from opposite directions.", durationMs: 750, directions: NONE, stillAt: 0.45 },
  "step-scroll": { label: "Step scroll", group: "motion", description: "Scrolls a stack by one card on one smooth spring: the card moving up into the stack shrinks and dims as it goes; stepping back, it grows as it returns. Moves by the card's own height for elements.", durationMs: 550, directions: ["up", "down"], stillAt: 0.3, ownTiming: true },
  "falling-boxes": { label: "Falling boxes", group: "motion", description: "The next clip falls into place as a grid of boxes.", durationMs: 1000, directions: NONE, stillAt: 0.4, ownTiming: true },

  static: { label: "Static", group: "glitch", description: "A short burst of digital static.", durationMs: 450, directions: NONE, stillAt: 0.45 },
  "digital-static": { label: "Digital static", group: "glitch", description: "Heavy digital distortion that tears the picture.", durationMs: 600, directions: NONE, stillAt: 0.42 },
  "retro-interference": { label: "Retro interference", group: "glitch", description: "Dark tape interference with a rolling tracking bar.", durationMs: 800, directions: NONE, stillAt: 0.42 },
  "triangle-distort": { label: "Triangle distort", group: "glitch", description: "The next clip opens out of a warped triangle.", durationMs: 800, directions: SIDEWAYS, stillAt: 0.45 },

  "film-burn": { label: "Film burn", group: "light", description: "A bright, colourful film burn.", durationMs: 900, directions: NONE, stillAt: 0.38 },
  "swipe-burn": { label: "Swipe burn", group: "light", description: "Burns sweep in from both sides and flare where they meet.", durationMs: 900, directions: NONE, stillAt: 0.36 },
  "bokeh-twirl": { label: "Twirling bokeh", group: "light", description: "Bokeh swirls while the focus twists.", durationMs: 1000, directions: SIDEWAYS, stillAt: 0.45 },
  "bokeh-subtle": { label: "Subtle bokeh", group: "light", description: "Light, transparent bokeh over a soft focus pull.", durationMs: 900, directions: NONE, stillAt: 0.45 },
  "bokeh-bright": { label: "Bright bokeh", group: "light", description: "Bright bokeh and a glow between clips.", durationMs: 1000, directions: NONE, stillAt: 0.42 },

  "slip-cut": { label: "Slip cut", group: "shapes", description: "Two slabs in the ink and accent colours slip past each other along a tilted seam, each wiping on half of the next clip: Crewcut's split C as a transition.", durationMs: 700, directions: SIDEWAYS, stillAt: 0.4 },
  "liquid-swipe": { label: "Liquid swipe", group: "shapes", description: "Cartoon liquid washes across, then clears onto the next clip.", durationMs: 1000, directions: ALL, stillAt: 0.42 },
  "liquid-splash": { label: "Cartoon liquid", group: "shapes", description: "A splash floods in from the bottom-right corner.", durationMs: 1100, directions: NONE, stillAt: 0.4 },
  "diagonal-stripes": { label: "Diagonal colours", group: "shapes", description: "Coloured stripes close in from the edges and vanish in the middle.", durationMs: 1000, directions: NONE, stillAt: 0.3 },
  circles: { label: "Circles", group: "shapes", description: "Three coloured circles grow from the centre.", durationMs: 1000, directions: NONE, stillAt: 0.42 },
  tubes: { label: "Colour tubes", group: "shapes", description: "Four coloured tubes slide diagonally past each other.", durationMs: 1000, directions: NONE, stillAt: 0.36 },
  "color-orbs": { label: "Colourful orbs", group: "shapes", description: "Bright orbs pull into the middle and flash.", durationMs: 900, directions: NONE, stillAt: 0.32 },
  confetti: { label: "Confetti burst", group: "shapes", description: "A burst of confetti while a shape opens onto the next clip.", durationMs: 1200, directions: NONE, stillAt: 0.3 },
};

export function transitionInfo(type: TransitionType): TransitionInfo {
  return TRANSITION_CATALOG[type];
}

/** A fully specified transition of `type` at its catalogue defaults. */
export function defaultTransition(type: TransitionType, direction?: TransitionDirection): Transition {
  const info = TRANSITION_CATALOG[type];
  return {
    type,
    durationMs: info.durationMs,
    direction: direction ?? info.directions[0] ?? "left",
    easing: type === "cut" ? "linear" : type === "slide" ? "spring-smooth" : type === "scale-fade" ? "entrance" : "move",
  };
}

export interface TransitionPreset {
  id: string;
  label: string;
  group: TransitionGroup;
  description: string;
  transition: Transition;
}

function preset(id: string, type: TransitionType, label?: string, direction?: TransitionDirection, description?: string): TransitionPreset {
  const info = TRANSITION_CATALOG[type];
  return { id, label: label ?? info.label, group: info.group, description: description ?? info.description, transition: defaultTransition(type, direction) };
}

/**
 * The tiles in the editor's Transitions panel (and `transition:<id>` motion
 * presets for the agent). Directional variants are separate tiles because
 * that is how people look for them ("left swipe", "upwards motion").
 */
export const TRANSITION_PRESETS: ReadonlyArray<TransitionPreset> = [
  preset("crossfade-blur", "blur-crossfade"),
  preset("crossfade", "crossfade"),
  preset("push", "push"),
  preset("zoom-through", "zoom-through"),
  preset("slide", "slide"),
  preset("wipe", "wipe"),
  preset("scale-fade", "scale-fade"),
  preset("cut", "cut"),

  preset("zoom-in", "zoom-in"),
  preset("zoom-out", "zoom-out"),
  preset("zoom-in-out", "zoom-in-out"),
  preset("zoom-bounce", "zoom-bounce"),
  preset("zoom-out-bounce", "zoom-out-bounce"),
  preset("bounce-zoom", "bounce-zoom"),
  preset("zoom-burn", "zoom-burn"),
  preset("zoom-spin", "zoom-spin", undefined, "right"),
  preset("zoom-distort", "zoom-distort"),
  preset("countdown-zoom", "countdown-zoom"),

  preset("spin-right", "spin", "Spin", "right"),
  preset("spin-left", "spin", "Reverse spin", "left", "A full blurred spin to the left."),
  preset("twist", "twist", undefined, "right"),
  preset("double-twist", "double-twist", undefined, "right"),
  preset("spin-twist", "spin-twist", undefined, "right"),
  preset("spin-up", "spin-up", undefined, "right"),
  preset("spin-3d", "spin-3d", undefined, "right"),
  preset("twist-burn", "twist-burn", undefined, "right"),

  preset("swipe-left", "swipe", "Left swipe", "left", "Swipes to the left and bumps at the edge."),
  preset("swipe-right", "swipe", "Right swipe", "right", "Swipes to the right and bumps at the edge."),
  preset("swipe-up", "swipe", "Upwards swipe", "up", "Swipes up and bumps at the top."),
  preset("zoom-swipe", "zoom-swipe", undefined, "left"),
  preset("motion-up", "motion-scroll", "Upwards motion", "up", "Scrolls up with motion blur and distortion."),
  preset("motion-down", "motion-scroll", "Downwards motion", "down", "Scrolls down with motion blur and distortion."),
  preset("distort-slide", "distort-slide", undefined, "left"),
  preset("quick-distort-up", "quick-distort", "Quick upwards distort", "up"),
  preset("quick-distort-right", "quick-distort", "Quick right distort", "right"),
  preset("bounce-left", "bounce-in", "Left bounce", "right", "Springs in from the left with a bounce."),
  preset("bounce-right", "bounce-in", "Right bounce", "left", "Springs in from the right with a bounce."),
  preset("fracture-left", "fracture", "Left fracture", "left"),
  preset("split-bounce", "split-bounce", undefined, "down"),
  preset("frame-split", "frame-split"),
  preset("falling-boxes", "falling-boxes"),
  preset("step-scroll", "step-scroll", "Step scroll", "up", "Scrolls up to the next card, like a step-by-step form."),
  preset("step-back", "step-scroll", "Step back", "down", "Scrolls back down to the previous card."),

  preset("static", "static"),
  preset("digital-static", "digital-static"),
  preset("retro-interference", "retro-interference"),
  preset("triangle-distort", "triangle-distort", undefined, "right"),

  preset("film-burn", "film-burn"),
  preset("swipe-burn", "swipe-burn"),
  preset("bokeh-twirl", "bokeh-twirl", undefined, "right"),
  preset("bokeh-subtle", "bokeh-subtle"),
  preset("bokeh-bright", "bokeh-bright"),

  preset("slip-cut", "slip-cut", "Slip cut", "right"),
  preset("liquid-swipe", "liquid-swipe", "Liquid swipe", "right"),
  preset("liquid-splash", "liquid-splash"),
  preset("diagonal-stripes", "diagonal-stripes"),
  preset("circles", "circles"),
  preset("tubes", "tubes"),
  preset("color-orbs", "color-orbs"),
  preset("confetti", "confetti"),
];
