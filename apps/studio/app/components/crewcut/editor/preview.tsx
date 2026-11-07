import {
  ASPECT_RATIOS,
  ASPECT_RATIO_INFO,
  type Composition,
  type Layer,
  type LeafLayer,
  type VisualClip,
  durationInFrames,
  findClip,
  findLayer,
  formatTimecode,
  frameToMs,
  msToFrame,
} from "@crewcut/composition";
import { CrewcutVideo, captionAnchor, loadCrewcutFonts } from "@crewcut/renderer";
import { Player, type PlayerRef } from "@remotion/player";
import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconBadgeCc,
  IconChevronDown,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerSkipBack,
  IconPlayerSkipForward,
} from "@tabler/icons-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ContextMenu, ContextMenuTrigger, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger, IconButton } from "@/components/ds";
import { errorMessage } from "@/lib/crewcut";
import { cn } from "@/lib/utils";

import { currentSelection, describeSelection, replaceLayerMedia, setFormat, transformOps } from "./commands";
import { LayerMenu } from "./context-menus";
import { dropFiles, dropPayload } from "./drop";
import { useEditor } from "./editor-store";
import { dragPayload, hasFiles, isCrewcutDrag, uploadMedia } from "./media";

/**
 * The live preview is the exact component the render worker draws, so what
 * the editor shows is what exports. A transparent overlay on top handles
 * selection, dragging, scaling and rotating layers directly on the canvas.
 */

function useFitted(box: { width: number; height: number }, aspect: number) {
  if (box.width <= 0 || box.height <= 0) return { width: 0, height: 0 };
  return box.width / box.height > aspect ? { width: box.height * aspect, height: box.height } : { width: box.width, height: box.width / aspect };
}

/** Ratio glyph: a small box drawn in the format's proportions. */
export function RatioGlyph({ ratio, className }: { ratio: string; className?: string }) {
  const [w, h] = ratio.split(":").map(Number) as [number, number];
  const scale = 14 / Math.max(w, h);
  return <span aria-hidden className={cn("inline-block shrink-0 rounded-[2px] border-[1.5px] border-current", className)} style={{ width: Math.max(6, w * scale), height: Math.max(6, h * scale) }} />;
}

export function RatioMenu({ compact }: { compact?: boolean }) {
  const ratio = useEditor((state) => state.composition?.ratio ?? "16:9");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`Aspect ratio ${ratio}`} className="pc-press flex h-8 items-center gap-1.5 rounded-ds-sm px-2 text-xs font-medium tabular text-ds-text-2 outline-none hover:bg-ds-surface-3 hover:text-ds-text focus-visible:ring-2 focus-visible:ring-ds-accent">
          <RatioGlyph ratio={ratio} />
          {compact ? null : ratio}
          <IconChevronDown className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[230px]">
        <DropdownMenuLabel>Aspect ratio</DropdownMenuLabel>
        {ASPECT_RATIOS.map((option) => (
          <DropdownMenuItem key={option} onSelect={() => option !== ratio && setFormat(option)} icon={<RatioGlyph ratio={option} className={option === ratio ? "text-ds-accent" : ""} />}>
            <span className={cn("w-10 font-medium tabular pr-1", option === ratio && "text-ds-accent")}>{option}</span>
            <span className="text-ds-text-3">{ASPECT_RATIO_INFO[option].use}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Canvas overlay ──────────────────────────────────────────────────────────

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function selectedLayerTarget(composition: Composition | null): { clip: VisualClip; layer: Layer | LeafLayer } | null {
  const { selectedClipIds, selectedLayer } = useEditor.getState();
  const selection = describeSelection(composition, selectedClipIds, selectedLayer);
  return selection.kind === "layer" ? { clip: selection.clip, layer: selection.layer } : null;
}

/** Topmost layer element under a point inside the player, with its clip. */
/** The caption cue whose on-screen box contains the point (captions ignore pointer events, so test by rect). */
function captionAtPoint(stage: HTMLElement, x: number, y: number): string | null {
  for (const element of stage.querySelectorAll<HTMLElement>("[data-caption-box]")) {
    const rect = element.getBoundingClientRect();
    if (x >= rect.left - 6 && x <= rect.right + 6 && y >= rect.top - 6 && y <= rect.bottom + 6) return element.dataset.captionBox ?? null;
  }
  return null;
}

/** "image" / "video" when the hit layer holds media (drop-to-replace), else null. */
function mediaLayerAt(hit: { clipId: string; layerId: string }): "image" | "video" | null {
  const composition = useEditor.getState().composition;
  const location = composition ? findClip(composition, hit.clipId) : null;
  const found = location && "layers" in location.clip ? findLayer(location.clip, hit.layerId) : null;
  return found && (found.layer.type === "image" || found.layer.type === "video") ? found.layer.type : null;
}

function layerAtPoint(stage: HTMLElement, x: number, y: number): { clipId: string; layerId: string } | null {
  for (const element of document.elementsFromPoint(x, y)) {
    if (!stage.contains(element)) continue;
    const layerElement = (element as HTMLElement).closest<HTMLElement>("[data-layer-id]");
    const clipElement = layerElement?.closest<HTMLElement>("[data-clip-id]");
    if (layerElement?.dataset.layerId && clipElement?.dataset.clipId) return { clipId: clipElement.dataset.clipId, layerId: layerElement.dataset.layerId };
  }
  return null;
}

const CanvasOverlay = memo(function CanvasOverlay({ stageRef, frame }: { stageRef: React.RefObject<HTMLDivElement | null>; frame: { width: number; height: number } }) {
  const composition = useEditor((state) => state.composition);
  const selectedLayer = useEditor((state) => state.selectedLayer);
  const selectedClipIds = useEditor((state) => state.selectedClipIds);
  const playing = useEditor((state) => state.playing);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [guides, setGuides] = useState<{ x: boolean; y: boolean }>({ x: false, y: false });
  const [menuTarget, setMenuTarget] = useState<{ clip: VisualClip; layer: Layer | LeafLayer } | null>(null);
  const selection = describeSelection(composition, selectedClipIds, selectedLayer);
  const target = selection.kind === "layer" ? selection : null;
  const targetId = target?.layer.id;
  const captionId = selection.kind === "caption" ? selection.clip.id : null;
  const measureSelector = targetId ? `[data-layer-id="${CSS.escape(targetId)}"]` : captionId ? `[data-caption-box="${CSS.escape(captionId)}"]` : null;

  // Track the selected layer's (or caption's) on-screen box every frame (it may animate).
  useEffect(() => {
    if (!measureSelector || playing) {
      setBox(null);
      return;
    }
    let frameId = 0;
    const measure = () => {
      const stage = stageRef.current;
      const overlay = overlayRef.current;
      const element = stage?.querySelector<HTMLElement>(measureSelector);
      if (overlay && element) {
        const o = overlay.getBoundingClientRect();
        const r = element.getBoundingClientRect();
        setBox((previous) => {
          const next = { left: r.left - o.left, top: r.top - o.top, width: r.width, height: r.height };
          return previous && Math.abs(previous.left - next.left) < 0.5 && Math.abs(previous.top - next.top) < 0.5 && Math.abs(previous.width - next.width) < 0.5 && Math.abs(previous.height - next.height) < 0.5 ? previous : next;
        });
      } else {
        setBox(null);
      }
      frameId = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(frameId);
  }, [measureSelector, playing, stageRef]);

  /** Drag captions anywhere: moves the caption anchor (positionX/positionY) for the whole track. */
  const beginCaptionMove = (event: React.PointerEvent, cueId: string) => {
    const editor = useEditor.getState();
    const composition = editor.composition;
    const track = composition?.tracks.find((candidate) => candidate.kind === "caption");
    if (!composition || !track || track.kind !== "caption") return;
    editor.selectClip(cueId);
    if (track.locked) return;
    const origin = captionAnchor(track.style, composition.height > composition.width);
    const startX = event.clientX;
    const startY = event.clientY;
    let latest = { positionX: origin.x, positionY: origin.y };
    let moved = false;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 3) return;
      moved = true;
      let x = Math.max(5, Math.min(95, origin.x + ((moveEvent.clientX - startX) / frame.width) * 100));
      let y = Math.max(4, Math.min(96, origin.y + ((moveEvent.clientY - startY) / frame.height) * 100));
      const snap = !moveEvent.altKey && useEditor.getState().snapping;
      const snapX = snap && Math.abs(x - 50) < 1.2;
      const snapY = snap && Math.abs(y - 50) < 1.2;
      if (snapX) x = 50;
      if (snapY) y = 50;
      setGuides({ x: snapX, y: snapY });
      latest = { positionX: Math.round(x * 10) / 10, positionY: Math.round(y * 10) / 10 };
      useEditor.getState().preview([{ op: "set-caption-style", style: latest }]);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setGuides({ x: false, y: false });
      if (moved) void useEditor.getState().commitOps("Move captions", [{ op: "set-caption-style", style: latest }]);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const beginMove = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const stage = stageRef.current;
    const editor = useEditor.getState();
    if (!stage || !editor.composition) return;
    editor.setPlaying(false);
    // Captions draw above every layer, so they win the hit test.
    const cueId = captionAtPoint(stage, event.clientX, event.clientY);
    if (cueId) {
      beginCaptionMove(event, cueId);
      return;
    }
    const hit = layerAtPoint(stage, event.clientX, event.clientY);
    const current = selectedLayerTarget(editor.composition);
    // Keep dragging the current selection when the press lands inside its box.
    const insideCurrent = current && box && event.clientX - (overlayRef.current?.getBoundingClientRect().left ?? 0) >= box.left && event.clientX - (overlayRef.current?.getBoundingClientRect().left ?? 0) <= box.left + box.width && event.clientY - (overlayRef.current?.getBoundingClientRect().top ?? 0) >= box.top && event.clientY - (overlayRef.current?.getBoundingClientRect().top ?? 0) <= box.top + box.height;
    const ref = insideCurrent ? { clipId: current.clip.id, layerId: current.layer.id } : hit;
    if (!ref) {
      editor.selectClip(null);
      return;
    }
    if (!insideCurrent) editor.selectLayer(ref);
    const location = findClip(editor.composition, ref.clipId);
    if (!location || !("layers" in location.clip) || location.track.locked) return;
    const layer = findLayer(location.clip, ref.layerId)?.layer;
    if (!layer || layer.locked) return;
    const clip = location.clip;
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { x: layer.transform.x, y: layer.transform.y };
    let latest = origin;
    let moved = false;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      const dx = ((moveEvent.clientX - startX) / frame.width) * 100;
      const dy = ((moveEvent.clientY - startY) / frame.height) * 100;
      if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 3) return;
      moved = true;
      let x = origin.x + dx;
      let y = origin.y + dy;
      const snap = !moveEvent.altKey && useEditor.getState().snapping;
      const snapX = snap && Math.abs(x - 50) < 1.2;
      const snapY = snap && Math.abs(y - 50) < 1.2;
      if (snapX) x = 50;
      if (snapY) y = 50;
      setGuides({ x: snapX, y: snapY });
      latest = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
      useEditor.getState().preview(transformOps(clip, layer, latest));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setGuides({ x: false, y: false });
      if (moved) void useEditor.getState().commitOps(`Move ${layer.name ?? layer.type}`, transformOps(clip, layer, latest));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const beginHandle = (event: React.PointerEvent, kind: "scale" | "rotate") => {
    event.stopPropagation();
    if (captionId && box && overlayRef.current) {
      // Caption corners resize the caption text (track-wide size, 16–160 design px).
      const track = useEditor.getState().composition?.tracks.find((candidate) => candidate.kind === "caption");
      if (!track || track.kind !== "caption" || track.locked) return;
      const overlay = overlayRef.current.getBoundingClientRect();
      const center = { x: overlay.left + box.left + box.width / 2, y: overlay.top + box.top + box.height / 2 };
      const startDistance = Math.max(4, Math.hypot(event.clientX - center.x, event.clientY - center.y));
      const startSize = track.style.size;
      let size = startSize;
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
      const move = (moveEvent: PointerEvent) => {
        size = Math.round(Math.max(16, Math.min(160, startSize * (Math.hypot(moveEvent.clientX - center.x, moveEvent.clientY - center.y) / startDistance))));
        useEditor.getState().preview([{ op: "set-caption-style", style: { size } }]);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        if (size !== startSize) void useEditor.getState().commitOps("Caption size", [{ op: "set-caption-style", style: { size } }]);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      return;
    }
    if (!target || !box || !overlayRef.current) return;
    const { clip, layer } = target;
    const overlay = overlayRef.current.getBoundingClientRect();
    const center = { x: overlay.left + box.left + box.width / 2, y: overlay.top + box.top + box.height / 2 };
    const startDistance = Math.max(4, Math.hypot(event.clientX - center.x, event.clientY - center.y));
    const startAngle = Math.atan2(event.clientY - center.y, event.clientX - center.x);
    const startScale = layer.transform.scale;
    const startRotation = layer.transform.rotation;
    let latest: Record<string, number> = {};
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      if (kind === "scale") {
        const ratio = Math.hypot(moveEvent.clientX - center.x, moveEvent.clientY - center.y) / startDistance;
        latest = { scale: Math.round(Math.max(0.05, Math.min(10, startScale * ratio)) * 1000) / 1000 };
      } else {
        let rotation = startRotation + ((Math.atan2(moveEvent.clientY - center.y, moveEvent.clientX - center.x) - startAngle) * 180) / Math.PI;
        if (moveEvent.shiftKey) rotation = Math.round(rotation / 15) * 15;
        latest = { rotation: Math.round(rotation * 10) / 10 };
      }
      useEditor.getState().preview(transformOps(clip, layer, latest));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (Object.keys(latest).length) void useEditor.getState().commitOps(kind === "scale" ? "Scale layer" : "Rotate layer", transformOps(clip, layer, latest));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (!open) return;
        setMenuTarget(selectedLayerTarget(useEditor.getState().composition));
      }}
    >
      <ContextMenuTrigger asChild>
        <div
          ref={overlayRef}
          className="absolute inset-0 z-10 touch-none select-none"
          onPointerDown={beginMove}
          onContextMenu={(event) => {
            const stage = stageRef.current;
            if (!stage) return;
            const hit = layerAtPoint(stage, event.clientX, event.clientY);
            if (hit) useEditor.getState().selectLayer(hit);
          }}
          onDoubleClick={() => {
            const selected = currentSelection();
            if (selected.kind === "layer" && selected.layer.type === "text") {
              useEditor.getState().setInspectorTab("text");
              window.dispatchEvent(new CustomEvent("crewcut:edit-text"));
            }
            if (selected.kind === "caption") {
              useEditor.getState().setRightTab("properties");
              useEditor.getState().setInspectorTab("caption");
              if (window.innerWidth < 1024) useEditor.getState().setAssistantOpen(false);
              window.dispatchEvent(new CustomEvent("crewcut:edit-caption"));
            }
          }}
        >
          {guides.x ? <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-ds-accent" /> : null}
          {guides.y ? <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-ds-accent" /> : null}
          {box && (target || captionId) ? (
            <div className="pointer-events-none absolute" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
              <div className="absolute inset-0 rounded-[2px] shadow-[0_0_0_1.5px_var(--ds-accent),0_0_0_3px_rgb(0_0_0/0.25)]" />
              {!(target?.layer.locked)
                ? (["nw", "ne", "sw", "se"] as const).map((corner) => (
                    <span
                      key={corner}
                      role="slider"
                      aria-label={captionId ? "Caption size" : "Scale"}
                      aria-valuenow={target ? target.layer.transform.scale : undefined}
                      onPointerDown={(event) => beginHandle(event, "scale")}
                      className="pointer-events-auto absolute size-3 rounded-full bg-white shadow-[0_0_0_1.5px_var(--ds-accent)] [@media(pointer:coarse)]:size-5"
                      style={{
                        left: corner.endsWith("w") ? -6 : undefined,
                        right: corner.endsWith("e") ? -6 : undefined,
                        top: corner.startsWith("n") ? -6 : undefined,
                        bottom: corner.startsWith("s") ? -6 : undefined,
                        cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize",
                      }}
                    />
                  ))
                : null}
              {target && !target.layer.locked ? (
                <span
                  role="slider"
                  aria-label="Rotate"
                  aria-valuenow={target.layer.transform.rotation}
                  onPointerDown={(event) => beginHandle(event, "rotate")}
                  className="pointer-events-auto absolute left-1/2 -top-7 flex size-4 -translate-x-1/2 cursor-grab items-center justify-center rounded-full bg-white shadow-[0_0_0_1.5px_var(--ds-accent)] [@media(pointer:coarse)]:size-6"
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </ContextMenuTrigger>
      {menuTarget ? <LayerMenu clip={menuTarget.clip} layer={menuTarget.layer} /> : null}
    </ContextMenu>
  );
});

// ── Stage ───────────────────────────────────────────────────────────────────

export function PreviewStage({ className, interactive = true, playerRefOut }: { className?: string; interactive?: boolean; playerRefOut?: React.MutableRefObject<PlayerRef | null> }) {
  const composition = useEditor((state) => state.composition);
  const assetUrls = useEditor((state) => state.assetUrls);
  const playheadMs = useEditor((state) => state.playheadMs);
  const playing = useEditor((state) => state.playing);
  const burnCaptions = useEditor((state) => state.burnCaptions);
  const playerRef = useRef<PlayerRef>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [dropping, setDropping] = useState(false);
  const fromPlayer = useRef(false);

  useEffect(() => {
    void loadCrewcutFonts();
  }, []);

  useEffect(() => {
    if (playerRefOut) playerRefOut.current = playerRef.current;
  });

  useEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fps = composition?.fps ?? 30;
  // Player → store while playing.
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onFrame = (event: { detail: { frame: number } }) => {
      fromPlayer.current = true;
      useEditor.getState().setPlayhead(frameToMs(event.detail.frame, fps));
    };
    const onPause = () => useEditor.getState().setPlaying(false);
    const onPlay = () => useEditor.getState().setPlaying(true);
    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("pause", onPause);
    player.addEventListener("ended", onPause);
    player.addEventListener("play", onPlay);
    return () => {
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("pause", onPause);
      player.removeEventListener("ended", onPause);
      player.removeEventListener("play", onPlay);
    };
  }, [fps, box.width > 0]);

  // Store → player when the playhead is moved by hand (and once the player mounts).
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    if (fromPlayer.current) {
      fromPlayer.current = false;
      return;
    }
    if (!player.isPlaying()) player.seekTo(msToFrame(playheadMs, fps));
  }, [playheadMs, fps, box.width > 0]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    if (playing && !player.isPlaying()) player.play();
    if (!playing && player.isPlaying()) player.pause();
  }, [playing]);

  const inputProps = useMemo(() => (composition ? { composition, assetUrls, options: { burnCaptions } } : null), [composition, assetUrls, burnCaptions]);
  const fitted = useFitted(box, composition ? composition.width / composition.height : 16 / 9);
  if (!composition || !inputProps) return <div className={cn("pc-skeleton", className)} />;

  const onDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    setDropping(false);
    const atMs = useEditor.getState().playheadMs;
    const stage = stageRef.current;
    const hit = stage ? layerAtPoint(stage, event.clientX, event.clientY) : null;
    const hitLayer = hit ? mediaLayerAt(hit) : null;
    if (hasFiles(event)) {
      const file = event.dataTransfer.files[0];
      // One photo/video dropped onto a photo/video swaps it (template spots); anything else adds media.
      if (hit && hitLayer && event.dataTransfer.files.length === 1 && file && file.type.startsWith(hitLayer === "image" ? "image/" : "video/")) {
        try {
          const asset = await uploadMedia(file, { videoId: useEditor.getState().videoId });
          await replaceLayerMedia(hit, asset);
        } catch (error) {
          toast.error(errorMessage(error));
        }
        return;
      }
      await dropFiles(event.dataTransfer.files, { atMs, surface: "preview" });
      return;
    }
    const payload = dragPayload(event);
    if (payload?.type === "asset" && hit && hitLayer && payload.asset.mediaType === hitLayer) {
      await replaceLayerMedia(hit, payload.asset);
      return;
    }
    if (payload) await dropPayload(payload, { atMs, surface: "preview" });
  };

  return (
    <div
      ref={boxRef}
      className={cn("relative flex min-h-0 min-w-0 items-center justify-center overflow-hidden", className)}
      onDragOver={(event) => {
        if (!interactive) return;
        if (!hasFiles(event) && !isCrewcutDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(event) => void onDrop(event)}
    >
      {fitted.width > 0 ? (
        <div ref={stageRef} className={cn("relative overflow-hidden bg-black shadow-[0_24px_60px_-28px_rgb(0_0_0/0.6),0_0_0_1px_var(--ds-hairline)]", dropping && "ring-2 ring-ds-accent")} style={{ width: fitted.width, height: fitted.height }}>
          <Player
            ref={playerRef}
            component={CrewcutVideo}
            inputProps={inputProps}
            durationInFrames={durationInFrames(composition.durationMs, composition.fps)}
            fps={composition.fps}
            compositionWidth={composition.width}
            compositionHeight={composition.height}
            style={{ width: "100%", height: "100%" }}
            initialFrame={msToFrame(playheadMs, composition.fps)}
            controls={false}
            clickToPlay={false}
            acknowledgeRemotionLicense
            initiallyShowControls={false}
          />
          {interactive ? <CanvasOverlay stageRef={stageRef} frame={fitted} /> : null}
        </div>
      ) : null}
    </div>
  );
}

// ── Transport ───────────────────────────────────────────────────────────────

export function Timecode({ className, showTotal = true }: { className?: string; showTotal?: boolean }) {
  const playheadMs = useEditor((state) => state.playheadMs);
  const composition = useEditor((state) => state.composition);
  const mode = useEditor((state) => state.timecodeMode);
  if (!composition) return null;
  return (
    <button type="button" onClick={() => useEditor.getState().toggleTimecodeMode()} title="Switch between milliseconds and frames" className={cn("whitespace-nowrap font-mono text-xs tabular text-ds-text outline-none hover:text-ds-accent", className)}>
      {formatTimecode(playheadMs, { fps: composition.fps, mode })}
      {showTotal ? <span className="text-ds-text-3"> / {formatTimecode(composition.durationMs, { fps: composition.fps, mode })}</span> : null}
    </button>
  );
}

export function PlayButton({ size = "md", variant = "solid" }: { size?: "md" | "lg"; variant?: "solid" | "glass" }) {
  const playing = useEditor((state) => state.playing);
  return (
    <IconButton label={playing ? "Pause" : "Play"} shortcut="Space" variant={variant} size={size === "lg" ? "lg" : "md"} className="rounded-full" onClick={() => useEditor.getState().setPlaying(!playing)}>
      {playing ? <IconPlayerPause className="fill-current" /> : <IconPlayerPlay className="fill-current" />}
    </IconButton>
  );
}

export function useFullscreen(targetRef: React.RefObject<HTMLElement | null>) {
  const fullscreen = useEditor((state) => state.fullscreen);
  useEffect(() => {
    const sync = () => {
      if (!document.fullscreenElement && useEditor.getState().fullscreen) useEditor.getState().setFullscreen(false);
    };
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const enter = useCallback(async () => {
    useEditor.getState().selectClip(null);
    useEditor.getState().setFullscreen(true);
    const element = targetRef.current;
    try {
      if (element?.requestFullscreen) await element.requestFullscreen({ navigationUI: "hide" });
      // Phones: turn landscape videos sideways when the browser allows it.
      const composition = useEditor.getState().composition;
      const orientation = screen.orientation as ScreenOrientation & { lock?: (orientation: string) => Promise<void> };
      if (composition && composition.width > composition.height && orientation?.lock) await orientation.lock("landscape").catch(() => undefined);
    } catch {
      // No Fullscreen API (iOS Safari): the CSS theatre mode below still fills the screen.
    }
  }, [targetRef]);
  const exit = useCallback(async () => {
    useEditor.getState().setFullscreen(false);
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    screen.orientation?.unlock?.();
  }, []);
  return { fullscreen, enter, exit, toggle: () => void (fullscreen ? exit() : enter()) };
}

/** Bottom controls shown over the video in fullscreen; they fade after 2.5 s without movement. */
export function FullscreenControls({ onExit }: { onExit: () => void }) {
  const composition = useEditor((state) => state.composition);
  const playheadMs = useEditor((state) => state.playheadMs);
  const playing = useEditor((state) => state.playing);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    let timer = window.setTimeout(() => setVisible(false), 2500);
    const wake = () => {
      setVisible(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => useEditor.getState().playing && setVisible(false), 2500);
    };
    window.addEventListener("pointermove", wake);
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);
  if (!composition) return null;
  const show = visible || !playing;
  return (
    <div className={cn("absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 to-transparent px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-10 text-white transition-opacity duration-300", show ? "opacity-100" : "pointer-events-none opacity-0")}>
      <input
        type="range"
        aria-label="Seek"
        min={0}
        max={composition.durationMs}
        step={1000 / composition.fps}
        value={playheadMs}
        onChange={(event) => {
          useEditor.getState().setPlaying(false);
          useEditor.getState().setPlayhead(Number(event.target.value));
        }}
        className="h-1.5 w-full cursor-pointer accent-white"
      />
      <div className="mt-2 flex items-center gap-3">
        <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={() => useEditor.getState().setPlaying(!playing)} className="pc-press flex size-11 items-center justify-center rounded-full bg-white/15 backdrop-blur">
          {playing ? <IconPlayerPause className="size-5 fill-current" /> : <IconPlayerPlay className="size-5 fill-current" />}
        </button>
        <span className="font-mono text-sm tabular">
          {formatTimecode(playheadMs, { fps: composition.fps }).slice(3, 8)} <span className="text-white/60">/ {formatTimecode(composition.durationMs, { fps: composition.fps }).slice(3, 8)}</span>
        </span>
        <button type="button" aria-label="Exit full screen" onClick={onExit} className="pc-press ml-auto flex size-11 items-center justify-center rounded-full bg-white/15 backdrop-blur">
          <IconArrowsMinimize className="size-5" />
        </button>
      </div>
    </div>
  );
}

/** Desktop preview: the stage plus the transport bar under it (image-2 layout). */
export function PreviewPanel({ className, dense }: { className?: string; dense?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { fullscreen, toggle, exit } = useFullscreen(containerRef);
  const burnCaptions = useEditor((state) => state.burnCaptions);
  const hasCaptions = useEditor((state) => Boolean(state.composition?.tracks.some((track) => track.kind === "caption" && track.clips.length > 0)));
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && useEditor.getState().fullscreen) void exit();
    };
    const onToggle = () => toggle();
    window.addEventListener("keydown", onKey);
    window.addEventListener("crewcut:toggle-fullscreen", onToggle);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("crewcut:toggle-fullscreen", onToggle);
    };
  }, [exit, toggle]);
  return (
    <div className={cn("flex min-h-0 min-w-0 flex-col", className)}>
      <div ref={containerRef} className={cn("relative flex min-h-0 flex-1 bg-ds-stage", fullscreen ? "fixed inset-0 z-[300] bg-black" : "rounded-ds-lg")}>
        <PreviewStage className={cn("min-h-0 flex-1", fullscreen ? "p-0" : dense ? "p-2" : "p-4")} interactive={!fullscreen} />
        {fullscreen ? <FullscreenControls onExit={() => void exit()} /> : null}
      </div>
      <div className={cn("flex shrink-0 items-center gap-2 px-2", dense ? "h-10" : "h-12")}>
        <div className="flex min-w-0 flex-1 items-center">
          <Timecode className="truncate rounded-ds-sm bg-ds-surface-2 px-2 py-1" />
        </div>
        <div className="flex items-center gap-1">
          <IconButton label="Previous frame" shortcut="←" onClick={() => useEditor.getState().stepFrames(-1)}>
            <IconPlayerSkipBack />
          </IconButton>
          <PlayButton />
          <IconButton label="Next frame" shortcut="→" onClick={() => useEditor.getState().stepFrames(1)}>
            <IconPlayerSkipForward />
          </IconButton>
        </div>
        <div className="flex flex-1 items-center justify-end gap-1">
          {hasCaptions ? (
            <IconButton label={burnCaptions ? "Hide captions" : "Show captions"} active={burnCaptions} onClick={() => useEditor.getState().setBurnCaptions(!burnCaptions)}>
              <IconBadgeCc />
            </IconButton>
          ) : null}
          <RatioMenu />
          <IconButton label={fullscreen ? "Exit full screen" : "Full screen"} shortcut="F" onClick={toggle}>
            {fullscreen ? <IconArrowsMinimize /> : <IconArrowsMaximize />}
          </IconButton>
        </div>
      </div>
    </div>
  );
}

