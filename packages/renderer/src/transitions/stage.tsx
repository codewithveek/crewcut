import React from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Palette, Transition } from "@crewcut/composition";
import { easedSegmentProgress } from "@crewcut/motion";

import { type ContentBox, type LayerSpec, type TransitionFrame, transitionFrame } from "./effects";
import { SvgFilter, clamp01, filterActive } from "./kit";

/** Eased progress and normalised speed at raw progress `t`. */
export function transitionProgress(transition: Transition, t: number): { e: number; speed: number } {
  const duration = Math.max(1, transition.durationMs);
  const at = (x: number) => easedSegmentProgress(transition.easing, clamp01(x) * duration, duration);
  const h = 0.015;
  const a = Math.max(0, t - h);
  const b = Math.min(1, t + h);
  const slope = b > a ? Math.abs(at(b) - at(a)) / (b - a) : 0;
  return { e: at(t), speed: Math.min(1, slope / 4) };
}

export interface TransitionStageProps {
  /** The incoming clip (or the only clip when nothing is transitioning). */
  enter: ReactNode;
  enterKey: string;
  exit?: ReactNode;
  exitKey?: string;
  /** null/undefined → just draw `enter`. */
  transition?: Transition | null;
  /** Raw progress 0..1 through the transition. */
  t?: number;
  width: number;
  height: number;
  palette: Palette;
  seed: number;
  frame: number;
  fontFamily: string;
  /** url()-safe prefix for SVG filter ids; unique per stage on the page. */
  idPrefix: string;
  /** What each clip draws (defaults to the whole frame). */
  exitBox?: ContentBox;
  enterBox?: ContentBox;
  /** The clips don't fill the frame: transition graphics stay inside their boxes. */
  transparent?: boolean;
}

/**
 * Where a transition's graphics may draw when the clips are elements: the two
 * boxes together, padded. Shapes and glitches get a rounded clip; light gets a
 * feathered ellipse so a burn reads as a flare on the element, not a box.
 */
function containment(width: number, height: number, a: ContentBox | undefined, b: ContentBox | undefined): { clip: CSSProperties; feather: CSSProperties } | null {
  if (!a && !b) return null;
  const boxes = [a, b].filter((box): box is ContentBox => Boolean(box));
  const pad = 0.05 * Math.min(width, height);
  const left = Math.max(0, Math.min(...boxes.map((box) => box.left)) - pad);
  const top = Math.max(0, Math.min(...boxes.map((box) => box.top)) - pad);
  const right = Math.min(width, Math.max(...boxes.map((box) => box.right)) + pad);
  const bottom = Math.min(height, Math.max(...boxes.map((box) => box.bottom)) + pad);
  if (right <= left || bottom <= top) return null;
  const radius = Math.min(right - left, bottom - top) * 0.08;
  const clipPath = `inset(${top.toFixed(1)}px ${(width - right).toFixed(1)}px ${(height - bottom).toFixed(1)}px ${left.toFixed(1)}px round ${radius.toFixed(1)}px)`;
  const mask = `radial-gradient(ellipse ${(((right - left) / 2) * 1.25).toFixed(1)}px ${(((bottom - top) / 2) * 1.25).toFixed(1)}px at ${((left + right) / 2).toFixed(1)}px ${((top + bottom) / 2).toFixed(1)}px, #000 45%, transparent 100%)`;
  return { clip: { clipPath }, feather: { maskImage: mask, WebkitMaskImage: mask } };
}

const layerBase: CSSProperties = { position: "absolute", inset: 0 };
const isolate: CSSProperties = { position: "absolute", inset: 0, isolation: "isolate" };

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function layerStyle(spec: LayerSpec | undefined, filterId: string | null, zIndex: number): CSSProperties {
  const style = spec?.style ?? {};
  const filter = [filterId ? `url(#${filterId})` : undefined, style.filter].filter(Boolean).join(" ") || undefined;
  return { ...layerBase, ...style, filter, zIndex, visibility: spec?.hidden ? "hidden" : undefined };
}

/**
 * Draws one visual track at one instant: either a single clip, or two clips
 * mid-transition plus the transition's graphics. The tree keeps the same
 * shape either way (clips keyed by id, fixed DOM order, z-index for which is
 * on top) so clips — and their videos — never remount or move in the DOM
 * when a transition starts, swaps sides or ends.
 */
export function TransitionStage(props: TransitionStageProps) {
  const { enter, enterKey, exit, exitKey, transition, width, height, palette, seed, frame, fontFamily } = props;
  const active = Boolean(transition && transition.type !== "cut" && transition.durationMs > 0 && exit != null && exitKey);
  if (!active || !transition) {
    return (
      <>
        {[
          <div key="track" style={isolate}>
            {[
              <div key={enterKey} style={layerBase}>
                {enter}
              </div>,
            ]}
          </div>,
        ]}
      </>
    );
  }
  const t = clamp01(props.t ?? 0);
  const { e, speed } = transitionProgress(transition, t);
  const id = safeId(props.idPrefix);
  const frameSpec: TransitionFrame = transitionFrame({
    type: transition.type,
    direction: transition.direction,
    t,
    e,
    speed,
    durationMs: transition.durationMs,
    width,
    height,
    unit: Math.min(width, height) / 1000,
    palette,
    seed,
    frame,
    fontFamily,
    id,
    ...(props.exitBox ? { exitBox: props.exitBox } : {}),
    ...(props.enterBox ? { enterBox: props.enterBox } : {}),
    ...(props.transparent ? { transparent: true } : {}),
  });
  const contain = props.transparent ? containment(width, height, props.exitBox, props.enterBox) : null;
  const exitFilter = filterActive(frameSpec.exit.filter) && !frameSpec.exit.hidden ? `${id}-fx` : null;
  const enterFilter = filterActive(frameSpec.enter.filter) && !frameSpec.enter.hidden ? `${id}-fn` : null;
  const exitOnTop = frameSpec.top === "exit";
  return (
    <>
      {[
        <div key="track" style={isolate}>
          {[
            <div key={exitKey} style={layerStyle(frameSpec.exit, exitFilter, exitOnTop ? 3 : 1)}>
              {exit}
            </div>,
            <div key={enterKey} style={layerStyle(frameSpec.enter, enterFilter, exitOnTop ? 1 : 3)}>
              {enter}
            </div>,
            exitFilter || enterFilter ? (
              <svg key="defs" width={0} height={0} style={{ position: "absolute" }} aria-hidden>
                <defs>
                  {exitFilter && frameSpec.exit.filter ? <SvgFilter id={exitFilter} spec={frameSpec.exit.filter} /> : null}
                  {enterFilter && frameSpec.enter.filter ? <SvgFilter id={enterFilter} spec={frameSpec.enter.filter} /> : null}
                </defs>
              </svg>
            ) : null,
            frameSpec.middle ? (
              <div key="middle" style={{ ...layerBase, zIndex: 2, pointerEvents: "none", ...contain?.clip }}>
                {frameSpec.middle}
              </div>
            ) : null,
            frameSpec.overlay ? (
              <div key="overlay" style={{ ...layerBase, zIndex: 4, pointerEvents: "none", ...contain?.clip }}>
                {frameSpec.overlay}
              </div>
            ) : null,
          ]}
        </div>,
        // Light sits just outside the track's isolated group so screen blending lightens what is
        // really underneath (the shot below an element) instead of painting on transparency.
        frameSpec.glow ? (
          <div key="glow" style={{ ...layerBase, pointerEvents: "none", mixBlendMode: "screen", ...contain?.feather }}>
            {frameSpec.glow}
          </div>
        ) : null,
      ]}
    </>
  );
}
