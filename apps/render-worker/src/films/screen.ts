import type { EasingSpec, Keyframe, KeyframeMap, LayerInput } from "@crewcut/composition";

/**
 * A screen recording as Crewcut layers: the recording sits in a browser-style
 * window, plays in speed-ramped segments (waiting is sped up, the moments that
 * matter run at 1×), and carries its own cursor and click ripples, drawn from
 * the input log the recorder wrote. The camera is the window group's own
 * transform: push in on a point, pull back out.
 *
 * Units: recording px (the page's CSS px), recording ms (`events.json` time);
 * frame % and design px (1080 on the short side) for placement, as everywhere
 * in a composition.
 */

export interface RecordingEvent {
  t: number;
  type: string;
  x: number;
  y: number;
  tx?: number;
  ty?: number;
  dur?: number;
  label?: string;
}

export interface Recording {
  /** Asset id of the MP4 (`asset:<id>`). */
  assetId: string;
  width: number;
  height: number;
  durationMs: number;
  marks: Record<string, number>;
  events: RecordingEvent[];
}

/** A stretch of the recording played at one speed. */
export interface Segment {
  from: number;
  to: number;
  rate: number;
}

/** A camera beat, in recording time: by `at` the camera frames `focus` (recording px) at `zoom`. */
export interface CameraBeat {
  at: number;
  focus?: readonly [number, number];
  zoom: number;
  /** Length of the move into this beat, recording ms (default 900). */
  move?: number;
  easing?: EasingSpec;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ScreenOptions {
  id: string;
  recording: Recording;
  segments: Segment[];
  /** The window, in frame %. Its height is derived from the recording's aspect. */
  box: { x: number; y: number; w: number };
  camera?: CameraBeat[];
  /** Frame size in design px (1920 × 1080 for 16:9). */
  frame: { width: number; height: number };
  url?: string;
  /** Film ms at which the window starts (layer startMs within its clip). */
  startMs?: number;
  /** Extra clicks to draw that the log missed (recording ms + px). */
  extraClicks?: Array<{ t: number; x: number; y: number }>;
  /** Hide the cursor before this recording time. */
  cursorFrom?: number;
  chrome?: boolean;
  entrance?: "rise" | "none" | "tilt";
}

const kf = (atMs: number, value: number, easing: EasingSpec = "move"): Keyframe => ({ atMs: Math.round(atMs), value, easing });
const IN_OUT: EasingSpec = { bezier: [0.65, 0, 0.35, 1] };

/** Recording ms → ms since the window's start, through the speed segments. */
export function timeMap(segments: Segment[]): (t: number) => number {
  return (t: number) => {
    let film = 0;
    for (const segment of segments) {
      if (t <= segment.from) return film;
      if (t < segment.to) return film + (t - segment.from) / segment.rate;
      film += (segment.to - segment.from) / segment.rate;
    }
    return film;
  };
}

export function segmentsDuration(segments: Segment[]): number {
  return segments.reduce((sum, segment) => sum + (segment.to - segment.from) / segment.rate, 0);
}

const CURSOR = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 36"><defs><filter id="s" x="-40%" y="-30%" width="180%" height="170%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.6" flood-color="#000" flood-opacity=".45"/></filter></defs><path filter="url(#s)" d="M3 2.5 L3 27.5 L9.4 21.6 L13.6 31.2 L18.2 29.2 L14.1 19.8 L22.6 19.8 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
)}`;

const WINDOW_BAR = 38; // design px

export function screen(options: ScreenOptions): { layer: LayerInput; durationMs: number; filmTime: (t: number) => number; toFrame: (x: number, y: number) => [number, number] } {
  const { recording, segments, frame } = options;
  const map = timeMap(segments);
  const durationMs = segmentsDuration(segments);
  const chrome = options.chrome ?? true;
  // Window geometry in frame %: the video keeps the recording's aspect; the bar sits above it.
  const videoW = options.box.w;
  const videoHpx = ((videoW / 100) * frame.width * recording.height) / recording.width;
  const barPct = chrome ? (WINDOW_BAR / frame.height) * 100 : 0;
  const videoH = (videoHpx / frame.height) * 100;
  const totalH = videoH + barPct;
  const top = options.box.y - totalH / 2;
  const videoBox: Box = { x: options.box.x, y: top + barPct + videoH / 2, w: videoW, h: videoH };
  const toFrame = (x: number, y: number): [number, number] => [videoBox.x - videoBox.w / 2 + (x / recording.width) * videoBox.w, videoBox.y - videoBox.h / 2 + (y / recording.height) * videoBox.h];
  const pxScale = ((videoW / 100) * frame.width) / recording.width; // design px per recording px

  const children: LayerInput[] = [];
  // Window body (shadow + hairline), then the bar.
  children.push({
    id: `${options.id}-body`,
    type: "shape",
    shape: "rect",
    fill: "#16161a",
    stroke: "#ffffff1f",
    strokeWidth: 1.5,
    radius: 18,
    transform: { x: options.box.x, y: options.box.y, width: videoW + 0.0, height: totalH },
    shadow: { color: "#00000099", blur: 90, x: 0, y: 40 },
  } as LayerInput);
  if (chrome) {
    const barY = top + barPct / 2;
    const left = options.box.x - videoW / 2;
    ["#ff5f57", "#febc2e", "#28c840"].forEach((color, index) =>
      children.push({ id: `${options.id}-dot-${index}`, type: "shape", shape: "ellipse", fill: `${color}d9`, transform: { x: left + 1.1 + index * 0.75, y: barY, width: 0.62, height: 1.1 } } as LayerInput),
    );
    children.push({
      id: `${options.id}-url-pill`,
      type: "shape",
      shape: "rect",
      fill: "#ffffff0f",
      radius: 999,
      transform: { x: options.box.x, y: barY, width: 18, height: barPct * 0.62 },
    } as LayerInput);
    children.push({
      id: `${options.id}-url`,
      type: "text",
      text: options.url ?? "getcrewcut.app",
      style: { font: "Geist", size: 15, weight: 500, color: "#a1a1aa", align: "center", tracking: 0, maxWidth: 30 },
      transform: { x: options.box.x, y: barY, anchorX: 0.5, anchorY: 0.5 },
    } as LayerInput);
  }
  // The recording, one layer per speed segment.
  let cursor = 0;
  segments.forEach((segment, index) => {
    const length = (segment.to - segment.from) / segment.rate;
    children.push({
      id: `${options.id}-rec-${index}`,
      type: "video",
      src: `asset:${recording.assetId}`,
      fit: "cover",
      radius: 0,
      trimStartMs: Math.round(segment.from),
      playbackRate: segment.rate,
      volume: 0,
      startMs: Math.round(cursor),
      // Overlap a frame so segments never flash the window body between them.
      durationMs: Math.round(length + (index < segments.length - 1 ? 34 : 0)),
      transform: { x: videoBox.x, y: videoBox.y, width: videoBox.w, height: videoBox.h, clipBottom: 0 },
    } as LayerInput);
    cursor += length;
  });
  // Round the bottom corners by masking with the window body: a thin rounded border drawn over the video.
  children.push({
    id: `${options.id}-frame`,
    type: "shape",
    shape: "rect",
    fill: "#00000000",
    stroke: "#ffffff1a",
    strokeWidth: 1.5,
    radius: 18,
    transform: { x: options.box.x, y: options.box.y, width: videoW, height: totalH },
  } as LayerInput);

  // Cursor path from the log, mapped to film time.
  const from = options.cursorFrom ?? 0;
  const xs: Keyframe[] = [];
  const ys: Keyframe[] = [];
  const scale: Keyframe[] = [];
  const opacity: Keyframe[] = [];
  const events = recording.events.filter((event) => event.t >= from - 50 && event.t <= (segments.at(-1)?.to ?? Infinity));
  let started = false;
  for (const [eventIndex, event] of events.entries()) {
    const at = map(event.t);
    const [fx, fy] = toFrame(event.x, event.y);
    if (event.type === "move-start" && event.tx !== undefined && event.ty !== undefined) {
      const [tx, ty] = toFrame(event.tx, event.ty);
      // The move really ended at its move-end (a busy page stretches moves), not at the planned length.
      const ended = events.slice(eventIndex + 1).find((next) => next.type === "move-end");
      const end = map(ended ? ended.t : event.t + (event.dur ?? 600));
      xs.push(kf(at, fx, "hold"), kf(Math.max(at + 60, end), tx, IN_OUT));
      ys.push(kf(at, fy, "hold"), kf(Math.max(at + 60, end), ty, IN_OUT));
      if (!started) {
        opacity.push(kf(Math.max(0, at - 1), 0, "hold"), kf(at + 160, 1, "entrance"));
        started = true;
      }
    }
    if (event.type === "down") {
      scale.push(kf(at - 10, 1, "hold"), kf(at + 70, 0.84, "standard"), kf(at + 240, 1, "spring-snappy"));
    }
  }
  for (const click of options.extraClicks ?? []) {
    const at = map(click.t);
    scale.push(kf(at - 10, 1, "hold"), kf(at + 70, 0.84, "standard"), kf(at + 240, 1, "spring-snappy"));
  }
  const clicks = [...events.filter((event) => event.type === "down").map((event) => ({ t: event.t, x: event.x, y: event.y })), ...(options.extraClicks ?? [])];
  clicks.forEach((click, index) => {
    const at = map(click.t);
    const [cx, cy] = toFrame(click.x, click.y);
    children.push({
      id: `${options.id}-ripple-${index}`,
      type: "shape",
      shape: "ellipse",
      fill: "#ff5b2e33",
      stroke: "#ff5b2ecc",
      strokeWidth: 3,
      startMs: Math.round(at),
      durationMs: 520,
      transform: { x: cx, y: cy, width: (60 * pxScale * 100) / frame.width, height: (60 * pxScale * 100) / frame.height },
      keyframes: { scale: [kf(0, 0.35, "hold"), kf(480, 1.35, { bezier: [0.16, 1, 0.3, 1] })], opacity: [kf(0, 0.95, "hold"), kf(480, 0, "exit")] },
    } as LayerInput);
  });
  if (xs.length) {
    const cursorW = ((26 * pxScale) / frame.width) * 100;
    const cursorH = ((34 * pxScale) / frame.height) * 100;
    const keyframes: KeyframeMap = { x: dedupe(xs), y: dedupe(ys) };
    if (scale.length) keyframes.scale = dedupe(scale);
    if (opacity.length) keyframes.opacity = opacity;
    children.push({
      id: `${options.id}-cursor`,
      type: "image",
      src: CURSOR,
      fit: "contain",
      alt: "",
      transform: { x: xs[0]?.value ?? 50, y: ys[0]?.value ?? 50, width: cursorW, height: cursorH, anchorX: 0.1, anchorY: 0.07, originX: 0.1, originY: 0.07, opacity: opacity.length ? 0 : 1 },
      keyframes,
    } as LayerInput);
  }

  // Camera: the window group's scale and pan, framing focus points.
  const groupKeys: KeyframeMap = {};
  const camera = options.camera ?? [];
  if (camera.length) {
    const sx: Keyframe[] = [];
    const ox: Keyframe[] = [];
    const oy: Keyframe[] = [];
    let previous = { zoom: 1, ox: 0, oy: 0 };
    for (const [index, beat] of camera.entries()) {
      const end = map(beat.at);
      const start = index === 0 && beat.at <= 0 ? end : map(beat.at - (beat.move ?? 900));
      const [fx, fy] = beat.focus ? toFrame(beat.focus[0], beat.focus[1]) : [50, 50];
      // translate t so that the focus lands at the frame centre, clamped to keep the window covering the frame when it can.
      const pan = (focus: number, size: number, extent: [number, number]) => {
        let t = -beat.zoom * (focus - 50);
        const lo = 50 + t + beat.zoom * (extent[0] - 50);
        const hi = 50 + t + beat.zoom * (extent[1] - 50);
        if (hi - lo >= 100) {
          if (lo > 0) t -= lo;
          if (hi < 100) t += 100 - hi;
        } else {
          t = -beat.zoom * ((extent[0] + extent[1]) / 2 - 50);
        }
        return (t / 100) * size;
      };
      const x = pan(fx, frame.width, [options.box.x - videoW / 2, options.box.x + videoW / 2]);
      const y = pan(fy, frame.height, [top, top + totalH]);
      const easing = beat.easing ?? IN_OUT;
      if (index === 0) {
        sx.push(kf(0, beat.at <= 0 ? beat.zoom : 1, "hold"));
        ox.push(kf(0, beat.at <= 0 ? x : 0, "hold"));
        oy.push(kf(0, beat.at <= 0 ? y : 0, "hold"));
      }
      if (beat.at > 0 || index > 0) {
        sx.push(kf(start, previous.zoom, "hold"), kf(end, beat.zoom, easing));
        ox.push(kf(start, previous.ox, "hold"), kf(end, x, easing));
        oy.push(kf(start, previous.oy, "hold"), kf(end, y, easing));
      }
      previous = { zoom: beat.zoom, ox: x, oy: y };
    }
    groupKeys.scale = dedupe(sx);
    groupKeys.offsetX = dedupe(ox);
    groupKeys.offsetY = dedupe(oy);
  }
  if (options.entrance === "rise" || options.entrance === undefined) {
    groupKeys.opacity = [kf(0, 0, "hold"), kf(380, 1, "entrance")];
    if (!camera.length) groupKeys.offsetY = [kf(0, 70, "hold"), kf(800, 0, "spring-smooth")];
  }
  const layer = {
    id: options.id,
    type: "group",
    name: "Screen recording",
    ...(options.startMs !== undefined ? { startMs: options.startMs } : {}),
    durationMs: Math.round(durationMs),
    transform: { x: 50, y: 50 },
    keyframes: groupKeys,
    children,
  } as LayerInput;
  return { layer, durationMs, filmTime: map, toFrame };
}

/** Keyframes must have increasing times; later duplicates at the same time win. */
function dedupe(frames: Keyframe[]): Keyframe[] {
  const sorted = [...frames].sort((a, b) => a.atMs - b.atMs);
  const out: Keyframe[] = [];
  for (const frame of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.atMs - frame.atMs) < 1) out[out.length - 1] = frame;
    else out.push(frame);
  }
  return out;
}
