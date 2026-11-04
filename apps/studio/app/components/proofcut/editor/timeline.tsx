import {
  type AnimatableProperty,
  type Composition,
  type Track,
  clipEndMs,
  collectSnapTargets,
  deleteClips,
  findLayer,
  formatTimecode,
  frameToMs,
  moveClip,
  moveKeyframes,
  setMarker,
  setTrackState,
  snapSpan,
  snapTime,
  splitClip,
  trimClip,
} from "@proofcut/composition";
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBookmark,
  IconCut,
  IconEye,
  IconEyeOff,
  IconLock,
  IconLockOpen,
  IconMagnet,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerTrackNext,
  IconPlayerTrackPrev,
  IconTrash,
  IconVolume,
  IconVolumeOff,
  IconZoomIn,
  IconZoomOut,
} from "@tabler/icons-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { clipAtPlayhead, useEditor } from "./editor-store";

const HEADER_WIDTH = 148;
const RULER_HEIGHT = 28;
const SNAP_PX = 8;

const ROW_HEIGHT: Record<string, number> = { visual: 56, overlay: 40, caption: 30, voice: 44, music: 34, sfx: 30, keyframes: 22 };

function rowHeight(track: Track, index: number): number {
  if (track.kind === "visual") return index === 0 ? ROW_HEIGHT.visual! : ROW_HEIGHT.overlay!;
  if (track.kind === "caption") return ROW_HEIGHT.caption!;
  return ROW_HEIGHT[track.role] ?? 34;
}

/** Adaptive ruler: seconds → 100 ms → single frames as you zoom in. */
function rulerSteps(pxPerMs: number, fps: number): { minor: number; major: number } {
  const frameMs = 1000 / fps;
  const candidates = [frameMs, 50, 100, 250, 500, 1000, 2000, 5000, 10_000, 30_000, 60_000, 120_000];
  const minor = candidates.find((step) => step * pxPerMs >= 7) ?? 120_000;
  const major = candidates.find((step) => step >= minor && step * pxPerMs >= 72 && (Math.abs(step / minor - Math.round(step / minor)) < 1e-6 || step === frameMs)) ?? minor * 10;
  return { minor, major };
}

function rulerLabel(ms: number, major: number, fps: number, mode: "ms" | "frames"): string {
  const code = formatTimecode(ms, { fps, mode });
  if (mode === "frames") return code.slice(3);
  if (major >= 1000) return code.slice(3, 8);
  return code.slice(6);
}

type DragKind = "move" | "start" | "end";
interface DragState {
  clipId: string;
  trackId: string;
  kind: DragKind;
  originX: number;
  startMs: number;
  durationMs: number;
  moved: boolean;
}

const Waveform = memo(function Waveform({ peaks, estimated }: { peaks: readonly number[]; estimated: boolean }) {
  if (peaks.length === 0) return null;
  const bars = peaks.length;
  return (
    <svg className={cn("absolute inset-x-1 inset-y-1.5 h-[calc(100%-12px)] w-[calc(100%-8px)]", estimated && "opacity-40")} viewBox={`0 0 ${bars} 100`} preserveAspectRatio="none" aria-hidden>
      {peaks.map((peak, index) => {
        const height = Math.max(4, peak * 100);
        return <rect key={index} x={index + 0.15} y={(100 - height) / 2} width={0.7} height={height} rx={0.3} fill="currentColor" />;
      })}
    </svg>
  );
});

export function Timeline({ compact = false, height }: { compact?: boolean; height: number }) {
  const composition = useEditor((state) => state.composition);
  const zoom = useEditor((state) => state.zoom);
  const playheadMs = useEditor((state) => state.playheadMs);
  const playing = useEditor((state) => state.playing);
  const selectedClipIds = useEditor((state) => state.selectedClipIds);
  const selectedLayer = useEditor((state) => state.selectedLayer);
  const timecodeMode = useEditor((state) => state.timecodeMode);
  const snapping = useEditor((state) => state.snapping);
  const ripple = useEditor((state) => state.ripple);
  const inMs = useEditor((state) => state.inMs);
  const outMs = useEditor((state) => state.outMs);
  const saving = useEditor((state) => state.saving);
  const undoStack = useEditor((state) => state.undoStack);
  const redoStack = useEditor((state) => state.redoStack);
  const editor = useEditor;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, width: 800 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [ghost, setGhost] = useState<{ startMs: number; durationMs: number } | null>(null);
  const [keyframeDrag, setKeyframeDrag] = useState<{ property: AnimatableProperty; fromMs: number; toMs: number; originX: number } | null>(null);
  const pxPerMs = zoom / 1000;

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => setView({ left: element.scrollLeft, width: element.clientWidth });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener("scroll", update, { passive: true });
    // Ctrl/⌘ + wheel (and trackpad pinch) zooms around the pointer, down to single frames.
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const state = editor.getState();
      const rect = element.getBoundingClientRect();
      const pointerX = event.clientX - rect.left - (compact ? 0 : HEADER_WIDTH);
      const atMs = (element.scrollLeft + pointerX) / (state.zoom / 1000);
      const nextZoom = state.zoom * Math.exp(-event.deltaY * 0.0025);
      state.setZoom(nextZoom);
      requestAnimationFrame(() => {
        const applied = editor.getState().zoom / 1000;
        element.scrollLeft = Math.max(0, atMs * applied - pointerX);
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", update);
      element.removeEventListener("wheel", onWheel);
    };
  }, [compact, editor]);

  // Keep the playhead in view while playing.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !playing) return;
    const x = playheadMs * pxPerMs;
    if (x < element.scrollLeft || x > element.scrollLeft + element.clientWidth - 80) element.scrollLeft = Math.max(0, x - 120);
  }, [playheadMs, playing, pxPerMs]);

  const tracks = useMemo(() => {
    if (!composition) return [];
    const list = compact ? composition.tracks.filter((track, index) => index === 0 || (track.kind === "audio" && track.role === "voice")) : composition.tracks;
    return list.map((track) => ({ track, index: composition.tracks.indexOf(track) }));
  }, [composition, compact]);

  const snapTargets = useMemo(() => {
    if (!composition) return [];
    return collectSnapTargets(composition, { playheadMs, excludeClipIds: new Set(drag ? [drag.clipId] : []), ...(inMs !== null ? { beatsMs: [inMs, ...(outMs !== null ? [outMs] : [])] } : {}) });
  }, [composition, playheadMs, drag, inMs, outMs]);

  const keyframeLanes = useMemo(() => {
    if (!composition || !selectedLayer || compact) return [];
    const track = composition.tracks.find((candidate) => candidate.kind === "visual" && candidate.clips.some((clip) => clip.id === selectedLayer.clipId));
    const clip = track?.kind === "visual" ? track.clips.find((candidate) => candidate.id === selectedLayer.clipId) : undefined;
    const location = clip ? findLayer(clip, selectedLayer.layerId) : null;
    if (!clip || !location) return [];
    const base = clip.startMs + location.layer.startMs;
    return Object.entries(location.layer.keyframes)
      .filter(([, keyframes]) => keyframes && keyframes.length > 0)
      .map(([property, keyframes]) => ({ property: property as AnimatableProperty, base, keyframes: keyframes ?? [] }));
  }, [composition, selectedLayer, compact]);

  const xToMs = useCallback(
    (clientX: number) => {
      const element = scrollRef.current;
      if (!element) return 0;
      const rect = element.getBoundingClientRect();
      return (clientX - rect.left + element.scrollLeft - (compact ? 0 : HEADER_WIDTH)) / pxPerMs;
    },
    [pxPerMs, compact],
  );

  if (!composition) return null;
  const fps = composition.fps;
  const contentWidth = composition.durationMs * pxPerMs + 240;
  const { minor, major } = rulerSteps(pxPerMs, fps);
  const visibleStart = Math.max(0, (view.left - (compact ? 0 : HEADER_WIDTH)) / pxPerMs - major);
  const visibleEnd = (view.left + view.width) / pxPerMs + major;

  const ticks: Array<{ ms: number; major: boolean }> = [];
  for (let ms = Math.floor(visibleStart / minor) * minor; ms <= Math.min(visibleEnd, composition.durationMs + major); ms += minor) {
    const isMajor = Math.abs(ms / major - Math.round(ms / major)) < 1e-6;
    ticks.push({ ms, major: isMajor });
    if (ticks.length > 1500) break;
  }

  const thresholdMs = SNAP_PX / pxPerMs;

  function beginScrub(event: React.PointerEvent) {
    event.currentTarget.setPointerCapture(event.pointerId);
    editor.getState().setPlaying(false);
    editor.getState().setPlayhead(xToMs(event.clientX));
    const move = (moveEvent: PointerEvent) => {
      const raw = xToMs(moveEvent.clientX);
      editor.getState().setPlayhead(snapping && !moveEvent.altKey ? snapTime(raw, collectSnapTargets(composition as Composition), thresholdMs).timeMs : raw);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function beginClipDrag(event: React.PointerEvent, trackId: string, clip: { id: string; startMs: number; durationMs: number }, kind: DragKind) {
    event.stopPropagation();
    if (event.button !== 0) return;
    const state = editor.getState();
    state.selectClip(clip.id, event.shiftKey || event.metaKey);
    const track = composition?.tracks.find((candidate) => candidate.id === trackId);
    if (track?.locked) return;
    const start: DragState = { clipId: clip.id, trackId, kind, originX: event.clientX, startMs: clip.startMs, durationMs: clip.durationMs, moved: false };
    setDrag(start);
    let latest = { startMs: clip.startMs, durationMs: clip.durationMs };
    const targets = collectSnapTargets(composition as Composition, { playheadMs: state.playheadMs, excludeClipIds: new Set([clip.id]) });
    const move = (moveEvent: PointerEvent) => {
      const deltaMs = (moveEvent.clientX - start.originX) / pxPerMs;
      if (Math.abs(moveEvent.clientX - start.originX) > 2) start.moved = true;
      const snap = snapping && !moveEvent.altKey;
      if (kind === "move") {
        const raw = Math.max(0, start.startMs + deltaMs);
        latest = { startMs: snap ? Math.max(0, snapSpan(raw, start.durationMs, targets, thresholdMs).startMs) : raw, durationMs: start.durationMs };
      } else if (kind === "start") {
        const end = start.startMs + start.durationMs;
        const raw = Math.min(end - 40, Math.max(0, start.startMs + deltaMs));
        const snapped = snap ? snapTime(raw, targets, thresholdMs).timeMs : raw;
        latest = { startMs: snapped, durationMs: end - snapped };
      } else {
        const raw = Math.max(start.startMs + 40, start.startMs + start.durationMs + deltaMs);
        const snapped = snap ? snapTime(raw, targets, thresholdMs).timeMs : raw;
        latest = { startMs: start.startMs, durationMs: snapped - start.startMs };
      }
      setGhost(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      setGhost(null);
      if (!start.moved) return;
      const commit = editor.getState().commit;
      const rippleOn = editor.getState().ripple;
      if (kind === "move") {
        const input = { clipId: clip.id, startMs: Math.round(latest.startMs) };
        void commit("move-clip", input, (c) => moveClip(c, input));
      } else {
        const toMs = Math.round(kind === "start" ? latest.startMs : latest.startMs + latest.durationMs);
        const input = { clipId: clip.id, edge: kind, toMs, ripple: rippleOn };
        void commit("trim-clip", input, (c) => trimClip(c, input));
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function beginKeyframeDrag(event: React.PointerEvent, property: AnimatableProperty, atMs: number, base: number) {
    event.stopPropagation();
    if (!selectedLayer) return;
    editor.getState().setPlayhead(base + atMs);
    const origin = event.clientX;
    let target = atMs;
    setKeyframeDrag({ property, fromMs: atMs, toMs: atMs, originX: origin });
    const move = (moveEvent: PointerEvent) => {
      const raw = atMs + (moveEvent.clientX - origin) / pxPerMs;
      target = Math.round(frameToMs(Math.round((raw * fps) / 1000), fps));
      setKeyframeDrag({ property, fromMs: atMs, toMs: target, originX: origin });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setKeyframeDrag(null);
      if (Math.abs(target - atMs) < 1) return;
      const op = { op: "move-keyframes" as const, clipId: selectedLayer.clipId, layerId: selectedLayer.layerId, fromMs: atMs, toMs: target, property };
      void editor.getState().commit("edit-composition", { label: `Move ${property} keyframe → ${target} ms`, ops: [op] }, (c) => moveKeyframes(c, op));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function splitAtPlayhead() {
    if (!composition) return;
    const state = editor.getState();
    const clipId = state.selectedClipIds[0] ?? clipAtPlayhead(composition, state.playheadMs);
    if (!clipId) return;
    const input = { clipId, atMs: Math.round(state.playheadMs) };
    void state.commit("split-clip", input, (c) => splitClip(c, input).composition);
  }

  function deleteSelected() {
    const state = editor.getState();
    if (state.selectedClipIds.length === 0) return;
    const input = { clipIds: state.selectedClipIds, ripple: state.ripple };
    void state.commit("delete-clips", input, (c) => deleteClips(c, input));
    state.selectClip(null);
  }

  function addMarker() {
    const state = editor.getState();
    const op = { op: "set-marker" as const, atMs: Math.round(state.playheadMs), label: "" };
    void state.commit("edit-composition", { label: "Add marker", ops: [op] }, (c) => setMarker(c, op));
  }

  function toggleTrack(track: Track, key: "hidden" | "locked" | "muted") {
    const value = key === "muted" ? !(track.kind === "audio" && track.muted) : !track[key];
    const op = { op: "set-track-state" as const, trackId: track.id, patch: { [key]: value } };
    void editor.getState().commit("edit-composition", { label: `${value ? "" : "Un"}${key === "hidden" ? "hide" : key === "locked" ? "lock" : "mute"} ${track.name}`, ops: [op] }, (c) => setTrackState(c, op));
  }

  function zoomBy(factor: number) {
    const element = scrollRef.current;
    const state = editor.getState();
    const center = element ? (element.scrollLeft + element.clientWidth / 2 - (compact ? 0 : HEADER_WIDTH)) / pxPerMs : state.playheadMs;
    state.setZoom(state.zoom * factor);
    requestAnimationFrame(() => {
      if (element) element.scrollLeft = Math.max(0, center * (editor.getState().zoom / 1000) - element.clientWidth / 2);
    });
  }

  function zoomToFit() {
    const element = scrollRef.current;
    if (!element || !composition) return;
    editor.getState().setZoom(((element.clientWidth - (compact ? 16 : HEADER_WIDTH + 24)) / composition.durationMs) * 1000);
    element.scrollLeft = 0;
  }

  const playheadX = playheadMs * pxPerMs;
  const lanesHeight = tracks.reduce((sum, { track, index }) => sum + rowHeight(track, index), 0) + keyframeLanes.length * ROW_HEIGHT.keyframes!;

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col" style={{ height }}>
      {/* Transport + tools */}
      <div className="flex h-11 min-w-0 shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2">
        <ToolButton label="Previous frame (←)" onClick={() => editor.getState().stepFrames(-1)}>
          <IconPlayerTrackPrev className="size-4" />
        </ToolButton>
        <ToolButton label={playing ? "Pause (Space)" : "Play (Space)"} onClick={() => editor.getState().setPlaying(!playing)} primary>
          {playing ? <IconPlayerPause className="size-4" /> : <IconPlayerPlay className="size-4" />}
        </ToolButton>
        <ToolButton label="Next frame (→)" onClick={() => editor.getState().stepFrames(1)}>
          <IconPlayerTrackNext className="size-4" />
        </ToolButton>
        <button
          type="button"
          onClick={() => editor.getState().toggleTimecodeMode()}
          title="Toggle milliseconds / frames"
          className="pc-press mx-1 shrink-0 whitespace-nowrap rounded-md px-2 py-1 font-mono text-[12px] tabular text-foreground hover:bg-accent"
        >
          {formatTimecode(playheadMs, { fps, mode: timecodeMode })}
          {!compact ? <span className="text-muted-foreground"> / {formatTimecode(composition.durationMs, { fps, mode: timecodeMode })}</span> : null}
        </button>
        <div className="mx-1 h-5 w-px bg-border" aria-hidden />
        <ToolButton label="Split at playhead (S)" onClick={splitAtPlayhead}>
          <IconCut className="size-4" />
        </ToolButton>
        <ToolButton label={ripple ? "Delete with ripple (⌫)" : "Delete (⌫)"} onClick={deleteSelected} disabled={selectedClipIds.length === 0}>
          <IconTrash className="size-4" />
        </ToolButton>
        <ToggleButton label="Ripple edits" active={ripple} onClick={() => editor.getState().toggleRipple()}>
          <span className="text-[11px] font-semibold">RIP</span>
        </ToggleButton>
        <ToggleButton label="Snapping (hold Alt to bypass)" active={snapping} onClick={() => editor.getState().toggleSnapping()}>
          <IconMagnet className="size-4" />
        </ToggleButton>
        <ToolButton label="Add marker (M)" onClick={addMarker}>
          <IconBookmark className="size-4" />
        </ToolButton>
        <div className="mx-1 h-5 w-px bg-border" aria-hidden />
        <ToolButton label="Undo (Ctrl/⌘ Z)" onClick={() => void editor.getState().undo()} disabled={undoStack.length < 2}>
          <IconArrowBackUp className="size-4" />
        </ToolButton>
        <ToolButton label="Redo (Ctrl/⌘ Shift Z)" onClick={() => void editor.getState().redo()} disabled={redoStack.length === 0}>
          <IconArrowForwardUp className="size-4" />
        </ToolButton>
        <div className="ml-auto flex items-center gap-1">
          {saving > 0 ? <span className="mr-2 text-[11px] text-muted-foreground">Saving…</span> : null}
          <ToolButton label="Zoom out (−)" onClick={() => zoomBy(1 / 1.5)}>
            <IconZoomOut className="size-4" />
          </ToolButton>
          <button type="button" onClick={zoomToFit} className="pc-press rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground" title="Zoom to fit">
            Fit
          </button>
          <ToolButton label="Zoom in (+)" onClick={() => zoomBy(1.5)}>
            <IconZoomIn className="size-4" />
          </ToolButton>
        </div>
      </div>

      {/* Ruler, headers and lanes */}
      <div ref={scrollRef} className="pc-timeline-scroll relative min-h-0 min-w-0 flex-1 overflow-auto" role="region" aria-label="Timeline">
        <div className="relative" style={{ width: contentWidth + (compact ? 0 : HEADER_WIDTH), minHeight: RULER_HEIGHT + lanesHeight }}>
          {/* Ruler */}
          <div className="sticky top-0 z-30 flex" style={{ height: RULER_HEIGHT }}>
            {!compact ? <div className="sticky left-0 z-40 shrink-0 border-b border-r border-border bg-card" style={{ width: HEADER_WIDTH }} /> : null}
            <div className="relative flex-1 cursor-col-resize border-b border-border bg-card/95 backdrop-blur" onPointerDown={beginScrub} role="slider" aria-label="Playhead" aria-valuemin={0} aria-valuemax={composition.durationMs} aria-valuenow={Math.round(playheadMs)} aria-valuetext={formatTimecode(playheadMs, { fps })} tabIndex={0}>
              {inMs !== null || outMs !== null ? (
                <div className="absolute inset-y-0 bg-pc-accent-soft" style={{ left: (inMs ?? 0) * pxPerMs, width: ((outMs ?? composition.durationMs) - (inMs ?? 0)) * pxPerMs }} />
              ) : null}
              {ticks.map((tick) => (
                <div key={tick.ms} className="absolute bottom-0" style={{ left: tick.ms * pxPerMs }}>
                  <div className={cn("w-px bg-muted-foreground/40", tick.major ? "h-2.5" : "h-1.5")} />
                  {tick.major ? (
                    <span className="absolute bottom-3 left-1 whitespace-nowrap font-mono text-[10px] tabular text-muted-foreground">{rulerLabel(tick.ms, major, fps, timecodeMode)}</span>
                  ) : null}
                </div>
              ))}
              {composition.markers.map((marker) => (
                <button
                  key={marker.id}
                  type="button"
                  title={marker.label || "Marker"}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => editor.getState().setPlayhead(marker.atMs)}
                  className="absolute top-0 size-0 -translate-x-1/2 border-x-[5px] border-t-[7px] border-x-transparent"
                  style={{ left: marker.atMs * pxPerMs, borderTopColor: marker.color ?? "var(--pc-weak)" }}
                />
              ))}
              <div className="pointer-events-none absolute top-0 z-10 -translate-x-1/2" style={{ left: playheadX }}>
                <div className="h-3 w-3 rotate-45 rounded-sm bg-pc-playhead" style={{ marginTop: RULER_HEIGHT - 10 }} />
              </div>
            </div>
          </div>

          {/* Lanes */}
          {tracks.map(({ track, index }) => {
            const height = rowHeight(track, index);
            return (
              <div key={track.id}>
                <div className="flex" style={{ height }}>
                  {!compact ? (
                    <div className="sticky left-0 z-20 flex shrink-0 items-center gap-1 border-b border-r border-border bg-card px-2" style={{ width: HEADER_WIDTH }}>
                      <span className={cn("min-w-0 flex-1 truncate text-[12px] font-medium", track.hidden ? "text-muted-foreground line-through" : "text-foreground")}>{track.name}</span>
                      {track.kind === "audio" ? (
                        <TrackToggle label={track.muted ? "Unmute" : "Mute"} onClick={() => toggleTrack(track, "muted")}>
                          {track.muted ? <IconVolumeOff className="size-3.5" /> : <IconVolume className="size-3.5" />}
                        </TrackToggle>
                      ) : (
                        <TrackToggle label={track.hidden ? "Show" : "Hide"} onClick={() => toggleTrack(track, "hidden")}>
                          {track.hidden ? <IconEyeOff className="size-3.5" /> : <IconEye className="size-3.5" />}
                        </TrackToggle>
                      )}
                      <TrackToggle label={track.locked ? "Unlock" : "Lock"} onClick={() => toggleTrack(track, "locked")}>
                        {track.locked ? <IconLock className="size-3.5" /> : <IconLockOpen className="size-3.5" />}
                      </TrackToggle>
                    </div>
                  ) : null}
                  <div
                    className="relative flex-1 border-b border-border bg-pc-track"
                    onPointerDown={(event) => {
                      if (event.target === event.currentTarget) {
                        editor.getState().selectClip(null);
                        editor.getState().setPlayhead(xToMs(event.clientX));
                      }
                    }}
                  >
                    {track.clips
                      .filter((clip) => clipEndMs(clip) >= visibleStart && clip.startMs <= visibleEnd)
                      .map((clip) => {
                        const isDragging = drag?.clipId === clip.id && ghost;
                        const startMs = isDragging ? ghost.startMs : clip.startMs;
                        const durationMs = isDragging ? ghost.durationMs : clip.durationMs;
                        const selected = selectedClipIds.includes(clip.id);
                        const width = Math.max(3, durationMs * pxPerMs - 1);
                        const estimated = "src" in clip && clip.src.startsWith("estimated:");
                        return (
                          <div
                            key={clip.id}
                            data-selected={selected ? "true" : "false"}
                            className={cn(
                              "pc-clip group absolute top-1 bottom-1 overflow-hidden rounded-md text-left",
                              track.kind === "caption" && "bg-[color-mix(in_oklab,var(--pc-weak)_22%,var(--pc-clip))]",
                              track.kind === "audio" && track.role === "voice" && "text-pc-accent",
                              track.kind === "audio" && track.role === "music" && "text-supported",
                              estimated && "border border-dashed border-muted-foreground/40",
                              isDragging && "opacity-80 shadow-lg",
                            )}
                            style={{ left: startMs * pxPerMs, width }}
                            onPointerDown={(event) => beginClipDrag(event, track.id, clip, "move")}
                            onDoubleClick={() => editor.getState().setPlayhead(clip.startMs)}
                            title={`${"name" in clip && clip.name ? clip.name : "text" in clip && clip.text ? clip.text : clip.id} · ${(durationMs / 1000).toFixed(3)} s`}
                          >
                            {"peaks" in clip ? <Waveform peaks={clip.peaks} estimated={estimated} /> : null}
                            <div className="relative flex h-full items-start gap-1.5 px-2 py-1">
                              <span className="truncate text-[11px] font-medium text-foreground">
                                {"layers" in clip ? clip.name ?? clip.id : "words" in clip ? clip.text : estimated ? "est." : (clip.text ?? "")}
                              </span>
                              {"layers" in clip && width > 90 ? <span className="shrink-0 text-[10px] text-muted-foreground tabular">{(durationMs / 1000).toFixed(2)}s</span> : null}
                              {"timing" in clip && clip.timing === "narration" && width > 140 ? <span className="shrink-0 text-[10px] text-muted-foreground">· voice-timed</span> : null}
                            </div>
                            {!track.locked ? (
                              <>
                                <span
                                  className="pc-trim-handle absolute inset-y-0 left-0 w-2 bg-transparent group-hover:bg-[var(--pc-accent-soft)]"
                                  onPointerDown={(event) => beginClipDrag(event, track.id, clip, "start")}
                                  aria-label="Trim start"
                                />
                                <span
                                  className="pc-trim-handle absolute inset-y-0 right-0 w-2 bg-transparent group-hover:bg-[var(--pc-accent-soft)]"
                                  onPointerDown={(event) => beginClipDrag(event, track.id, clip, "end")}
                                  aria-label="Trim end"
                                />
                              </>
                            ) : null}
                          </div>
                        );
                      })}
                  </div>
                </div>
                {/* Keyframe lanes for the selected layer, under its track */}
                {index === composition.tracks.findIndex((candidate) => candidate.clips.some((clip) => clip.id === selectedLayer?.clipId))
                  ? keyframeLanes.map((lane) => (
                      <div key={lane.property} className="flex" style={{ height: ROW_HEIGHT.keyframes }}>
                        {!compact ? (
                          <div className="sticky left-0 z-20 flex shrink-0 items-center border-b border-r border-border bg-card pl-5 pr-2" style={{ width: HEADER_WIDTH }}>
                            <span className="truncate font-mono text-[10px] text-muted-foreground">{lane.property}</span>
                          </div>
                        ) : null}
                        <div className="relative flex-1 border-b border-border bg-background/40">
                          {lane.keyframes.map((keyframe) => {
                            const dragging = keyframeDrag?.property === lane.property && keyframeDrag.fromMs === keyframe.atMs;
                            const atMs = dragging ? keyframeDrag.toMs : keyframe.atMs;
                            return (
                              <button
                                key={`${lane.property}-${keyframe.atMs}`}
                                type="button"
                                title={`${lane.property} = ${Math.round(keyframe.value * 100) / 100} @ ${Math.round(keyframe.atMs)} ms · ${typeof keyframe.easing === "string" ? keyframe.easing : "custom"}`}
                                onPointerDown={(event) => beginKeyframeDrag(event, lane.property, keyframe.atMs, lane.base)}
                                className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] bg-pc-accent shadow-[0_0_0_1.5px_var(--pc-track)] hover:scale-125"
                                style={{ left: (lane.base + atMs) * pxPerMs }}
                              />
                            );
                          })}
                        </div>
                      </div>
                    ))
                  : null}
              </div>
            );
          })}

          {/* Playhead line */}
          <div className="pointer-events-none absolute bottom-0 z-20 w-px bg-pc-playhead" style={{ top: RULER_HEIGHT, left: (compact ? 0 : HEADER_WIDTH) + playheadX, transform: "translateX(-0.5px)" }} />
        </div>
      </div>
    </div>
  );
}

function ToolButton({ children, label, onClick, disabled, primary }: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "pc-press pc-touch-target flex size-8 shrink-0 items-center justify-center rounded-md disabled:opacity-40",
        primary ? "bg-pc-accent text-pc-on-accent hover:opacity-90" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ToggleButton({ children, label, onClick, active }: { children: React.ReactNode; label: string; onClick: () => void; active: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={cn("pc-press pc-touch-target flex h-8 min-w-8 shrink-0 items-center justify-center rounded-md px-1.5", active ? "bg-pc-accent-soft text-pc-accent" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
    >
      {children}
    </button>
  );
}

function TrackToggle({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="pc-press flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground">
      {children}
    </button>
  );
}
