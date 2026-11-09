import {
  type AnimatableProperty,
  type AnyClip,
  type Composition,
  type Track,
  type Transition,
  type VisualClip,
  clipEndMs,
  collectSnapTargets,
  durationInFrames,
  findClip,
  findLayer,
  formatTimecode,
  frameToMs,
  nearestFreeStart,
  snapSpan,
  snapTime,
  trimBounds,
  trackGaps,
  TRANSITION_CATALOG,
} from "@crewcut/composition";
import { CrewcutVideo } from "@crewcut/renderer";
import { Thumbnail } from "@remotion/player";
import {
  IconArrowBackUp,
  IconArrowBarToLeft,
  IconArrowBarToRight,
  IconArrowForwardUp,
  IconArrowsExchange,
  IconBadgeCc,
  IconBookmark,
  IconColumns3,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconLayoutBottombarCollapse,
  IconLayoutBottombarExpand,
  IconLock,
  IconLockOpen,
  IconMagnet,
  IconMicrophone,
  IconMusic,
  IconPhoto,
  IconPlus,
  IconPointer,
  IconScissors,
  IconSparkles,
  IconTrash,
  IconTypography,
  IconVolume,
  IconVolumeOff,
  IconWaveSine,
  IconZoomIn,
  IconZoomOut,
} from "@tabler/icons-react";
import { type ReactNode, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  ContextMenu,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Slider,
} from "@/components/ds";
import { cn } from "@/lib/utils";

import { addTrack, clipKind, deleteSelection, duplicateSelection, newId, run, snapCutsToBeat, soloLayer, splitAtPlayhead, toggleTrack, trackSpecOf, trimToPlayhead } from "./commands";
import { ClipMenu, LaneMenu, TrackMenu } from "./context-menus";
import { dropFiles, dropPayload } from "./drop";
import { MAX_ZOOM, MIN_ZOOM, useEditor } from "./editor-store";
import { dragPayload, hasFiles, isCrewcutDrag, usePeaks, useVideoFrames } from "./media";

const HEADER_WIDTH = 176;
const SNAP_PX = 8;
const KEYFRAME_LANE = 22;

type Variant = "desktop" | "mobile";

export type Density = "regular" | "compact";

function laneHeight(track: Track, isMain: boolean, variant: Variant, density: Density = "regular"): number {
  if (variant === "mobile") return isMain ? 56 : track.kind === "audio" ? 36 : 34;
  if (density === "compact") {
    // Short screens (768–820 px tall): every row gives the preview a little more room.
    if (isMain) return 50;
    if (track.kind === "caption") return 28;
    if (track.kind === "audio") return track.role === "voice" ? 36 : 32;
    return 34;
  }
  if (isMain) return 64;
  if (track.kind === "caption") return 34;
  if (track.kind === "audio") return track.role === "voice" ? 46 : 40;
  return 44;
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

/** Visual tracks are listed top layer first (as in CapCut); captions on top, audio below. */
export function displayTracks(composition: Composition): Array<{ track: Track; isMain: boolean }> {
  const mainId = composition.tracks.find((track) => track.kind === "visual")?.id;
  const captions = composition.tracks.filter((track) => track.kind === "caption");
  const visual = composition.tracks.filter((track) => track.kind === "visual").reverse();
  const audio = composition.tracks.filter((track) => track.kind === "audio");
  return [...captions, ...visual, ...audio].map((track) => ({ track, isMain: track.id === mainId }));
}

const CLIP_COLOR: Record<ReturnType<typeof clipKind>, string> = {
  media: "bg-kind-media",
  text: "bg-kind-text",
  graphic: "bg-kind-graphic",
  caption: "bg-kind-caption",
  voice: "bg-kind-voice",
  music: "bg-kind-music",
  sfx: "bg-kind-sfx",
};

// ── Clip content ────────────────────────────────────────────────────────────

const Waveform = memo(function Waveform({ peaks, estimated }: { peaks: readonly number[]; estimated?: boolean }) {
  if (peaks.length === 0) return null;
  return (
    <svg className={cn("pointer-events-none absolute inset-x-0 bottom-0 h-[70%] w-full text-white/70", estimated && "opacity-50")} viewBox={`0 0 ${peaks.length} 100`} preserveAspectRatio="none" aria-hidden>
      {peaks.map((peak, index) => {
        const height = Math.max(3, peak * 96);
        return <rect key={index} x={index + 0.15} y={100 - height} width={0.7} height={height} fill="currentColor" />;
      })}
    </svg>
  );
});

function AudioContent({ clip, width }: { clip: Extract<AnyClip, { src: string }>; width: number }) {
  const assetUrls = useEditor((state) => state.assetUrls);
  const url = clip.src.startsWith("asset:") ? assetUrls[clip.src.slice(6)] : null;
  const decoded = usePeaks(url, clip.trimStartMs, clip.durationMs, clip.playbackRate, width / 3);
  const peaks = decoded ?? clip.peaks;
  return <Waveform peaks={peaks} estimated={clip.src.startsWith("estimated:")} />;
}

function MediaContent({ clip, width, height }: { clip: VisualClip; width: number; height: number }) {
  const assetUrls = useEditor((state) => state.assetUrls);
  const layer = soloLayer(clip);
  const src = layer && (layer.type === "image" || layer.type === "video") ? layer.src : "";
  const url = src.startsWith("asset:") ? assetUrls[src.slice(6)] : /^https?:/.test(src) ? src : null;
  const tile = Math.max(24, Math.round(height * 1.6));
  const count = Math.max(1, Math.min(10, Math.ceil(width / tile)));
  const times = useMemo(() => {
    if (layer?.type !== "video") return [];
    return Array.from({ length: count }, (_, index) => layer.trimStartMs + ((index + 0.5) / count) * clip.durationMs * layer.playbackRate);
  }, [layer, count, clip.durationMs]);
  const frames = useVideoFrames(layer?.type === "video" ? url : null, times, Math.round(height * 2));
  if (!url) return null;
  if (layer?.type === "image") {
    return <div className="pointer-events-none absolute inset-0 opacity-90" style={{ backgroundImage: `url("${url}")`, backgroundSize: `auto 100%`, backgroundRepeat: "repeat-x" }} />;
  }
  return (
    <div className="pointer-events-none absolute inset-0 flex opacity-90">
      {frames.map((frame, index) => (frame ? <img key={index} src={frame} alt="" className="h-full shrink-0 object-cover" style={{ width: tile }} draggable={false} /> : <span key={index} className="h-full shrink-0 bg-white/5" style={{ width: tile }} />))}
    </div>
  );
}

/** A frame of a motion-graphics clip, drawn by the real renderer (memoised per clip). */
const SceneThumb = memo(
  function SceneThumb({ clip, composition, height }: { clip: VisualClip; composition: Composition; height: number }) {
    const assetUrls = useEditor((state) => state.assetUrls);
    const mini = useMemo<Composition>(
      () => ({
        ...composition,
        durationMs: clip.durationMs,
        markers: [],
        tracks: [{ id: "thumb", name: "thumb", kind: "visual", hidden: false, locked: false, muted: true, clips: [{ ...clip, startMs: 0, transitionIn: undefined }] }],
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [JSON.stringify(clip), composition.width, composition.height, composition.fps, JSON.stringify(composition.brief)],
    );
    const width = Math.round((height * composition.width) / composition.height);
    return (
      <div className="pointer-events-none absolute inset-y-0 left-0 overflow-hidden" style={{ width }}>
        <Thumbnail
          component={CrewcutVideo}
          compositionWidth={composition.width}
          compositionHeight={composition.height}
          frameToDisplay={Math.min(durationInFrames(clip.durationMs, composition.fps) - 1, Math.round(((clip.durationMs * 0.6) / 1000) * composition.fps))}
          durationInFrames={durationInFrames(clip.durationMs, composition.fps)}
          fps={composition.fps}
          inputProps={{ composition: mini, assetUrls, options: { burnCaptions: false, reducedMotion: false } }}
          style={{ width, height }}
        />
      </div>
    );
  },
  (a, b) => a.clip === b.clip && a.height === b.height && a.composition.brief === b.composition.brief && a.composition.width === b.composition.width,
);

function clipLabel(clip: AnyClip, track: Track): string {
  if ("words" in clip) return clip.text;
  if ("src" in clip) return clip.text || (track.kind === "audio" ? track.role : "audio");
  const solo = soloLayer(clip);
  if (solo?.type === "text") return solo.text.replace(/\*/g, "").replace(/\n/g, " ");
  return clip.name ?? clip.id;
}

const KIND_ICON = { media: IconPhoto, text: IconTypography, graphic: IconSparkles, caption: IconBadgeCc, voice: IconMicrophone, music: IconMusic, sfx: IconWaveSine } as const;

function CaptionEditor({ clip, onDone }: { clip: Extract<AnyClip, { words: unknown }>; onDone: () => void }) {
  const [draft, setDraft] = useState(clip.text);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const save = () => {
    const text = draft.trim();
    if (text && text !== clip.text) void run("Edit caption", [{ op: "update-caption", clipId: clip.id, text }]);
    onDone();
  };
  return (
    <input
      ref={ref}
      value={draft}
      aria-label="Caption text"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") save();
        if (event.key === "Escape") onDone();
      }}
      className="absolute inset-0.5 z-10 rounded bg-white px-1.5 text-xs text-black outline-none ring-2 ring-ds-accent"
    />
  );
}

interface ClipBlockProps {
  clip: AnyClip;
  track: Track;
  composition: Composition;
  left: number;
  width: number;
  height: number;
  selected: boolean;
  ghosted: boolean;
  variant: Variant;
  /** The clip starts at a cut, whose button already shows its transition. */
  atCut: boolean;
  onPointerDown: (event: React.PointerEvent, kind: "move" | "start" | "end") => void;
}

const ClipBlock = memo(function ClipBlock({ clip, track, composition, left, width, height, selected, ghosted, variant, atCut, onPointerDown }: ClipBlockProps) {
  const kind = clipKind(clip, track);
  const Icon = KIND_ICON[kind];
  const [editing, setEditing] = useState(false);
  const [dropHover, setDropHover] = useState(false);
  const label = clipLabel(clip, track);
  const handle = variant === "mobile" ? 18 : 8;
  const showHandles = !track.locked && (variant === "desktop" || selected);
  const transition = "transitionIn" in clip ? clip.transitionIn : undefined;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-clip-id={clip.id}
          data-selected={selected ? "true" : "false"}
          data-drop={dropHover ? "true" : "false"}
          className={cn(
            "ds-clip group absolute top-[3px] bottom-[3px] overflow-hidden rounded-[7px] text-left",
            CLIP_COLOR[kind],
            ghosted && "opacity-40",
            track.hidden && "opacity-50",
            variant === "mobile" && selected && "touch-none",
          )}
          style={{ left, width }}
          onPointerDown={(event) => onPointerDown(event, "move")}
          onContextMenu={() => {
            const state = useEditor.getState();
            if (!state.selectedClipIds.includes(clip.id)) state.selectClip(clip.id);
          }}
          onDoubleClick={() => {
            if ("words" in clip) setEditing(true);
            else useEditor.getState().setPlayhead(clip.startMs);
          }}
          onDragOver={(event) => {
            const payload = dragPayload(event);
            if (!("layers" in clip) || !isCrewcutDrag(event) || (payload && !["transition", "filter", "motion"].includes(payload.type))) return;
            event.preventDefault();
            event.stopPropagation();
            setDropHover(true);
          }}
          onDragLeave={() => setDropHover(false)}
          onDrop={(event) => {
            const payload = dragPayload(event);
            if (!payload || !["transition", "filter", "motion"].includes(payload.type)) return;
            event.preventDefault();
            event.stopPropagation();
            setDropHover(false);
            void dropPayload(payload, { atMs: clip.startMs, track, clip, surface: "timeline" });
          }}
          title={`${label} · ${(clip.durationMs / 1000).toFixed(2)} s`}
        >
          {"layers" in clip && kind === "media" ? <MediaContent clip={clip} width={width} height={height - 6} /> : null}
          {"layers" in clip && kind === "graphic" && variant === "desktop" && width > 40 ? <SceneThumb clip={clip} composition={composition} height={height - 6} /> : null}
          {"src" in clip ? <AudioContent clip={clip} width={width} /> : null}
          {kind === "graphic" && width > 40 ? <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent from-30% to-[var(--clip-graphic)] to-60%" /> : null}
          <div className={cn("pointer-events-none relative flex h-full items-start gap-1.5 px-2", height > 40 ? "pt-1.5" : "items-center")} style={kind === "graphic" && width > 40 && variant === "desktop" ? { paddingLeft: Math.round(((height - 6) * composition.width) / composition.height) + 6 } : undefined}>
            {width > 34 ? <Icon className="mt-px size-3.5 shrink-0 opacity-90" /> : null}
            {width > 52 ? <span className="truncate text-[11px] font-medium leading-4 [text-shadow:0_1px_2px_rgb(0_0_0/0.4)]">{label}</span> : null}
            {width > 120 && height > 40 ? <span className="ml-auto shrink-0 rounded bg-black/30 px-1 font-mono text-[10px] tabular">{(clip.durationMs / 1000).toFixed(1)}s</span> : null}
          </div>
          {transition && !atCut ? (
            <span className="pointer-events-none absolute left-0.5 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center rounded-full bg-white text-black shadow" title={`Transition: ${TRANSITION_CATALOG[transition.type].label}`}>
              <IconArrowsExchange className="size-3" />
            </span>
          ) : null}
          {"playbackRate" in clip && clip.playbackRate !== 1 && width > 60 ? <span className="pointer-events-none absolute bottom-0.5 right-1 rounded bg-black/40 px-1 font-mono text-[9px]">{clip.playbackRate}×</span> : null}
          {editing && "words" in clip ? <CaptionEditor clip={clip} onDone={() => setEditing(false)} /> : null}
          {showHandles ? (
            <>
              <span className="pc-trim-handle absolute inset-y-0 left-0 flex items-center justify-center bg-white/0 group-hover:bg-white/25" style={{ width: handle }} onPointerDown={(event) => onPointerDown(event, "start")} aria-label="Trim start">
                {selected ? <span className="h-1/2 w-0.5 rounded-full bg-white" /> : null}
              </span>
              <span className="pc-trim-handle absolute inset-y-0 right-0 flex items-center justify-center bg-white/0 group-hover:bg-white/25" style={{ width: handle }} onPointerDown={(event) => onPointerDown(event, "end")} aria-label="Trim end">
                {selected ? <span className="h-1/2 w-0.5 rounded-full bg-white" /> : null}
              </span>
            </>
          ) : null}
        </div>
      </ContextMenuTrigger>
      <ClipMenu clip={clip} track={track} />
    </ContextMenu>
  );
});

// ── Track header ────────────────────────────────────────────────────────────

function TrackHeader({ track, isMain, height }: { track: Track; isMain: boolean; height: number }) {
  const [renaming, setRenaming] = useState(false);
  const Icon = track.kind === "caption" ? IconBadgeCc : track.kind === "audio" ? (track.role === "voice" ? IconMicrophone : track.role === "music" ? IconMusic : IconWaveSine) : isMain ? IconPhoto : IconSparkles;
  const muted = track.kind !== "caption" && Boolean((track as { muted?: boolean }).muted);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="sticky left-0 z-20 flex shrink-0 items-center gap-1 border-b border-r border-ds-border bg-ds-surface pl-2 pr-1" style={{ width: HEADER_WIDTH, height }}>
          <Icon className="size-3.5 shrink-0 text-ds-text-3" />
          {renaming ? (
            <input
              autoFocus
              defaultValue={track.name}
              aria-label="Track name"
              onBlur={(event) => {
                const name = event.target.value.trim();
                if (name && name !== track.name) void run("Rename track", [{ op: "set-track-state", trackId: track.id, patch: { name: name.slice(0, 60) } }]);
                setRenaming(false);
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                if (event.key === "Escape") setRenaming(false);
              }}
              className="h-6 min-w-0 flex-1 rounded bg-ds-surface-2 px-1 text-[12px] outline-none ring-1 ring-ds-accent"
            />
          ) : (
            <button type="button" onDoubleClick={() => setRenaming(true)} className={cn("min-w-0 flex-1 truncate text-left text-[12px] font-medium", track.hidden ? "text-ds-text-3 line-through" : "text-ds-text")} title="Double-click to rename">
              {isMain ? "Main" : track.name}
            </button>
          )}
          <IconButton size="xs" tooltip={false} label={track.locked ? "Unlock track" : "Lock track"} onClick={() => toggleTrack(track, "locked")} className={track.locked ? "text-ds-warning" : ""}>
            {track.locked ? <IconLock /> : <IconLockOpen />}
          </IconButton>
          {track.kind !== "audio" ? (
            <IconButton size="xs" tooltip={false} label={track.hidden ? "Show track" : "Hide track"} onClick={() => toggleTrack(track, "hidden")}>
              {track.hidden ? <IconEyeOff /> : <IconEye />}
            </IconButton>
          ) : null}
          {track.kind !== "caption" ? (
            <IconButton size="xs" tooltip={false} label={muted ? "Unmute track" : "Mute track"} onClick={() => toggleTrack(track, "muted")} className={muted ? "text-ds-danger" : ""}>
              {muted ? <IconVolumeOff /> : <IconVolume />}
            </IconButton>
          ) : null}
        </div>
      </ContextMenuTrigger>
      <TrackMenu track={track} />
    </ContextMenu>
  );
}

// ── Timeline ────────────────────────────────────────────────────────────────

interface DragState {
  clipId: string;
  trackId: string;
  kind: "move" | "start" | "end";
  ghost: { trackId: string; startMs: number; durationMs: number } | null;
}

/**
 * Phone lane extras, CapCut style: controls lined up against the start of
 * each lane in the half-screen before 0:00, a full-width "+ Add …" button on
 * empty lanes, and a tile after the end of a lane. They scroll with the tracks.
 */
export interface MobileLaneKit {
  lead?: (track: Track, isMain: boolean) => ReactNode;
  empty?: (track: Track, isMain: boolean) => { label: string; onSelect: () => void } | null;
  tail?: (track: Track, isMain: boolean) => ReactNode;
  /** Tapping the button on a cut between two clips (opens the transition picker for the clip after it). */
  transition?: (clipId: string) => void;
}

/** Cuts on a visual track where one clip ends right where the next begins: each gets a transition button. */
function cutsOf(track: Track): Array<{ clipId: string; atMs: number; transition: Transition | undefined }> {
  if (track.kind !== "visual") return [];
  const clips = [...track.clips].sort((a, b) => a.startMs - b.startMs);
  const cuts: Array<{ clipId: string; atMs: number; transition: Transition | undefined }> = [];
  for (let index = 1; index < clips.length; index += 1) {
    const before = clips[index - 1];
    const after = clips[index];
    if (!before || !after) continue;
    if (Math.abs(before.startMs + before.durationMs - after.startMs) <= 50) cuts.push({ clipId: after.id, atMs: after.startMs, transition: after.transitionIn });
  }
  return cuts;
}

function openTransitionPicker(clipId: string) {
  const state = useEditor.getState();
  state.selectClip(clipId);
  state.setLeftTab("transitions");
}

/**
 * An empty stretch between two clips. Hovering shows it and a trash button;
 * the button deletes the gap (the clips after it move up). Clicking the empty
 * space itself still moves the playhead, like the rest of the lane.
 */
function GapZone({ left, width, seconds, touch, onEmptyPointerDown, onDelete }: { left: number; width: number; seconds: number; touch: boolean; onEmptyPointerDown: (event: React.PointerEvent) => void; onDelete: () => void }) {
  const label = `Delete this ${seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds.toFixed(1)} s`} gap`;
  return (
    <div
      className="group/gap absolute inset-y-1 z-[1] rounded-ds-xs hover:bg-ds-surface-3/60 hover:shadow-[inset_0_0_0_1px_var(--ds-hairline)]"
      style={{ left, width }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onEmptyPointerDown(event);
      }}
    >
      <button
        type="button"
        aria-label={label}
        title={label}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        className={cn(
          "pc-press absolute left-1/2 top-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-ds-surface text-ds-text-2 shadow-[0_1px_3px_rgb(0_0_0/0.25),0_0_0_1px_var(--ds-hairline)] outline-none transition-opacity hover:bg-ds-danger hover:text-white focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ds-accent",
          touch ? "opacity-100" : "opacity-0 group-hover/gap:opacity-100",
        )}
      >
        <IconTrash className="size-3.5" />
      </button>
    </div>
  );
}

function CutButton({ left, transition, size, onOpen }: { left: number; transition: Transition | undefined; size: number; onOpen: () => void }) {
  const label = transition ? `Transition: ${TRANSITION_CATALOG[transition.type].label} (change)` : "Add a transition";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      className={cn(
        "pc-press absolute top-1/2 z-[5] flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[5px] shadow-[0_0_0_1.5px_var(--ds-surface),0_1px_3px_rgb(0_0_0/0.35)] outline-none focus-visible:ring-2 focus-visible:ring-ds-accent",
        transition ? "bg-white text-black hover:bg-ds-accent hover:text-ds-on-accent" : "bg-black/60 text-white hover:bg-white hover:text-black",
      )}
      style={{ left, width: size, height: size }}
    >
      {transition ? <IconArrowsExchange className="size-3" strokeWidth={2.2} /> : <IconPlus className="size-3" strokeWidth={2.4} />}
    </button>
  );
}

export function Timeline({
  variant = "desktop",
  className,
  density = "regular",
  collapsed = false,
  onToggleCollapse,
  mobileLanes,
}: {
  mobileLanes?: MobileLaneKit;
  variant?: Variant;
  className?: string;
  density?: Density;
  /** Collapsed: only the toolbar shows, so the preview gets the space. */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const RULER_HEIGHT = density === "compact" ? 24 : 28;
  const composition = useEditor((state) => state.composition);
  const zoom = useEditor((state) => state.zoom);
  const playheadMs = useEditor((state) => state.playheadMs);
  const playing = useEditor((state) => state.playing);
  const selectedClipIds = useEditor((state) => state.selectedClipIds);
  const selectedLayer = useEditor((state) => state.selectedLayer);
  const timecodeMode = useEditor((state) => state.timecodeMode);
  const snapping = useEditor((state) => state.snapping);
  const tool = useEditor((state) => state.tool);
  const inMs = useEditor((state) => state.inMs);
  const outMs = useEditor((state) => state.outMs);
  const editor = useEditor;
  const mobile = variant === "mobile";
  const headerWidth = mobile ? 0 : HEADER_WIDTH;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, width: 800 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [laneDrop, setLaneDrop] = useState<{ trackId: string; atMs: number } | null>(null);
  const [keyframeDrag, setKeyframeDrag] = useState<{ property: AnimatableProperty; fromMs: number; toMs: number } | null>(null);
  const [laneMenu, setLaneMenu] = useState<{ track: Track; atMs: number } | null>(null);
  const pxPerMs = zoom / 1000;
  // Phones keep the playhead fixed in the middle and scroll the tracks under it (CapCut).
  // Desktop keeps a small lead-in so the playhead's head at 0:00 isn't tucked under the track headers.
  const pad = mobile ? Math.round(view.width / 2) : 12;
  const scrollSync = useRef<"user" | "code" | null>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => setView({ left: element.scrollLeft, width: element.clientWidth });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener("scroll", update, { passive: true });
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const state = editor.getState();
      const rect = element.getBoundingClientRect();
      const pointerX = event.clientX - rect.left - headerWidth - pad;
      const atMs = (element.scrollLeft + pointerX) / (state.zoom / 1000);
      state.setZoom(state.zoom * Math.exp(-event.deltaY * 0.0025));
      requestAnimationFrame(() => {
        element.scrollLeft = Math.max(0, atMs * (editor.getState().zoom / 1000) - pointerX);
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", update);
      element.removeEventListener("wheel", onWheel);
    };
  }, [editor, headerWidth, pad]);

  // Mobile: scrolling scrubs; the playhead (when playing or moved elsewhere) drives the scroll.
  useEffect(() => {
    if (!mobile) return;
    const element = scrollRef.current;
    if (!element) return;
    const onScroll = () => {
      if (scrollSync.current === "code") {
        scrollSync.current = null;
        return;
      }
      if (editor.getState().playing) return;
      scrollSync.current = "user";
      editor.getState().setPlayhead(element.scrollLeft / (editor.getState().zoom / 1000));
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, [mobile, editor]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (mobile) {
      if (scrollSync.current === "user") {
        scrollSync.current = null;
        return;
      }
      const target = playheadMs * pxPerMs;
      if (Math.abs(element.scrollLeft - target) > 1) {
        scrollSync.current = "code";
        element.scrollLeft = target;
      }
      return;
    }
    if (!playing) return;
    const x = playheadMs * pxPerMs;
    if (x < element.scrollLeft || x > element.scrollLeft + element.clientWidth - headerWidth - 80) element.scrollLeft = Math.max(0, x - 120);
  }, [playheadMs, playing, pxPerMs, mobile, headerWidth]);

  // Pinch to zoom on touch screens.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const pointers = new Map<number, number>();
    let startDistance = 0;
    let startZoom = 0;
    const down = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      pointers.set(event.pointerId, event.clientX);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        startDistance = Math.abs((a ?? 0) - (b ?? 0));
        startZoom = editor.getState().zoom;
      }
    };
    const move = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, event.clientX);
      if (pointers.size === 2 && startDistance > 10) {
        const [a, b] = [...pointers.values()];
        editor.getState().setZoom(startZoom * (Math.abs((a ?? 0) - (b ?? 0)) / startDistance));
      }
    };
    const up = (event: PointerEvent) => pointers.delete(event.pointerId);
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
    };
  }, [editor]);

  const rows = useMemo(() => (composition ? displayTracks(composition) : []), [composition]);

  const keyframeLanes = useMemo(() => {
    if (!composition || !selectedLayer || mobile) return [];
    const location = findClip(composition, selectedLayer.clipId);
    if (!location || !("layers" in location.clip)) return [];
    const layer = findLayer(location.clip, selectedLayer.layerId)?.layer;
    if (!layer) return [];
    const base = location.clip.startMs + layer.startMs;
    return Object.entries(layer.keyframes)
      .filter(([, keys]) => keys && keys.length > 0)
      .map(([property, keys]) => ({ trackId: location.track.id, property: property as AnimatableProperty, base, keyframes: keys ?? [] }));
  }, [composition, selectedLayer, mobile]);

  const xToMs = useCallback(
    (clientX: number) => {
      const element = scrollRef.current;
      if (!element) return 0;
      const rect = element.getBoundingClientRect();
      return Math.max(0, (clientX - rect.left + element.scrollLeft - headerWidth - pad) / pxPerMs);
    },
    [pxPerMs, headerWidth, pad],
  );

  if (!composition) return null;
  const fps = composition.fps;
  const contentWidth = composition.durationMs * pxPerMs + (mobile ? 0 : 320);
  const { minor, major } = rulerSteps(pxPerMs, fps);
  const visibleStart = Math.max(0, (view.left - pad) / pxPerMs - major);
  const visibleEnd = (view.left + view.width) / pxPerMs + major;
  const ticks: Array<{ ms: number; major: boolean }> = [];
  for (let ms = Math.floor(visibleStart / minor) * minor; ms <= Math.min(visibleEnd, composition.durationMs + major * 2); ms += minor) {
    ticks.push({ ms, major: Math.abs(ms / major - Math.round(ms / major)) < 1e-6 });
    if (ticks.length > 1500) break;
  }
  const thresholdMs = SNAP_PX / pxPerMs;

  function beginScrub(event: React.PointerEvent) {
    if (mobile) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    editor.getState().setPlaying(false);
    editor.getState().setPlayhead(xToMs(event.clientX));
    const targets = collectSnapTargets(composition as Composition);
    const move = (moveEvent: PointerEvent) => {
      const raw = xToMs(moveEvent.clientX);
      editor.getState().setPlayhead(snapping && !moveEvent.altKey ? snapTime(raw, targets, thresholdMs).timeMs : raw);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function laneAt(clientX: number, clientY: number): { trackId: string } | "new" | null {
    for (const element of document.elementsFromPoint(clientX, clientY)) {
      const lane = (element as HTMLElement).closest<HTMLElement>("[data-lane-id]");
      if (lane?.dataset.laneId) return lane.dataset.laneId === "__new__" ? "new" : { trackId: lane.dataset.laneId };
    }
    return null;
  }

  function beginClipPointer(event: React.PointerEvent, track: Track, clip: AnyClip, kind: "move" | "start" | "end") {
    event.stopPropagation();
    if (event.button !== 0) return;
    const state = editor.getState();
    // Blade tool: a click cuts the clip where you click.
    if (state.tool === "blade" && kind === "move") {
      const at = Math.round(frameToMs(Math.round((xToMs(event.clientX) * fps) / 1000), fps));
      if (at > clip.startMs + 40 && at < clipEndMs(clip) - 40) void run("Split clip", [{ op: "split-clip", clipId: clip.id, atMs: at }]);
      return;
    }
    const wasSelected = state.selectedClipIds.includes(clip.id);
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      state.selectClip(clip.id, true);
      return;
    }
    if (!wasSelected) state.selectClip(clip.id);
    // On phones an unselected clip only selects; dragging then scrolls the timeline.
    if (mobile && !wasSelected) return;
    if (track.locked) return;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    const originX = event.clientX;
    const originY = event.clientY;
    let moved = false;
    let latest: { trackId: string; startMs: number; durationMs: number; newTrack: boolean; reorder?: { beforeClipId: string | null } } = { trackId: track.id, startMs: clip.startMs, durationMs: clip.durationMs, newTrack: false };
    const targets = collectSnapTargets(composition as Composition, { playheadMs: state.playheadMs, excludeClipIds: new Set([clip.id]) });
    setDrag({ clipId: clip.id, trackId: track.id, kind, ghost: null });
    const move = (moveEvent: PointerEvent) => {
      if (!moved && Math.hypot(moveEvent.clientX - originX, moveEvent.clientY - originY) < 3) return;
      moved = true;
      const deltaMs = (moveEvent.clientX - originX) / pxPerMs;
      const snap = snapping && !moveEvent.altKey;
      if (kind === "move") {
        const raw = Math.max(0, clip.startMs + deltaMs);
        const startMs = snap ? Math.max(0, snapSpan(raw, clip.durationMs, targets, thresholdMs).startMs) : raw;
        const lane = mobile ? null : laneAt(moveEvent.clientX, moveEvent.clientY);
        let trackId = track.id;
        let newTrack = false;
        if (lane === "new") newTrack = track.kind !== "caption";
        else if (lane) {
          const target = (composition as Composition).tracks.find((candidate) => candidate.id === lane.trackId);
          if (target && target.kind === track.kind && !target.locked) trackId = target.id;
        }
        // Never drop onto another clip. On the main track the clips reorder (the clip slots in at the
        // nearest cut and the rest make room); elsewhere it takes the nearest gap that fits, and on an
        // overlay track a gap more than a second away means "here", so it goes on a new track.
        let placedMs = startMs;
        let reorder: { beforeClipId: string | null } | undefined;
        if (!newTrack) {
          const target = (composition as Composition).tracks.find((candidate) => candidate.id === trackId);
          if (target) {
            const free = nearestFreeStart(target.clips, startMs, clip.durationMs, clip.id);
            const isMain = target.id === (composition as Composition).tracks.find((candidate) => candidate.kind === "visual")?.id;
            if (isMain && target.id === track.id) {
              const others = [...target.clips].filter((other) => other.id !== clip.id).sort((a, b) => a.startMs - b.startMs);
              const center = startMs + clip.durationMs / 2;
              let before = others.find((other) => other.startMs + other.durationMs / 2 > center) ?? null;
              // The Crewcut ending card stays last.
              const last = others[others.length - 1];
              if (!before && last && "recipe" in last && last.recipe === "crewcut-ending") before = last;
              reorder = { beforeClipId: before?.id ?? null };
              const oldEnd = clipEndMs(clip);
              placedMs = before
                ? before.startMs - (before.startMs >= oldEnd - 0.5 ? clip.durationMs : 0)
                : others.reduce((end, other) => Math.max(end, clipEndMs(other) - (other.startMs >= oldEnd - 0.5 ? clip.durationMs : 0)), 0);
            } else if (Math.abs(free - startMs) > 1000 && target.kind === "visual" && !isMain && !mobile) newTrack = true;
            else placedMs = free;
          }
        }
        latest = { trackId, startMs: placedMs, durationMs: clip.durationMs, newTrack, ...(reorder ? { reorder } : {}) };
      } else if (kind === "start") {
        const end = clipEndMs(clip);
        // Without "close gaps", a trim stops at the neighbouring clip instead of running into it.
        const magnetic = editor.getState().ripple || track.id === (composition as Composition).tracks.find((candidate) => candidate.kind === "visual")?.id;
        const floor = magnetic ? 0 : trimBounds(track.clips, clip.id).minStartMs;
        const raw = Math.min(end - 40, Math.max(floor, clip.startMs + deltaMs));
        const snapped = Math.max(floor, snap ? snapTime(raw, targets, thresholdMs).timeMs : raw);
        latest = { trackId: track.id, startMs: snapped, durationMs: end - snapped, newTrack: false };
      } else {
        const magnetic = editor.getState().ripple || track.id === (composition as Composition).tracks.find((candidate) => candidate.kind === "visual")?.id;
        const ceiling = magnetic ? Number.POSITIVE_INFINITY : trimBounds(track.clips, clip.id).maxEndMs;
        const raw = Math.min(ceiling, Math.max(clip.startMs + 40, clipEndMs(clip) + deltaMs));
        const snapped = Math.min(ceiling, snap ? snapTime(raw, targets, thresholdMs).timeMs : raw);
        latest = { trackId: track.id, startMs: clip.startMs, durationMs: snapped - clip.startMs, newTrack: false };
      }
      setDrag({ clipId: clip.id, trackId: track.id, kind, ghost: { trackId: latest.newTrack ? "__new__" : latest.trackId, startMs: latest.startMs, durationMs: latest.durationMs } });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDrag(null);
      if (!moved) return;
      const ripple = editor.getState().ripple;
      if (kind === "move") {
        const startMs = Math.round(latest.startMs);
        if (latest.newTrack) {
          const trackId = newId("track");
          void run("Move to a new track", [
            { op: "add-track", track: trackSpecOf(track), id: trackId },
            { op: "move-clip", clipId: clip.id, startMs, trackId },
          ]);
        } else if (latest.reorder) {
          if (startMs !== clip.startMs) void run("Reorder clip", [{ op: "reorder-clip", clipId: clip.id, beforeClipId: latest.reorder.beforeClipId }]);
        } else if (latest.trackId !== track.id) {
          void run("Move clip to another track", [{ op: "move-clip", clipId: clip.id, startMs, trackId: latest.trackId }]);
        } else if (startMs !== clip.startMs) {
          void run("Move clip", [{ op: "move-clip", clipId: clip.id, startMs }]);
        }
      } else {
        const toMs = Math.round(kind === "start" ? latest.startMs : latest.startMs + latest.durationMs);
        void run(kind === "start" ? "Trim start" : "Trim end", [{ op: "trim-clip", clipId: clip.id, edge: kind, toMs, ripple }]);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function beginKeyframeDrag(event: React.PointerEvent, property: AnimatableProperty, atMs: number, base: number) {
    event.stopPropagation();
    const ref = editor.getState().selectedLayer;
    if (!ref) return;
    editor.getState().setPlayhead(base + atMs);
    const origin = event.clientX;
    let target = atMs;
    setKeyframeDrag({ property, fromMs: atMs, toMs: atMs });
    const move = (moveEvent: PointerEvent) => {
      const raw = atMs + (moveEvent.clientX - origin) / pxPerMs;
      target = Math.round(frameToMs(Math.round((raw * fps) / 1000), fps));
      setKeyframeDrag({ property, fromMs: atMs, toMs: target });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setKeyframeDrag(null);
      if (Math.abs(target - atMs) < 1) return;
      void run(`Move ${property} keyframe`, [{ op: "move-keyframes", clipId: ref.clipId, layerId: ref.layerId, fromMs: atMs, toMs: target, property }]);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const laneHandlers = (track: Track | null) => ({
    onDragOver: (event: React.DragEvent) => {
      if (!hasFiles(event) && !isCrewcutDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setLaneDrop({ trackId: track?.id ?? "__new__", atMs: xToMs(event.clientX) });
    },
    onDragLeave: () => setLaneDrop(null),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      setLaneDrop(null);
      const atMs = xToMs(event.clientX);
      const target = { atMs, track: track ?? undefined, surface: track ? ("timeline" as const) : ("new-track" as const) };
      if (hasFiles(event)) {
        void dropFiles(event.dataTransfer.files, target);
        return;
      }
      const payload = dragPayload(event);
      if (payload) void dropPayload(payload, target);
    },
  });

  const playheadX = playheadMs * pxPerMs;
  const lanesTop = RULER_HEIGHT;

  return (
    <div className={cn("flex h-full min-h-0 w-full min-w-0 flex-col", className)}>
      {!mobile ? <TimelineToolbar density={density} collapsed={collapsed} {...(onToggleCollapse ? { onToggleCollapse } : {})} /> : null}
      <ContextMenu
        onOpenChange={(open) => {
          if (!open) setLaneMenu(null);
        }}
      >
        <ContextMenuTrigger asChild disabled={!laneMenu}>
          <div ref={scrollRef} hidden={collapsed} className={cn("pc-timeline-scroll relative min-h-0 min-w-0 flex-1 overflow-auto", mobile && "ds-no-scrollbar overflow-y-auto")} role="region" aria-label="Timeline">
            <div className="relative" style={{ width: contentWidth + headerWidth + pad * 2, minHeight: "100%" }}>
              {/* Ruler */}
              <div className="sticky top-0 z-30 flex" style={{ height: RULER_HEIGHT }}>
                {!mobile ? <div className="sticky left-0 z-40 shrink-0 border-b border-r border-ds-border bg-ds-surface" style={{ width: headerWidth }} /> : null}
                <div
                  className={cn("relative flex-1 border-b border-ds-border bg-ds-surface/95 backdrop-blur", !mobile && "cursor-col-resize")}
                  style={{ marginLeft: pad, marginRight: pad }}
                  onPointerDown={beginScrub}
                  role="slider"
                  aria-label="Playhead"
                  aria-valuemin={0}
                  aria-valuemax={composition.durationMs}
                  aria-valuenow={Math.round(playheadMs)}
                  aria-valuetext={formatTimecode(playheadMs, { fps })}
                  tabIndex={0}
                >
                  {inMs !== null || outMs !== null ? <div className="absolute inset-y-0 bg-ds-accent-soft" style={{ left: (inMs ?? 0) * pxPerMs, width: ((outMs ?? composition.durationMs) - (inMs ?? 0)) * pxPerMs }} /> : null}
                  {ticks.map((tick) => (
                    <div key={tick.ms} className="pointer-events-none absolute bottom-0" style={{ left: tick.ms * pxPerMs }}>
                      <div className={cn("w-px bg-ds-text-3/50", tick.major ? "h-2.5" : "h-1.5")} />
                      {tick.major ? <span className="absolute bottom-3 left-1 whitespace-nowrap font-mono text-[10px] tabular text-ds-text-3">{rulerLabel(tick.ms, major, fps, timecodeMode)}</span> : null}
                    </div>
                  ))}
                  {composition.markers.map((marker) => (
                    <button
                      key={marker.id}
                      type="button"
                      title={marker.label || "Marker (right-click to remove)"}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => editor.getState().setPlayhead(marker.atMs)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void run("Remove marker", [{ op: "remove-marker", id: marker.id }]);
                      }}
                      className="absolute top-0 size-0 -translate-x-1/2 border-x-[5px] border-t-[8px] border-x-transparent"
                      style={{ left: marker.atMs * pxPerMs, borderTopColor: marker.color ?? "var(--ds-warning)" }}
                    />
                  ))}
                  {!mobile ? (
                    <div className="pointer-events-none absolute top-0 z-10 -translate-x-1/2" style={{ left: playheadX }}>
                      <div className="h-3 w-3 rotate-45 rounded-[2px] bg-[var(--ds-text)]" style={{ marginTop: RULER_HEIGHT - 10 }} />
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Lanes */}
              {rows.map(({ track, isMain }) => {
                const height = laneHeight(track, isMain, variant, density);
                const isDropLane = laneDrop?.trackId === track.id;
                const ghost = drag?.ghost && drag.ghost.trackId === track.id ? drag.ghost : null;
                const lead = mobile ? mobileLanes?.lead?.(track, isMain) : null;
                const tail = mobile ? mobileLanes?.tail?.(track, isMain) : null;
                const empty = mobile && track.clips.length === 0 ? (mobileLanes?.empty?.(track, isMain) ?? null) : null;
                const cuts = track.locked ? [] : cutsOf(track);
                const cutIds = new Set(cuts.map((cut) => cut.clipId));
                return (
                  <div key={track.id}>
                    <div className="relative flex" style={{ height }}>
                      {!mobile ? <TrackHeader track={track} isMain={isMain} height={height} /> : null}
                      {lead ? (
                        <div className="absolute inset-y-0 left-0 z-10 flex items-center justify-end gap-1.5 overflow-hidden pr-2.5" style={{ width: pad }}>
                          {lead}
                        </div>
                      ) : null}
                      {tail ? (
                        <div className="absolute inset-y-0 z-10 flex items-center pl-2" style={{ left: pad + composition.durationMs * pxPerMs }}>
                          {tail}
                        </div>
                      ) : null}
                      <div
                        data-lane-id={track.id}
                        data-drop={isDropLane ? "true" : "false"}
                        className={cn("ds-lane relative flex-1 border-b border-ds-border", isMain ? "bg-ds-sunken" : "bg-ds-surface", tool === "blade" && "cursor-crosshair", track.locked && "bg-[repeating-linear-gradient(135deg,transparent_0_6px,var(--ds-hairline)_6px_7px)]")}
                        style={{ marginLeft: pad, marginRight: pad }}
                        onPointerDown={(event) => {
                          if (event.target !== event.currentTarget || event.button !== 0) return;
                          editor.getState().selectClip(null);
                          if (!mobile) editor.getState().setPlayhead(xToMs(event.clientX));
                        }}
                        onContextMenu={(event) => {
                          if (event.target !== event.currentTarget) return;
                          setLaneMenu({ track, atMs: xToMs(event.clientX) });
                        }}
                        {...laneHandlers(track)}
                      >
                        {track.clips
                          .filter((clip) => clipEndMs(clip) >= visibleStart - 2000 && clip.startMs <= visibleEnd + 2000)
                          .map((clip) => {
                            const dragging = drag?.clipId === clip.id && drag.ghost;
                            const inPlace = dragging && drag.ghost?.trackId === track.id;
                            const startMs = inPlace ? (drag.ghost?.startMs ?? clip.startMs) : clip.startMs;
                            const durationMs = inPlace ? (drag.ghost?.durationMs ?? clip.durationMs) : clip.durationMs;
                            return (
                              <ClipBlock
                                key={clip.id}
                                clip={clip}
                                track={track}
                                composition={composition}
                                left={startMs * pxPerMs}
                                width={Math.max(4, durationMs * pxPerMs - 1)}
                                height={height}
                                selected={selectedClipIds.includes(clip.id)}
                                ghosted={Boolean(dragging && !inPlace)}
                                variant={variant}
                                atCut={cutIds.has(clip.id)}
                                onPointerDown={(event, kind) => beginClipPointer(event, track, clip, kind)}
                              />
                            );
                          })}
                        {!drag && !track.locked
                          ? trackGaps(track)
                              .filter((gap) => gap.toMs >= visibleStart - 2000 && gap.fromMs <= visibleEnd + 2000 && (gap.toMs - gap.fromMs) * pxPerMs >= 4)
                              .map((gap) => (
                                <GapZone
                                  key={`gap-${track.id}-${gap.fromMs}`}
                                  left={gap.fromMs * pxPerMs}
                                  width={(gap.toMs - gap.fromMs) * pxPerMs}
                                  seconds={(gap.toMs - gap.fromMs) / 1000}
                                  touch={mobile}
                                  onEmptyPointerDown={(event) => {
                                    if (event.button !== 0) return;
                                    editor.getState().selectClip(null);
                                    if (!mobile) editor.getState().setPlayhead(xToMs(event.clientX));
                                  }}
                                  onDelete={() => void run("Delete gap", [{ op: "close-gap", trackId: track.id, fromMs: gap.fromMs, toMs: gap.toMs }])}
                                />
                              ))
                          : null}
                        {cuts
                          .filter((cut) => cut.atMs >= visibleStart - 2000 && cut.atMs <= visibleEnd + 2000 && !(drag?.clipId === cut.clipId && drag.ghost))
                          .map((cut) => (
                            <CutButton key={`cut-${cut.clipId}`} left={cut.atMs * pxPerMs} transition={cut.transition} size={mobile ? 24 : 18} onOpen={() => (mobileLanes?.transition ?? openTransitionPicker)(cut.clipId)} />
                          ))}
                        {empty ? (
                          <button
                            type="button"
                            onClick={empty.onSelect}
                            className="pc-press absolute inset-y-1 left-0 flex items-center gap-1.5 rounded-ds-sm bg-ds-surface-2 px-3 text-[13px] text-ds-text-2 shadow-[inset_0_0_0_1px_var(--ds-hairline)]"
                            style={{ width: Math.max(150, Math.min(composition.durationMs * pxPerMs, view.width / 2 - 16)) }}
                          >
                            <IconPlus className="size-4 shrink-0" /> <span className="truncate">{empty.label}</span>
                          </button>
                        ) : null}
                        {ghost && drag && drag.trackId !== track.id ? <div className="pointer-events-none absolute top-[3px] bottom-[3px] rounded-[7px] border-2 border-dashed border-ds-accent bg-ds-accent-soft" style={{ left: ghost.startMs * pxPerMs, width: ghost.durationMs * pxPerMs }} /> : null}
                        {isDropLane && laneDrop ? <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-ds-accent" style={{ left: laneDrop.atMs * pxPerMs }} /> : null}
                      </div>
                    </div>
                    {keyframeLanes
                      .filter((lane) => lane.trackId === track.id)
                      .map((lane) => (
                        <div key={lane.property} className="flex" style={{ height: KEYFRAME_LANE }}>
                          <div className="sticky left-0 z-20 flex shrink-0 items-center border-b border-r border-ds-border bg-ds-surface pl-6 pr-2" style={{ width: headerWidth }}>
                            <span className="truncate font-mono text-[10px] text-ds-text-3">{lane.property}</span>
                          </div>
                          <div className="relative flex-1 border-b border-ds-border bg-ds-sunken/60" style={{ marginLeft: pad, marginRight: pad }}>
                            {lane.keyframes.map((keyframe) => {
                              const dragging = keyframeDrag?.property === lane.property && keyframeDrag.fromMs === keyframe.atMs;
                              const atMs = dragging ? keyframeDrag.toMs : keyframe.atMs;
                              return (
                                <button
                                  key={`${lane.property}-${keyframe.atMs}`}
                                  type="button"
                                  title={`${lane.property} = ${Math.round(keyframe.value * 100) / 100} @ ${Math.round(keyframe.atMs)} ms`}
                                  onPointerDown={(event) => beginKeyframeDrag(event, lane.property, keyframe.atMs, lane.base)}
                                  className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] bg-ds-accent shadow-[0_0_0_1.5px_var(--ds-surface)] hover:scale-125"
                                  style={{ left: (lane.base + atMs) * pxPerMs }}
                                />
                              );
                            })}
                          </div>
                        </div>
                      ))}
                  </div>
                );
              })}

              {/* New-track drop zone */}
              {!mobile ? (
                <div className="flex" style={{ height: 40 }}>
                  <div className="sticky left-0 z-20 flex shrink-0 items-center border-r border-ds-border bg-ds-surface px-1.5" style={{ width: headerWidth }}>
                    <AddTrackMenu />
                  </div>
                  <div data-lane-id="__new__" data-drop={laneDrop?.trackId === "__new__" || drag?.ghost?.trackId === "__new__" ? "true" : "false"} className="ds-lane relative flex flex-1 items-center px-3 text-[11px] text-ds-text-3" style={{ marginLeft: pad, marginRight: pad }} {...laneHandlers(null)}>
                    {drag?.ghost?.trackId === "__new__" ? <div className="pointer-events-none absolute top-1 bottom-1 rounded-[7px] border-2 border-dashed border-ds-accent bg-ds-accent-soft" style={{ left: drag.ghost.startMs * pxPerMs, width: drag.ghost.durationMs * pxPerMs }} /> : <span className="sticky left-3">Drop media here, or drag a clip here, to start a new track</span>}
                  </div>
                </div>
              ) : null}

              {/* Playhead line */}
              <div
                className="pointer-events-none absolute bottom-0 z-20 w-0.5 bg-[var(--ds-text)] shadow-[0_0_0_1px_var(--ds-surface)]"
                style={{ top: mobile ? 0 : lanesTop, left: mobile ? view.left + view.width / 2 : headerWidth + pad + playheadX, transform: "translateX(-1px)" }}
              />
            </div>
          </div>
        </ContextMenuTrigger>
        {laneMenu ? <LaneMenu track={laneMenu.track} atMs={laneMenu.atMs} /> : null}
      </ContextMenu>
    </div>
  );
}

function AddTrackMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="pc-press flex h-7 w-full items-center gap-1.5 rounded-ds-sm px-2 text-[12px] font-medium text-ds-text-2 hover:bg-ds-surface-2 hover:text-ds-text">
          <IconPlus className="size-3.5" /> Add track
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem icon={<IconSparkles />} onSelect={() => addTrack({ kind: "visual" })}>
          Overlay track
        </DropdownMenuItem>
        <DropdownMenuItem icon={<IconMusic />} onSelect={() => addTrack({ kind: "audio", role: "music" })}>
          Music track
        </DropdownMenuItem>
        <DropdownMenuItem icon={<IconWaveSine />} onSelect={() => addTrack({ kind: "audio", role: "sfx" })}>
          Sound FX track
        </DropdownMenuItem>
        <DropdownMenuItem icon={<IconMicrophone />} onSelect={() => addTrack({ kind: "audio", role: "voice" })}>
          Voice track
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<IconBadgeCc />}
          onSelect={() => {
            if (useEditor.getState().composition?.tracks.some((track) => track.kind === "caption")) toast.message("There is already a captions track.");
            else addTrack({ kind: "caption" });
          }}
        >
          Captions track
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TimelineToolbar({ density, collapsed, onToggleCollapse }: { density: Density; collapsed: boolean; onToggleCollapse?: () => void }) {
  const tool = useEditor((state) => state.tool);
  const snapping = useEditor((state) => state.snapping);
  const ripple = useEditor((state) => state.ripple);
  const zoom = useEditor((state) => state.zoom);
  const undoCount = useEditor((state) => state.undoStack.length);
  const redoCount = useEditor((state) => state.redoStack.length);
  const hasSelection = useEditor((state) => state.selectedClipIds.length > 0);
  const hasMusic = useEditor((state) => Boolean(state.composition?.tracks.some((track) => track.kind === "audio" && track.role === "music" && track.clips.length > 0)));
  const durationMs = useEditor((state) => state.composition?.durationMs ?? 1);
  const editor = useEditor.getState;
  const zoomLog = Math.log(zoom);
  const fit = () => {
    const width = document.querySelector<HTMLElement>("[aria-label='Timeline']")?.clientWidth ?? 900;
    editor().setZoom(((width - HEADER_WIDTH - 40) / durationMs) * 1000);
  };
  return (
    <div className={cn("ds-no-scrollbar flex min-w-0 shrink-0 items-center gap-0.5 overflow-x-auto px-2", density === "compact" ? "h-9" : "h-11", !collapsed && "border-b border-ds-border")}>
      <IconButton label="Select tool" shortcut="V" active={tool === "select"} onClick={() => editor().setTool("select")}>
        <IconPointer />
      </IconButton>
      <IconButton label="Blade tool: click a clip to cut it" shortcut="B" active={tool === "blade"} onClick={() => editor().setTool(tool === "blade" ? "select" : "blade")}>
        <IconScissors />
      </IconButton>
      <span className="mx-1 h-5 w-px shrink-0 bg-ds-border" />
      <IconButton label="Undo" shortcut="Ctrl Z" disabled={undoCount < 2} onClick={() => void editor().undo()}>
        <IconArrowBackUp />
      </IconButton>
      <IconButton label="Redo" shortcut="Ctrl ⇧ Z" disabled={redoCount === 0} onClick={() => void editor().redo()}>
        <IconArrowForwardUp />
      </IconButton>
      <span className="mx-1 h-5 w-px shrink-0 bg-ds-border" />
      <IconButton label="Split at playhead" shortcut="S" onClick={splitAtPlayhead}>
        <IconColumns3 />
      </IconButton>
      <IconButton label="Trim start to playhead" shortcut="Q" disabled={!hasSelection} onClick={() => trimToPlayhead("start")}>
        <IconArrowBarToLeft />
      </IconButton>
      <IconButton label="Trim end to playhead" shortcut="W" disabled={!hasSelection} onClick={() => trimToPlayhead("end")}>
        <IconArrowBarToRight />
      </IconButton>
      <IconButton label="Duplicate" shortcut="Ctrl D" disabled={!hasSelection} onClick={() => void duplicateSelection()}>
        <IconCopy />
      </IconButton>
      <IconButton label="Delete" shortcut="Del" disabled={!hasSelection} onClick={() => deleteSelection()}>
        <IconTrash />
      </IconButton>
      <IconButton label="Add marker" shortcut="M" onClick={() => void run("Add marker", [{ op: "set-marker", atMs: Math.round(editor().playheadMs), label: "" }])}>
        <IconBookmark />
      </IconButton>
      {hasMusic ? (
        <IconButton label="Snap cuts to the music's beat" onClick={() => void snapCutsToBeat()}>
          <IconWaveSine />
        </IconButton>
      ) : null}
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <IconButton label={ripple ? "Close gaps: on. Deleting or trimming a clip pulls the next ones in" : "Close gaps: off"} active={ripple} onClick={() => editor().toggleRipple()}>
          <IconArrowsExchange />
        </IconButton>
        <IconButton label="Snapping (hold Alt to bypass)" active={snapping} onClick={() => editor().toggleSnapping()}>
          <IconMagnet />
        </IconButton>
        <span className="mx-1 h-5 w-px bg-ds-border" />
        <IconButton label="Zoom out" shortcut="−" onClick={() => editor().setZoom(zoom / 1.5)}>
          <IconZoomOut />
        </IconButton>
        <Slider label="Timeline zoom" className="w-24" value={zoomLog} min={Math.log(MIN_ZOOM)} max={Math.log(MAX_ZOOM)} step={0.01} onChange={(value) => editor().setZoom(Math.exp(value))} />
        <IconButton label="Zoom in" shortcut="+" onClick={() => editor().setZoom(zoom * 1.5)}>
          <IconZoomIn />
        </IconButton>
        <button type="button" onClick={fit} className="pc-press rounded-ds-sm px-2 py-1 text-[11px] font-medium text-ds-text-2 hover:bg-ds-surface-3 hover:text-ds-text">
          Fit
        </button>
        {onToggleCollapse ? (
          <>
            <span className="mx-1 h-5 w-px bg-ds-border" />
            <IconButton label={collapsed ? "Show timeline" : "Hide timeline: more room for the preview"} shortcut="⇧T" onClick={onToggleCollapse}>
              {collapsed ? <IconLayoutBottombarExpand /> : <IconLayoutBottombarCollapse />}
            </IconButton>
          </>
        ) : null}
      </div>
    </div>
  );
}
