import { callAction } from "@agent-native/core/client/hooks";
import {
  type ClipboardClip,
  type Composition,
  type CompositionOpInput,
  type LayerDraft,
  applyCompositionOps,
  clipEndMs,
  frameToMs,
  msToFrame,
} from "@crewcut/composition";
import { toast } from "sonner";
import { create } from "zustand";

import { errorMessage } from "@/lib/crewcut";
import { TAB_ID } from "@/lib/tab-id";

export const PLAYBACK_RATES: readonly number[] = [0.25, 0.5, 1, 1.5, 2];

/** Per-browser editor preferences. Storage can be missing or blocked (private windows), so every access is guarded. */
const PREFERENCE_KEY = "crewcut:editor-preferences";
function readPreference<T>(name: string, fallback: T, valid: (value: unknown) => boolean): T {
  try {
    const value = (JSON.parse(window.localStorage.getItem(PREFERENCE_KEY) ?? "{}") as Record<string, unknown>)[name];
    return valid(value) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}
function writePreference(name: string, value: unknown) {
  try {
    const stored = JSON.parse(window.localStorage.getItem(PREFERENCE_KEY) ?? "{}") as Record<string, unknown>;
    window.localStorage.setItem(PREFERENCE_KEY, JSON.stringify({ ...stored, [name]: value }));
  } catch {
    // Not remembered; the setting still applies for this visit.
  }
}

export type TimecodeMode = "ms" | "frames";

export interface LayerRef {
  clipId: string;
  layerId: string;
}

export type LeftTab = "media" | "audio" | "text" | "captions" | "elements" | "effects" | "transitions" | "filters";
export type Tool = "select" | "blade";

export type Clipboard = { kind: "clips"; items: ClipboardClip[] } | { kind: "layers"; layers: LayerDraft[] } | null;

interface VersionEntry {
  version: number;
  label: string;
  authorKind: string;
  createdAt: string;
}

interface EditorState {
  videoId: string;
  composition: Composition | null;
  /** The composition before a live preview (slider drag, canvas drag) started. */
  previewBase: Composition | null;
  version: number;
  assetUrls: Record<string, string>;
  versions: VersionEntry[];
  lastSavedAt: number | null;
  /** Session undo/redo over server versions (each edit is one version). */
  undoStack: number[];
  redoStack: number[];
  playheadMs: number;
  playing: boolean;
  /** Preview speed and loop (the export is unaffected); remembered in this browser. */
  playbackRate: number;
  loopPlayback: boolean;
  /** Pixels per second on the timeline. */
  zoom: number;
  inMs: number | null;
  outMs: number | null;
  timecodeMode: TimecodeMode;
  snapping: boolean;
  ripple: boolean;
  tool: Tool;
  selectedClipIds: string[];
  selectedLayer: LayerRef | null;
  saving: number;
  clipboard: Clipboard;
  leftTab: LeftTab;
  leftOpen: boolean;
  inspectorTab: string | null;
  burnCaptions: boolean;
  fullscreen: boolean;
  /** Right panel on desktop/tablet; the assistant sheet on phones. */
  rightTab: "properties" | "assistant";
  assistantOpen: boolean;

  load(input: { videoId: string; composition: Composition; version: number; assetUrls: Record<string, string>; versions: VersionEntry[] }): void;
  setPlayhead(ms: number): void;
  stepFrames(frames: number): void;
  setPlaying(playing: boolean): void;
  setPlaybackRate(rate: number): void;
  setLoopPlayback(on: boolean): void;
  setZoom(pxPerSecond: number): void;
  setInOut(edge: "in" | "out", ms: number | null): void;
  toggleTimecodeMode(): void;
  toggleSnapping(): void;
  toggleRipple(): void;
  setTool(tool: Tool): void;
  selectClip(clipId: string | null, additive?: boolean): void;
  selectClips(clipIds: string[]): void;
  selectLayer(ref: LayerRef | null): void;
  setClipboard(clipboard: Clipboard): void;
  setLeftTab(tab: LeftTab): void;
  setLeftOpen(open: boolean): void;
  setInspectorTab(tab: string | null): void;
  setBurnCaptions(on: boolean): void;
  setFullscreen(on: boolean): void;
  setRightTab(tab: "properties" | "assistant"): void;
  setAssistantOpen(open: boolean): void;
  mergeAssetUrls(urls: Record<string, string>): void;
  /** Shows ops live without saving (dragging a slider or a layer). */
  preview(ops: CompositionOpInput[]): void;
  cancelPreview(): void;
  /** Applies ops optimistically, saves them as one version, adopts the server's result. */
  commitOps(label: string, ops: CompositionOpInput[]): Promise<boolean>;
  /** Legacy single-action commit (split-clip, trim-clip…). */
  commit(action: string, args: Record<string, unknown>, optimistic?: (composition: Composition) => Composition): Promise<boolean>;
  restore(version: number, direction?: "undo" | "redo" | "jump"): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  refresh(): Promise<void>;
}

export const MIN_ZOOM = 4;
export const MAX_ZOOM = 2400;

interface CompositionResponse {
  version: number;
  composition: Composition | null;
  assetUrls: Record<string, string>;
  versions: VersionEntry[];
}

/**
 * Editor writes carry this tab's id as their request source, so this tab's
 * database sync ignores the change events of its own edits (it already has the
 * result) instead of re-reading the whole composition after every edit.
 * Other tabs and the agent's edits still sync as before.
 */
function editorWrite<T>(action: string, args: Record<string, unknown>): Promise<T> {
  return callAction(action as never, args as never, { headers: { "X-Request-Source": TAB_ID } } as never) as Promise<T>;
}

/** A link this tab already has stays in use while it's valid, so media doesn't reload because a re-read signed it again. */
function keepValidUrls(current: Record<string, string>, incoming: Record<string, string>): Record<string, string> {
  const soon = Date.now() + 2 * 60_000;
  const merged = { ...incoming };
  for (const [id, url] of Object.entries(current)) {
    if (!(id in incoming)) continue;
    const expires = Number(/[?&]exp=(\d+)/.exec(url)?.[1] ?? Number.POSITIVE_INFINITY);
    if (expires > soon) merged[id] = url;
  }
  return merged;
}

const REFRESH_AFTER_SAVE_MS = 1200;

export const useEditor = create<EditorState>((set, get) => {
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  /** One re-read (history list, new media links) after a burst of edits, not one per edit. */
  function refreshSoon(): void {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void get().refresh();
    }, REFRESH_AFTER_SAVE_MS);
  }

  async function save(label: string, run: () => Promise<{ version: number; composition?: Composition }>, previous: Composition): Promise<boolean> {
    set((state) => ({ saving: state.saving + 1 }));
    try {
      const result = await run();
      set((state) => ({
        version: result.version,
        ...(result.composition ? { composition: result.composition } : {}),
        undoStack: [...state.undoStack, result.version],
        redoStack: [],
        lastSavedAt: Date.now(),
      }));
      refreshSoon();
      return true;
    } catch (error) {
      set({ composition: previous });
      toast.error(`${label}: ${errorMessage(error)}`);
      return false;
    } finally {
      set((state) => ({ saving: state.saving - 1 }));
    }
  }

  return {
    videoId: "",
    composition: null,
    previewBase: null,
    version: 0,
    assetUrls: {},
    versions: [],
    lastSavedAt: null,
    undoStack: [],
    redoStack: [],
    playheadMs: 0,
    playing: false,
    playbackRate: 1,
    loopPlayback: false,
    zoom: 80,
    inMs: null,
    outMs: null,
    timecodeMode: "ms",
    snapping: true,
    ripple: false,
    tool: "select",
    selectedClipIds: [],
    selectedLayer: null,
    saving: 0,
    clipboard: null,
    leftTab: "media",
    leftOpen: true,
    inspectorTab: null,
    burnCaptions: true,
    fullscreen: false,
    rightTab: "properties",
    assistantOpen: false,

    load: ({ videoId, composition, version, assetUrls, versions }) =>
      set((state) => ({
        videoId,
        composition,
        previewBase: null,
        version,
        assetUrls,
        versions,
        undoStack: state.videoId === videoId && state.undoStack.length ? state.undoStack : [version],
        redoStack: state.videoId === videoId ? state.redoStack : [],
        playbackRate: readPreference("playbackRate", state.playbackRate, (value) => typeof value === "number" && PLAYBACK_RATES.includes(value)),
        loopPlayback: readPreference("loopPlayback", state.loopPlayback, (value) => typeof value === "boolean"),
        playheadMs: state.videoId === videoId ? Math.min(state.playheadMs, composition.durationMs) : 0,
        selectedClipIds: state.videoId === videoId ? state.selectedClipIds : [],
        selectedLayer: state.videoId === videoId ? state.selectedLayer : null,
      })),

    setPlayhead: (ms) => {
      const composition = get().composition;
      const max = composition ? composition.durationMs - 1 : 0;
      set({ playheadMs: Math.max(0, Math.min(max, ms)) });
    },
    stepFrames: (frames) => {
      const composition = get().composition;
      if (!composition) return;
      const frame = msToFrame(get().playheadMs, composition.fps) + frames;
      get().setPlayhead(frameToMs(frame, composition.fps));
    },
    setPlaying: (playing) => set({ playing }),
    setPlaybackRate: (rate) => {
      writePreference("playbackRate", rate);
      set({ playbackRate: rate });
    },
    setLoopPlayback: (on) => {
      writePreference("loopPlayback", on);
      set({ loopPlayback: on });
    },
    setZoom: (pxPerSecond) => set({ zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pxPerSecond)) }),
    setInOut: (edge, ms) => set(edge === "in" ? { inMs: ms } : { outMs: ms }),
    toggleTimecodeMode: () => set((state) => ({ timecodeMode: state.timecodeMode === "ms" ? "frames" : "ms" })),
    toggleSnapping: () => set((state) => ({ snapping: !state.snapping })),
    toggleRipple: () => set((state) => ({ ripple: !state.ripple })),
    setTool: (tool) => set({ tool }),
    selectClip: (clipId, additive) =>
      set((state) => {
        if (!clipId) return { selectedClipIds: [], selectedLayer: null, inspectorTab: null };
        if (additive) {
          const has = state.selectedClipIds.includes(clipId);
          return { selectedClipIds: has ? state.selectedClipIds.filter((id) => id !== clipId) : [...state.selectedClipIds, clipId], selectedLayer: null };
        }
        const sameClip = state.selectedClipIds.length === 1 && state.selectedClipIds[0] === clipId;
        return { selectedClipIds: [clipId], selectedLayer: state.selectedLayer?.clipId === clipId ? state.selectedLayer : null, inspectorTab: sameClip ? state.inspectorTab : null };
      }),
    selectClips: (clipIds) => set({ selectedClipIds: clipIds, selectedLayer: null, inspectorTab: null }),
    selectLayer: (ref) =>
      set((state) => ({
        selectedLayer: ref,
        selectedClipIds: ref ? [ref.clipId] : state.selectedClipIds,
        inspectorTab: ref && state.selectedLayer?.layerId === ref.layerId ? state.inspectorTab : null,
      })),
    setClipboard: (clipboard) => set({ clipboard }),
    setLeftTab: (tab) => set({ leftTab: tab, leftOpen: true }),
    setLeftOpen: (open) => set({ leftOpen: open }),
    setInspectorTab: (tab) => set({ inspectorTab: tab }),
    setBurnCaptions: (on) => set({ burnCaptions: on }),
    setFullscreen: (on) => set({ fullscreen: on }),
    setRightTab: (tab) => set({ rightTab: tab }),
    setAssistantOpen: (open) => set({ assistantOpen: open }),
    mergeAssetUrls: (urls) => set((state) => ({ assetUrls: { ...state.assetUrls, ...urls } })),

    preview: (ops) => {
      const base = get().previewBase ?? get().composition;
      if (!base) return;
      try {
        set({ previewBase: base, composition: applyCompositionOps(base, ops) });
      } catch {
        // A transiently invalid value mid-drag: keep the last good frame.
      }
    },
    cancelPreview: () => {
      const base = get().previewBase;
      if (base) set({ composition: base, previewBase: null });
    },

    commitOps: async (label, ops) => {
      const base = get().previewBase ?? get().composition;
      const { videoId } = get();
      set({ previewBase: null });
      if (!base || ops.length === 0) return false;
      let next: Composition;
      try {
        next = applyCompositionOps(base, ops);
      } catch (error) {
        set({ composition: base });
        toast.error(errorMessage(error));
        return false;
      }
      set({ composition: next });
      return save(label, () => editorWrite<{ version: number; composition?: Composition }>("edit-composition", { videoId, label, ops, returnFull: true }), base);
    },

    commit: async (action, args, optimistic) => {
      const { composition, videoId } = get();
      if (!composition) return false;
      const previous = composition;
      if (optimistic) {
        try {
          set({ composition: optimistic(composition) });
        } catch (error) {
          toast.error(errorMessage(error));
          return false;
        }
      }
      return save(action, () => editorWrite<{ version: number; composition?: Composition }>(action, { videoId, ...args, returnFull: true }), previous);
    },

    restore: async (version, direction = "jump") => {
      const { videoId } = get();
      set((state) => ({ saving: state.saving + 1 }));
      try {
        const result = await editorWrite<{ version: number; composition?: Composition }>("restore-composition-version", { videoId, version, returnFull: true });
        set((state) => ({
          version: result.version,
          ...(result.composition ? { composition: result.composition } : {}),
          ...(direction === "jump" ? { undoStack: [...state.undoStack, version], redoStack: [] } : {}),
          lastSavedAt: Date.now(),
        }));
        void get().refresh();
      } catch (error) {
        toast.error(errorMessage(error));
      } finally {
        set((state) => ({ saving: state.saving - 1 }));
      }
    },

    undo: async () => {
      const { undoStack, redoStack } = get();
      if (undoStack.length < 2) return;
      const current = undoStack[undoStack.length - 1] as number;
      const target = undoStack[undoStack.length - 2] as number;
      set({ undoStack: undoStack.slice(0, -1), redoStack: [...redoStack, current] });
      await get().restore(target, "undo");
    },

    redo: async () => {
      const { undoStack, redoStack } = get();
      const target = redoStack[redoStack.length - 1];
      if (target === undefined) return;
      set({ redoStack: redoStack.slice(0, -1), undoStack: [...undoStack, target] });
      await get().restore(target, "redo");
    },

    refresh: async () => {
      const { videoId } = get();
      if (!videoId) return;
      try {
        const result = (await callAction("get-composition" as never, { videoId } as never, { method: "GET" } as never)) as CompositionResponse;
        if (!result.composition) return;
        // Adopt newer server versions (e.g. the agent edited while we watched), never mid-drag.
        if (result.version >= get().version && get().saving === 0 && !get().previewBase) {
          set((state) => ({ composition: result.composition, version: result.version, assetUrls: keepValidUrls(state.assetUrls, result.assetUrls), versions: result.versions }));
        } else {
          set((state) => ({ versions: result.versions, assetUrls: keepValidUrls(state.assetUrls, { ...state.assetUrls, ...result.assetUrls }) }));
        }
      } catch {
        // Offline or transient: keep the local state.
      }
    },
  };
});

/** The clip under the playhead on the main (first visual) track. */
export function clipAtPlayhead(composition: Composition, playheadMs: number): string | null {
  const track = composition.tracks.find((candidate) => candidate.kind === "visual");
  const clip = track?.clips.find((candidate) => playheadMs >= candidate.startMs && playheadMs < clipEndMs(candidate));
  return clip?.id ?? null;
}

// Dev builds expose the store so browser tests can assert on editor state.
if (import.meta.env?.DEV && typeof window !== "undefined") {
  (window as unknown as { __crewcutEditor?: typeof useEditor }).__crewcutEditor = useEditor;
}
