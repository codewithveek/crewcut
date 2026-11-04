import { callAction } from "@agent-native/core/client/hooks";
import { type Composition, clipEndMs, frameToMs, msToFrame } from "@proofcut/composition";
import { toast } from "sonner";
import { create } from "zustand";

import { errorMessage } from "@/lib/proofcut";

export type TimecodeMode = "ms" | "frames";

export interface LayerRef {
  clipId: string;
  layerId: string;
}

interface EditorState {
  videoId: string;
  composition: Composition | null;
  version: number;
  assetUrls: Record<string, string>;
  versions: Array<{ version: number; label: string; authorKind: string; createdAt: string }>;
  /** Session undo/redo over server versions (each edit is one version). */
  undoStack: number[];
  redoStack: number[];
  playheadMs: number;
  playing: boolean;
  /** Pixels per second on the timeline. */
  zoom: number;
  inMs: number | null;
  outMs: number | null;
  timecodeMode: TimecodeMode;
  snapping: boolean;
  ripple: boolean;
  selectedClipIds: string[];
  selectedLayer: LayerRef | null;
  saving: number;
  agentWorking: boolean;

  load(input: { videoId: string; composition: Composition; version: number; assetUrls: Record<string, string>; versions: EditorState["versions"] }): void;
  setPlayhead(ms: number): void;
  stepFrames(frames: number): void;
  setPlaying(playing: boolean): void;
  setZoom(pxPerSecond: number): void;
  setInOut(edge: "in" | "out", ms: number | null): void;
  toggleTimecodeMode(): void;
  toggleSnapping(): void;
  toggleRipple(): void;
  selectClip(clipId: string | null, additive?: boolean): void;
  selectLayer(ref: LayerRef | null): void;
  /**
   * Applies an edit optimistically with the same pure function the server
   * runs, then calls the action and adopts the server's version.
   */
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
  versions: EditorState["versions"];
}

export const useEditor = create<EditorState>((set, get) => ({
  videoId: "",
  composition: null,
  version: 0,
  assetUrls: {},
  versions: [],
  undoStack: [],
  redoStack: [],
  playheadMs: 0,
  playing: false,
  zoom: 80,
  inMs: null,
  outMs: null,
  timecodeMode: "ms",
  snapping: true,
  ripple: false,
  selectedClipIds: [],
  selectedLayer: null,
  saving: 0,
  agentWorking: false,

  load: ({ videoId, composition, version, assetUrls, versions }) =>
    set((state) => ({
      videoId,
      composition,
      version,
      assetUrls,
      versions,
      undoStack: state.videoId === videoId && state.undoStack.length ? state.undoStack : [version],
      redoStack: state.videoId === videoId ? state.redoStack : [],
      playheadMs: state.videoId === videoId ? Math.min(state.playheadMs, composition.durationMs) : 0,
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
  setZoom: (pxPerSecond) => set({ zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pxPerSecond)) }),
  setInOut: (edge, ms) => set(edge === "in" ? { inMs: ms } : { outMs: ms }),
  toggleTimecodeMode: () => set((state) => ({ timecodeMode: state.timecodeMode === "ms" ? "frames" : "ms" })),
  toggleSnapping: () => set((state) => ({ snapping: !state.snapping })),
  toggleRipple: () => set((state) => ({ ripple: !state.ripple })),
  selectClip: (clipId, additive) =>
    set((state) => {
      if (!clipId) return { selectedClipIds: [], selectedLayer: null };
      if (additive) {
        const has = state.selectedClipIds.includes(clipId);
        return { selectedClipIds: has ? state.selectedClipIds.filter((id) => id !== clipId) : [...state.selectedClipIds, clipId] };
      }
      return { selectedClipIds: [clipId], selectedLayer: state.selectedLayer?.clipId === clipId ? state.selectedLayer : null };
    }),
  selectLayer: (ref) => set((state) => ({ selectedLayer: ref, selectedClipIds: ref ? [ref.clipId] : state.selectedClipIds })),

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
    set((state) => ({ saving: state.saving + 1 }));
    try {
      const result = (await callAction(action as never, { videoId, ...args, returnFull: true } as never)) as { version: number; composition?: Composition };
      set((state) => ({
        version: result.version,
        ...(result.composition ? { composition: result.composition } : {}),
        undoStack: [...state.undoStack, result.version],
        redoStack: [],
      }));
      void get().refresh();
      return true;
    } catch (error) {
      set({ composition: previous });
      toast.error(errorMessage(error));
      return false;
    } finally {
      set((state) => ({ saving: state.saving - 1 }));
    }
  },

  restore: async (version, direction = "jump") => {
    const { videoId } = get();
    set((state) => ({ saving: state.saving + 1 }));
    try {
      const result = (await callAction("restore-composition-version" as never, { videoId, version, returnFull: true } as never)) as { version: number; composition?: Composition };
      set((state) => ({
        version: result.version,
        ...(result.composition ? { composition: result.composition } : {}),
        ...(direction === "jump" ? { undoStack: [...state.undoStack, version], redoStack: [] } : {}),
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
      // Adopt newer server versions (e.g. the agent edited while we watched).
      if (result.version >= get().version && get().saving === 0) {
        set({ composition: result.composition, version: result.version, assetUrls: result.assetUrls, versions: result.versions });
      } else {
        set({ versions: result.versions, assetUrls: result.assetUrls });
      }
    } catch {
      // Offline or transient: keep the local state.
    }
  },
}));

/** The clip under the playhead on the main (first visual) track. */
export function clipAtPlayhead(composition: Composition, playheadMs: number): string | null {
  const track = composition.tracks.find((candidate) => candidate.kind === "visual");
  const clip = track?.clips.find((candidate) => playheadMs >= candidate.startMs && playheadMs < clipEndMs(candidate));
  return clip?.id ?? null;
}
