import { writeClientAppState } from "@agent-native/core/client/application-state";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { type Composition, deleteClips, findLayer, nudgeLayers, setMarker, splitClip } from "@proofcut/composition";
import { IconAdjustmentsHorizontal, IconArrowLeft, IconMessageCircle, IconSparkles } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { askAgent, prefillAgent } from "@/lib/proofcut";
import { TAB_ID } from "@/lib/tab-id";
import { cn } from "@/lib/utils";

import { SkeletonLines } from "../primitives";
import { clipAtPlayhead, useEditor } from "./editor-store";
import { Inspector } from "./inspector";
import { Preview } from "./preview";
import { SceneTree } from "./scene-tree";
import { Timeline } from "./timeline";

type Layout = "phone" | "tablet" | "laptop" | "desktop";

function useLayout(): Layout {
  const [layout, setLayout] = useState<Layout>("laptop");
  useEffect(() => {
    const pick = () => {
      const width = window.innerWidth;
      setLayout(width < 640 ? "phone" : width < 1024 ? "tablet" : width < 1536 ? "laptop" : "desktop");
    };
    pick();
    window.addEventListener("resize", pick);
    return () => window.removeEventListener("resize", pick);
  }, []);
  return layout;
}

interface CompositionPayload {
  version: number;
  composition: Composition | null;
  assetUrls: Record<string, string>;
  versions: Array<{ version: number; label: string; authorKind: string; createdAt: string }>;
}

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(element && (element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)));
}

/** Keyboard: no animation on keyboard-driven actions (frame steps, cuts jump instantly). */
function useEditorKeys() {
  const shuttle = useRef<{ rate: number; frame: number | null }>({ rate: 0, frame: null });
  useEffect(() => {
    const stopShuttle = () => {
      if (shuttle.current.frame !== null) cancelAnimationFrame(shuttle.current.frame);
      shuttle.current = { rate: 0, frame: null };
    };
    const runShuttle = (rate: number) => {
      stopShuttle();
      shuttle.current.rate = rate;
      let last = performance.now();
      const tick = (now: number) => {
        const state = useEditor.getState();
        state.setPlayhead(state.playheadMs + (now - last) * shuttle.current.rate);
        last = now;
        shuttle.current.frame = requestAnimationFrame(tick);
      };
      shuttle.current.frame = requestAnimationFrame(tick);
    };
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      const state = useEditor.getState();
      const composition = state.composition;
      if (!composition) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key;
      if (mod && key.toLowerCase() === "z") {
        event.preventDefault();
        void (event.shiftKey ? state.redo() : state.undo());
        return;
      }
      if (mod && key.toLowerCase() === "y") {
        event.preventDefault();
        void state.redo();
        return;
      }
      if (mod) return;
      // Nudge the selected layer: Alt+arrows (1 px), Alt+Shift (10 px).
      if (event.altKey && state.selectedLayer && key.startsWith("Arrow")) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const dxPx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
        const dyPx = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
        const op = { op: "nudge-layers" as const, targets: [state.selectedLayer], dxPx, dyPx };
        void state.commit("edit-composition", { label: `Nudge ${state.selectedLayer.layerId}`, ops: [op] }, (c) => nudgeLayers(c, op));
        return;
      }
      switch (key) {
        case " ":
          event.preventDefault();
          stopShuttle();
          state.setPlaying(!state.playing);
          break;
        case "ArrowLeft":
          event.preventDefault();
          state.setPlaying(false);
          if (event.shiftKey) state.setPlayhead(state.playheadMs - 1000);
          else state.stepFrames(-1);
          break;
        case "ArrowRight":
          event.preventDefault();
          state.setPlaying(false);
          if (event.shiftKey) state.setPlayhead(state.playheadMs + 1000);
          else state.stepFrames(1);
          break;
        case "j":
        case "J":
          state.setPlaying(false);
          runShuttle(shuttle.current.rate < 0 ? Math.max(-8, shuttle.current.rate * 2) : -1);
          break;
        case "k":
        case "K":
          stopShuttle();
          state.setPlaying(false);
          break;
        case "l":
        case "L":
          if (shuttle.current.rate > 0) runShuttle(Math.min(8, shuttle.current.rate * 2));
          else {
            stopShuttle();
            state.setPlaying(true);
          }
          break;
        case "i":
        case "I":
          state.setInOut("in", Math.round(state.playheadMs));
          break;
        case "o":
        case "O":
          state.setInOut("out", Math.round(state.playheadMs));
          break;
        case "Home":
          state.setPlayhead(0);
          break;
        case "End":
          state.setPlayhead(composition.durationMs);
          break;
        case "s":
        case "S": {
          const clipId = state.selectedClipIds[0] ?? clipAtPlayhead(composition, state.playheadMs);
          if (!clipId) break;
          const input = { clipId, atMs: Math.round(state.playheadMs) };
          void state.commit("split-clip", input, (c) => splitClip(c, input).composition);
          break;
        }
        case "m":
        case "M": {
          const op = { op: "set-marker" as const, atMs: Math.round(state.playheadMs), label: "" };
          void state.commit("edit-composition", { label: "Add marker", ops: [op] }, (c) => setMarker(c, op));
          break;
        }
        case "Delete":
        case "Backspace": {
          if (state.selectedClipIds.length === 0) break;
          event.preventDefault();
          const input = { clipIds: state.selectedClipIds, ripple: event.shiftKey || state.ripple };
          void state.commit("delete-clips", input, (c) => deleteClips(c, input));
          state.selectClip(null);
          break;
        }
        case "+":
        case "=":
          state.setZoom(state.zoom * 1.5);
          break;
        case "-":
          state.setZoom(state.zoom / 1.5);
          break;
        case "Escape":
          state.selectClip(null);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      stopShuttle();
    };
  }, []);
}

/** The agent sees the selection, playhead and range, so "tighten this" needs no explanation of where. */
function usePublishSelection() {
  const videoId = useEditor((state) => state.videoId);
  const selectedClipIds = useEditor((state) => state.selectedClipIds);
  const selectedLayer = useEditor((state) => state.selectedLayer);
  const playheadMs = useEditor((state) => state.playheadMs);
  const playing = useEditor((state) => state.playing);
  const inMs = useEditor((state) => state.inMs);
  const outMs = useEditor((state) => state.outMs);
  const version = useEditor((state) => state.version);
  useEffect(() => {
    if (!videoId || playing) return;
    const timer = window.setTimeout(() => {
      void writeClientAppState(
        "editor-selection",
        { view: "editor", videoId, compositionVersion: version, selectedClipIds, selectedLayer, playheadMs: Math.round(playheadMs), inMs, outMs },
        { requestSource: TAB_ID },
      ).catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [videoId, selectedClipIds, selectedLayer, playheadMs, playing, inMs, outMs, version]);
}

function AgentButton({ floating }: { floating?: boolean }) {
  const videoId = useEditor((state) => state.videoId);
  const describeSelection = () => {
    const state = useEditor.getState();
    const composition = state.composition;
    const layer = state.selectedLayer && composition ? composition.tracks.flatMap((track) => (track.kind === "visual" ? track.clips : [])).find((clip) => clip.id === state.selectedLayer?.clipId) : undefined;
    const layerInfo = layer && state.selectedLayer ? findLayer(layer, state.selectedLayer.layerId) : null;
    return {
      videoId,
      compositionVersion: state.version,
      playheadMs: Math.round(state.playheadMs),
      selectedClipIds: state.selectedClipIds,
      selectedLayer: state.selectedLayer ? { ...state.selectedLayer, type: layerInfo?.layer.type } : null,
      range: state.inMs !== null || state.outMs !== null ? { inMs: state.inMs, outMs: state.outMs } : null,
    };
  };
  const ask = () => prefillAgent(describeSelection());
  if (floating) {
    return (
      <button
        type="button"
        onClick={() => askAgent("Look at what I've selected in the editor and suggest one improvement.", describeSelection())}
        className="pc-press fixed bottom-[max(16px,env(safe-area-inset-bottom))] right-4 z-50 flex size-14 items-center justify-center rounded-full bg-pc-accent text-pc-on-accent shadow-xl"
        aria-label="Ask the agent about the selection"
      >
        <IconMessageCircle className="size-6" />
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      {(["Tighten this", "Make the hook punchier", "Try a different transition"] as const).map((prompt) => (
        <Button key={prompt} size="xs" variant="ghost" className="pc-press hidden xl:inline-flex" onClick={() => askAgent(`${prompt}. Apply it as one undoable step with edit-composition.`, describeSelection())}>
          {prompt}
        </Button>
      ))}
      <Button size="sm" variant="secondary" className="pc-press" onClick={ask}>
        <IconSparkles className="size-4" />
        Ask about selection
      </Button>
    </div>
  );
}

export function EditorPage({ videoId }: { videoId: string }) {
  const layout = useLayout();
  const [params] = useSearchParams();
  const query = useActionQuery("get-composition", { videoId } as never);
  const composition = useEditor((state) => state.composition);
  const loadedFor = useEditor((state) => state.videoId);
  const [timelineHeight, setTimelineHeight] = useState(300);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [burnCaptions, setBurnCaptions] = useState(true);
  useEditorKeys();
  usePublishSelection();

  useEffect(() => {
    const payload = query.data as CompositionPayload | undefined;
    if (!payload?.composition) return;
    const state = useEditor.getState();
    if (state.videoId !== videoId || payload.version > state.version) {
      state.load({ videoId, composition: payload.composition, version: payload.version, assetUrls: payload.assetUrls, versions: payload.versions });
      const at = Number(params.get("t"));
      if (Number.isFinite(at) && at > 0) state.setPlayhead(at);
    }
  }, [query.data, videoId, params]);

  useEffect(() => {
    setTimelineHeight(layout === "desktop" ? 360 : layout === "phone" ? 200 : 300);
  }, [layout]);

  const payload = query.data as CompositionPayload | undefined;
  if (query.isLoading) {
    return (
      <div className="p-6">
        <SkeletonLines count={5} />
      </div>
    );
  }
  if (!payload?.composition) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <p className="text-sm text-muted-foreground">This video has no composition yet.</p>
        <Button asChild variant="secondary" className="mt-4">
          <Link to={`/videos/${videoId}`}>Back to the pipeline</Link>
        </Button>
      </div>
    );
  }
  if (!composition || loadedFor !== videoId) return null;

  const header = (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
      <Link to={`/videos/${videoId}`} className="pc-press flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Back to the pipeline">
        <IconArrowLeft className="size-4" />
      </Link>
      <h1 className="min-w-0 flex-1 truncate text-[14px] font-medium text-foreground">{composition.title}</h1>
      <label className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
        <input type="checkbox" checked={burnCaptions} onChange={(event) => setBurnCaptions(event.target.checked)} className="accent-[var(--pc-accent)]" />
        Captions
      </label>
      {layout !== "phone" ? <AgentButton /> : null}
      {layout === "phone" || layout === "tablet" ? (
        <Button size="icon-sm" variant="ghost" aria-label="Inspector" onClick={() => setInspectorOpen(true)}>
          <IconAdjustmentsHorizontal className="size-4" />
        </Button>
      ) : null}
    </header>
  );

  const resizeHandle = (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize timeline"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp") setTimelineHeight((height) => Math.min(640, height + 24));
        if (event.key === "ArrowDown") setTimelineHeight((height) => Math.max(140, height - 24));
      }}
      onPointerDown={(event) => {
        const startY = event.clientY;
        const startHeight = timelineHeight;
        const move = (moveEvent: PointerEvent) => setTimelineHeight(Math.min(window.innerHeight * 0.7, Math.max(140, startHeight - (moveEvent.clientY - startY))));
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
      className="group flex h-2 shrink-0 cursor-row-resize items-center justify-center"
    >
      <span className="h-1 w-10 rounded-full bg-border group-hover:bg-muted-foreground/60" />
    </div>
  );

  const inspectorSheet = (
    <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}>
      <SheetContent side={layout === "phone" ? "bottom" : "right"} className={cn("p-0", layout === "phone" ? "max-h-[70dvh]" : "w-[340px]")}>
        <SheetTitle className="sr-only">Inspector</SheetTitle>
        <SheetDescription className="sr-only">Edit the selected clip or layer.</SheetDescription>
        <Inspector className="max-h-[70dvh]" />
      </SheetContent>
    </Sheet>
  );

  if (layout === "phone") {
    return (
      <div className="flex h-full min-h-dvh w-full min-w-0 flex-col overflow-hidden bg-pc-canvas sm:min-h-0">
        {header}
        <Preview className="h-[40dvh] shrink-0 p-2" burnCaptions={burnCaptions} />
        <div className="pc-safe-bottom min-h-0 min-w-0 flex-1">
          <Timeline compact height={timelineHeight} />
        </div>
        {inspectorSheet}
        <AgentButton floating />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col bg-pc-canvas">
      {header}
      <div className={cn("grid min-h-0 flex-1 gap-2 p-2", layout === "tablet" ? "grid-cols-1" : "grid-cols-[240px_minmax(0,1fr)_300px]")}>
        {layout !== "tablet" ? <SceneTree className="pc-panel min-h-0" /> : null}
        <Preview className="min-h-0 rounded-xl" burnCaptions={burnCaptions} />
        {layout !== "tablet" ? <Inspector className="pc-panel min-h-0" /> : null}
      </div>
      {resizeHandle}
      <div className="mx-2 mb-2 shrink-0 overflow-hidden pc-panel" style={{ height: timelineHeight }}>
        <Timeline height={timelineHeight} />
      </div>
      {layout === "tablet" ? inspectorSheet : null}
    </div>
  );
}
