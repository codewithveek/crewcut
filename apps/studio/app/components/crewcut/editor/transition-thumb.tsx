import { type Palette, TRANSITION_CATALOG, type Transition } from "@crewcut/composition";
import { TransitionStage } from "@crewcut/renderer";
import { memo, useEffect, useId, useRef, useState } from "react";

/**
 * A transition tile's picture: the real renderer drawing the transition
 * between two tiny illustrated scenes, so every thumbnail is exactly what
 * exports. It rests on a still frame and plays only while `playing`.
 */

const W = 320;
const H = 180;
const HOLD_BEFORE = 320;
const HOLD_AFTER = 520;

// Logo colours, not theme tokens: the thumbnails are illustrations and read the same in both themes.
const DEMO_PALETTE: Palette = {
  background: "#0d0d0f",
  surface: "#f5f3ee",
  ink: "#0d0d0f",
  muted: "#8a8a93",
  accent: "#ff5b2e",
  accent2: "#ffc247",
  positive: "#3ccf7f",
  negative: "#ff5d5d",
};

function SceneA() {
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0, display: "block" }} aria-hidden>
      <defs>
        <linearGradient id="tt-a-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b2140" />
          <stop offset="1" stopColor="#3d4a78" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="url(#tt-a-sky)" />
      <circle cx="232" cy="52" r="20" fill="#f1ecdf" />
      <circle cx="70" cy="34" r="1.6" fill="#f1ecdf" opacity="0.8" />
      <circle cx="120" cy="58" r="1.2" fill="#f1ecdf" opacity="0.7" />
      <circle cx="170" cy="26" r="1.4" fill="#f1ecdf" opacity="0.8" />
      <path d="M0 132 L60 96 L112 124 L178 84 L250 126 L320 102 L320 180 L0 180 Z" fill="#232a4d" />
      <path d="M0 152 L84 124 L150 146 L228 118 L320 144 L320 180 L0 180 Z" fill="#141831" />
    </svg>
  );
}

function SceneB() {
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0, display: "block" }} aria-hidden>
      <defs>
        <linearGradient id="tt-b-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff8a4c" />
          <stop offset="1" stopColor="#ffd59a" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="url(#tt-b-sky)" />
      <circle cx="96" cy="104" r="34" fill="#fff4dc" />
      <path d="M0 128 L70 108 L140 132 L214 98 L320 124 L320 180 L0 180 Z" fill="#c2410c" />
      <path d="M0 156 L96 136 L184 158 L262 140 L320 150 L320 180 L0 180 Z" fill="#5a1e0a" />
    </svg>
  );
}

const sceneA = <SceneA />;
const sceneB = <SceneB />;

export const TransitionThumb = memo(function TransitionThumb({ transition, playing }: { transition: Transition; playing: boolean }) {
  const box = useRef<HTMLSpanElement>(null);
  const [scale, setScale] = useState(0.4);
  const info = TRANSITION_CATALOG[transition.type];
  const [clock, setClock] = useState<{ t: number; frame: number } | null>(null);
  const id = `tt-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => entry && setScale(entry.contentRect.width / W));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!playing) {
      setClock(null);
      return;
    }
    const duration = Math.max(transition.durationMs, 1);
    const cycle = HOLD_BEFORE + duration + HOLD_AFTER;
    const started = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = (now - started) % cycle;
      setClock({ t: Math.min(1, Math.max(0, (elapsed - HOLD_BEFORE) / duration)), frame: Math.floor((now - started) / 33) });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, transition.durationMs]);

  const t = clock?.t ?? info.stillAt;
  const cut = transition.type === "cut";
  return (
    <span ref={box} className="relative block aspect-video w-full overflow-hidden rounded-[6px] bg-[#0d0d0f]">
      <span className="absolute left-0 top-0 block origin-top-left" style={{ width: W, height: H, transform: `scale(${scale})` }}>
        <TransitionStage
          enterKey={cut && t < 0.5 ? "a" : "b"}
          enter={cut && t < 0.5 ? sceneA : sceneB}
          exitKey="a"
          exit={sceneA}
          transition={cut || t >= 1 ? null : transition}
          t={t}
          width={W}
          height={H}
          palette={DEMO_PALETTE}
          seed={7}
          frame={clock?.frame ?? 3}
          fontFamily="Inter, system-ui, sans-serif"
          idPrefix={id}
        />
      </span>
    </span>
  );
});
