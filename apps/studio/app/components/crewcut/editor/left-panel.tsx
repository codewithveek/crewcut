import { callAction } from "@agent-native/core/client/hooks";
import {
  CAPTION_PRESETS,
  FILTER_PRESETS,
  FILTER_PRESET_INFO,
  type FilterPreset,
  MOTION_PRESETS,
  SHAPE_ELEMENTS,
  STICKER_ICONS,
  TEXT_PRESETS,
  TRANSITION_PRESETS,
  type CaptionClip,
  colorFilterCss,
  cssFontStack,
  formatTimecode,
  iconElement,
  resolveFontFamily,
} from "@crewcut/composition";
import {
  IconArrowRight,
  IconArrowUpRight,
  IconArrowsExchange,
  IconBadgeCc,
  IconBolt,
  IconBulb,
  IconCheck,
  IconCircleCheck,
  IconClock,
  IconColorFilter,
  IconEye,
  IconHeart,
  IconMicrophone,
  IconMusic,
  IconPhoto,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerStopFilled,
  IconPlus,
  IconRocket,
  IconSearch,
  IconShape,
  IconShield,
  IconSparkles,
  IconStar,
  IconTarget,
  IconTrash,
  IconTrendingUp,
  IconTypography,
  IconUpload,
  IconWand,
  IconX,
} from "@tabler/icons-react";
import { fillToCss } from "@crewcut/renderer";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button, ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, EmptyState, Segmented, Slider } from "@/components/ds";
import { errorMessage } from "@/lib/crewcut";
import { cn } from "@/lib/utils";

import { addCaptionAt, addElementAt, addLibraryAudioAt, addMediaAt, applyFilter, applyMotion, applyTransition, currentSelection, generateCaptionsFromNarration, run, soloLayer } from "./commands";
import { type LeftTab, useEditor } from "./editor-store";
import { ACCEPTED_MEDIA, type AssetDto, type DragPayload, type LibraryItemDto, endDrag, hasFiles, startDrag, uploadMedia, useAssets, useAudioLibrary, useVideoFrames } from "./media";

export const LEFT_TABS: ReadonlyArray<{ id: LeftTab; label: string; icon: typeof IconPhoto }> = [
  { id: "media", label: "Media", icon: IconPhoto },
  { id: "audio", label: "Audio", icon: IconMusic },
  { id: "text", label: "Text", icon: IconTypography },
  { id: "captions", label: "Captions", icon: IconBadgeCc },
  { id: "elements", label: "Elements", icon: IconShape },
  { id: "effects", label: "Effects", icon: IconSparkles },
  { id: "transitions", label: "Transitions", icon: IconArrowsExchange },
  { id: "filters", label: "Filters", icon: IconColorFilter },
];

export function formatDuration(ms: number | null | undefined): string {
  if (!ms) return "";
  const seconds = Math.round(ms / 100) / 10;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

function draggable(payload: DragPayload) {
  return {
    draggable: true,
    onDragStart: (event: React.DragEvent) => startDrag(event, payload),
    onDragEnd: () => endDrag(),
  };
}

function PanelHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 px-3">
      <h2 className="ds-heading min-w-0 flex-1 truncate text-ds-text">{title}</h2>
      {children}
    </div>
  );
}

function AddBadge({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="pc-press absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-full bg-ds-accent text-ds-on-accent opacity-0 shadow-md transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100"
    >
      <IconPlus className="size-4" />
    </button>
  );
}

// ── Media ───────────────────────────────────────────────────────────────────

function useUploader(videoId: string, onDone: (assets: AssetDto[]) => void) {
  const [busy, setBusy] = useState(false);
  const upload = async (files: FileList | File[], role?: string) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setBusy(true);
    const toastId = toast.loading(list.length === 1 ? `Uploading ${list[0]?.name}…` : `Uploading ${list.length} files…`);
    try {
      const done: AssetDto[] = [];
      for (const file of list) done.push(await uploadMedia(file, { videoId, ...(role ? { role } : {}) }));
      toast.success(list.length === 1 ? "Uploaded" : `${list.length} files uploaded`, { id: toastId });
      onDone(done);
    } catch (error) {
      toast.error(errorMessage(error), { id: toastId });
    } finally {
      setBusy(false);
    }
  };
  return { busy, upload };
}

function MediaTile({ asset, onDeleted }: { asset: AssetDto; onDeleted: () => void }) {
  const frames = useVideoFrames(asset.mediaType === "video" ? asset.url : null, [500], 160);
  const poster = asset.mediaType === "image" ? asset.url : frames[0];
  const add = () => void addMediaAt(asset);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="group flex min-w-0 flex-col gap-1" {...draggable({ type: "asset", asset })}>
          <div role="button" tabIndex={0} onDoubleClick={add} onKeyDown={(event) => event.key === "Enter" && add()} className="relative aspect-[4/3] w-full cursor-grab overflow-hidden rounded-ds-sm bg-ds-surface-3 outline-none focus-visible:ring-2 focus-visible:ring-ds-accent" aria-label={`${asset.label}. Drag to the timeline, double-click or press + to add.`}>
            {poster ? <img src={poster} alt="" draggable={false} className="size-full object-cover" /> : <span className="pc-skeleton absolute inset-0 rounded-none" />}
            {asset.mediaType === "video" ? (
              <span className="absolute bottom-1 right-1 rounded bg-black/65 px-1 py-0.5 font-mono text-[10px] tabular text-white">{formatDuration(asset.durationMs) || "video"}</span>
            ) : null}
            <AddBadge onClick={add} label={`Add ${asset.label} at the playhead`} />
          </div>
          <span className="truncate text-[11px] text-ds-text-2">{asset.label}</span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem icon={<IconPlus />} onSelect={add}>
          Add at playhead
        </ContextMenuItem>
        <ContextMenuItem icon={<IconPhoto />} onSelect={() => void addMediaAt(asset, undefined, { mode: "overlay" })}>
          Add as overlay
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          icon={<IconTrash />}
          danger
          onSelect={async () => {
            try {
              await callAction("delete-asset" as never, { assetId: asset.id } as never);
              toast.success(`Deleted ${asset.label}`);
              onDeleted();
            } catch (error) {
              toast.error(errorMessage(error));
            }
          }}
        >
          Delete from library
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function MediaTab() {
  const videoId = useEditor((state) => state.videoId);
  const { assets, loading, refetch } = useAssets(videoId);
  const [filter, setFilter] = useState<"all" | "image" | "video">("all");
  const [search, setSearch] = useState("");
  const [dropping, setDropping] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { busy, upload } = useUploader(videoId, (done) => {
    void refetch();
    useEditor.getState().mergeAssetUrls(Object.fromEntries(done.map((asset) => [asset.id, asset.url])));
  });
  const visible = assets.filter((asset) => asset.mediaType !== "audio" && (filter === "all" || asset.mediaType === filter) && asset.label.toLowerCase().includes(search.toLowerCase()));
  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col", dropping && "bg-ds-accent-soft")}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setDropping(false);
        void upload(event.dataTransfer.files);
      }}
    >
      <PanelHeader title="Media">
        <Segmented size="sm" ariaLabel="Media type" value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "image", label: "Images" }, { value: "video", label: "Videos" }]} />
      </PanelHeader>
      <div className="px-3 pb-2">
        <label className="flex h-8 items-center gap-2 rounded-ds-sm bg-ds-surface-2 px-2 shadow-[inset_0_0_0_1px_var(--ds-hairline)] focus-within:shadow-[inset_0_0_0_1.5px_var(--ds-accent)]">
          <IconSearch className="size-4 text-ds-text-3" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => event.stopPropagation()} placeholder="Search media" aria-label="Search media" className="min-w-0 flex-1 bg-transparent text-[13px] text-ds-text outline-none placeholder:text-ds-text-3" />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <div className="grid grid-cols-2 gap-x-2 gap-y-3">
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className="pc-press flex aspect-[4/3] flex-col items-center justify-center gap-1.5 rounded-ds-sm bg-ds-surface-2 text-ds-text-2 shadow-[inset_0_0_0_1px_var(--ds-hairline)] outline-none hover:bg-ds-surface-3 hover:text-ds-text focus-visible:ring-2 focus-visible:ring-ds-accent"
          >
            <IconUpload className="size-5" />
            <span className="text-xs font-medium">{busy ? "Uploading…" : "Import"}</span>
          </button>
          {visible.map((asset) => (
            <MediaTile key={asset.id} asset={asset} onDeleted={() => void refetch()} />
          ))}
        </div>
        {!loading && visible.length === 0 ? <p className="mt-4 text-center text-xs text-ds-text-3">Drop photos or videos here, or press Import. Then drag them onto the timeline.</p> : null}
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPTED_MEDIA}
          className="hidden"
          onChange={(event) => {
            if (event.target.files) void upload(event.target.files);
            event.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

// ── Audio ───────────────────────────────────────────────────────────────────

let previewAudio: HTMLAudioElement | null = null;

function usePreviewPlayer() {
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => () => previewAudio?.pause(), []);
  const toggle = (id: string, url: string) => {
    if (playing === id) {
      previewAudio?.pause();
      setPlaying(null);
      return;
    }
    previewAudio?.pause();
    previewAudio = new Audio(url);
    previewAudio.onended = () => setPlaying(null);
    void previewAudio.play().catch(() => setPlaying(null));
    setPlaying(id);
  };
  return { playing, toggle };
}

function AudioRow({ id, label, meta, url, onAdd, payload, playing, onToggle, onDelete }: { id: string; label: string; meta: string; url: string; onAdd: () => void; payload: DragPayload; playing: boolean; onToggle: (id: string, url: string) => void; onDelete?: () => void }) {
  return (
    <div className="group flex h-12 items-center gap-2 rounded-ds-sm px-1.5 hover:bg-ds-surface-2" {...draggable(payload)}>
      <button type="button" onClick={() => onToggle(id, url)} aria-label={playing ? `Pause ${label}` : `Play ${label}`} className="pc-press flex size-8 shrink-0 items-center justify-center rounded-full bg-ds-surface-3 text-ds-text outline-none focus-visible:ring-2 focus-visible:ring-ds-accent">
        {playing ? <IconPlayerPause className="size-4" /> : <IconPlayerPlay className="size-4" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ds-text">{label}</p>
        <p className="truncate text-[11px] text-ds-text-3">{meta}</p>
      </div>
      {onDelete ? (
        <button type="button" onClick={onDelete} aria-label={`Delete ${label}`} className="pc-press flex size-7 items-center justify-center rounded-full text-ds-text-3 opacity-0 hover:text-ds-danger group-hover:opacity-100 focus-visible:opacity-100">
          <IconTrash className="size-4" />
        </button>
      ) : null}
      <button type="button" onClick={onAdd} aria-label={`Add ${label} at the playhead`} className="pc-press flex size-7 shrink-0 items-center justify-center rounded-full bg-ds-accent text-ds-on-accent outline-none focus-visible:ring-2 focus-visible:ring-ds-accent">
        <IconPlus className="size-4" />
      </button>
    </div>
  );
}

export function VoiceRecorder({ onAdded }: { onAdded?: () => void }) {
  const videoId = useEditor((state) => state.videoId);
  const [status, setStatus] = useState<"idle" | "recording" | "ready" | "saving">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const cleanup = useRef<() => void>(() => undefined);
  useEffect(() => () => cleanup.current(), []);
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let frame = 0;
      const started = performance.now();
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const value of data) peak = Math.max(peak, Math.abs(value - 128) / 128);
        setLevel(peak);
        setElapsed(performance.now() - started);
        frame = requestAnimationFrame(tick);
      };
      tick();
      const chunks: Blob[] = [];
      const media = new MediaRecorder(stream);
      media.ondataavailable = (event) => event.data.size && chunks.push(event.data);
      media.onstop = () => {
        setBlob(new Blob(chunks, { type: media.mimeType || "audio/webm" }));
        setStatus("ready");
      };
      cleanup.current = () => {
        cancelAnimationFrame(frame);
        stream.getTracks().forEach((track) => track.stop());
        void context.close();
      };
      recorder.current = media;
      media.start();
      setStatus("recording");
    } catch (error) {
      toast.error(`Microphone unavailable: ${errorMessage(error)}`);
    }
  };
  const stop = () => {
    recorder.current?.stop();
    cleanup.current();
    setLevel(0);
  };
  const save = async () => {
    if (!blob) return;
    setStatus("saving");
    try {
      const asset = await uploadMedia(blob, { videoId, role: "voice", label: `Voiceover ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` });
      await addMediaAt({ ...asset, kind: "voice" });
      setBlob(null);
      setStatus("idle");
      onAdded?.();
    } catch (error) {
      toast.error(errorMessage(error));
      setStatus("ready");
    }
  };
  return (
    <div className="flex flex-col items-center gap-3 rounded-ds-lg bg-ds-surface-2 p-4 text-center shadow-[inset_0_0_0_1px_var(--ds-hairline)]">
      <div className="flex h-10 items-end gap-0.5" aria-hidden>
        {Array.from({ length: 24 }, (_, index) => (
          <span key={index} className={cn("w-1 rounded-full", status === "recording" ? "bg-ds-danger" : "bg-ds-surface-3")} style={{ height: `${Math.max(8, Math.min(100, level * 140 * (0.5 + 0.5 * Math.sin(index * 1.7 + elapsed / 90))))}%` }} />
        ))}
      </div>
      <p className="font-mono text-sm tabular text-ds-text">{formatTimecode(status === "idle" ? 0 : elapsed, { fps: 30 }).slice(3, 10)}</p>
      {status === "recording" ? (
        <Button onClick={stop} variant="destructive" className="pc-press">
          <IconPlayerStopFilled className="size-4" /> Stop
        </Button>
      ) : status === "ready" || status === "saving" ? (
        <div className="flex flex-wrap justify-center gap-2">
          {blob ? <audio controls src={URL.createObjectURL(blob)} className="h-9 w-full max-w-[240px]" /> : null}
          <Button variant="ghost" onClick={() => (setBlob(null), setStatus("idle"))} disabled={status === "saving"}>
            Discard
          </Button>
          <Button onClick={() => void save()} disabled={status === "saving"} className="pc-press">
            {status === "saving" ? "Adding…" : "Add at playhead"}
          </Button>
        </div>
      ) : (
        <Button onClick={() => void start()} className="pc-press">
          <IconMicrophone className="size-4" /> Record voiceover
        </Button>
      )}
      <p className="text-[11px] text-ds-text-3">Lands on the voice track at the playhead. Music ducks under it automatically.</p>
    </div>
  );
}

export function AudioTab() {
  const videoId = useEditor((state) => state.videoId);
  const [section, setSection] = useState<"music" | "sfx" | "uploads" | "record">("music");
  const { items, loading } = useAudioLibrary();
  const { assets, refetch } = useAssets(videoId);
  const { playing, toggle } = usePreviewPlayer();
  const input = useRef<HTMLInputElement>(null);
  const { busy, upload } = useUploader(videoId, () => void refetch());
  const uploads = assets.filter((asset) => asset.mediaType === "audio");
  const library = items.filter((item) => item.kind === section);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader title="Audio" />
      <div className="px-3 pb-2">
        <Segmented size="sm" ariaLabel="Audio source" className="w-full" value={section} onChange={setSection} options={[{ value: "music", label: "Music" }, { value: "sfx", label: "Sound FX" }, { value: "uploads", label: "Uploads" }, { value: "record", label: "Record" }]} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {section === "record" ? (
          <div className="px-1">
            <VoiceRecorder />
          </div>
        ) : section === "uploads" ? (
          <>
            <Button variant="outline" size="sm" className="pc-press mx-1 mb-2 w-[calc(100%-8px)]" onClick={() => input.current?.click()} disabled={busy}>
              <IconUpload className="size-4" /> {busy ? "Uploading…" : "Upload audio"}
            </Button>
            <input ref={input} type="file" multiple accept="audio/*" className="hidden" onChange={(event) => (event.target.files && void upload(event.target.files, "music"), (event.target.value = ""))} />
            {uploads.length === 0 ? <p className="px-2 text-xs text-ds-text-3">MP3, WAV, M4A or OGG. Uploads you add here can be used in any video.</p> : null}
            {uploads.map((asset) => (
              <AudioRow
                key={asset.id}
                id={asset.id}
                label={asset.label}
                meta={`${asset.kind} · ${formatDuration(asset.durationMs)}`}
                url={asset.url}
                playing={playing === asset.id}
                onToggle={toggle}
                payload={{ type: "asset", asset }}
                onAdd={() => void addMediaAt(asset)}
                onDelete={async () => {
                  try {
                    await callAction("delete-asset" as never, { assetId: asset.id } as never);
                    void refetch();
                  } catch (error) {
                    toast.error(errorMessage(error));
                  }
                }}
              />
            ))}
          </>
        ) : (
          <>
            {loading ? <div className="pc-skeleton mx-1 h-24" /> : null}
            {library.map((item: LibraryItemDto) => (
              <AudioRow
                key={item.id}
                id={item.id}
                label={item.label}
                meta={`${item.mood} · ${formatDuration(item.durationMs)}${item.bpm ? ` · ${item.bpm} BPM` : ""}`}
                url={item.url}
                playing={playing === item.id}
                onToggle={toggle}
                payload={{ type: "library", item }}
                onAdd={() => void addLibraryAudioAt(item)}
              />
            ))}
            <p className="px-2 pt-3 text-[11px] text-ds-text-3">Generated by Crewcut, royalty-free for any use.</p>
          </>
        )}
      </div>
    </div>
  );
}

// ── Text ────────────────────────────────────────────────────────────────────

export function TextTab() {
  const brief = useEditor((state) => state.composition?.brief);
  if (!brief) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader title="Text" />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <div className="grid grid-cols-2 gap-2">
          {TEXT_PRESETS.map((preset) => {
            const layer = preset.build(brief);
            const style = layer.type === "text" ? layer.style ?? {} : {};
            const family = resolveFontFamily((style.font ?? "display") as never, brief.typePairing);
            return (
              <div
                key={preset.id}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && (event.preventDefault(), void addElementAt(layer))}
                {...draggable({ type: "element", layer, label: preset.label })}
                onClick={() => void addElementAt(layer)}
                className="pc-press group relative flex aspect-[4/3] flex-col items-center justify-center overflow-hidden rounded-ds-sm bg-[#16161a] p-2 text-center outline-none focus-visible:ring-2 focus-visible:ring-ds-accent"
                aria-label={`Add ${preset.label} text`}
              >
                <span
                  className="line-clamp-2 leading-tight"
                  style={{
                    fontFamily: cssFontStack(family),
                    fontWeight: style.weight ?? 700,
                    fontSize: Math.max(11, Math.min(22, (style.size ?? 80) / 6)),
                    fontStyle: style.italic ? "italic" : undefined,
                    textTransform: style.uppercase ? "uppercase" : undefined,
                    letterSpacing: style.tracking ? `${style.tracking}em` : undefined,
                    color: style.color && style.color.toLowerCase() !== brief.palette.ink.toLowerCase() ? style.color : "#ffffff",
                    background: style.background,
                    padding: style.background ? "3px 8px" : undefined,
                    borderRadius: style.radius ? Math.min(999, style.radius / 4) : undefined,
                    WebkitTextStroke: style.strokeWidth && style.strokeColor ? `1.5px ${style.strokeColor}` : undefined,
                    textShadow: layer.shadow ? `0 0 10px ${layer.shadow.color}` : undefined,
                  }}
                >
                  {preset.sample.replace(/\*/g, "")}
                </span>
                <span className="absolute bottom-1 left-1.5 text-[10px] text-white/55">{preset.label}</span>
                <AddBadge onClick={() => void addElementAt(layer)} label={`Add ${preset.label}`} />
              </div>
            );
          })}
        </div>
        <button type="button" onClick={() => useEditor.getState().setLeftTab("captions")} className="mt-3 flex w-full items-center gap-2 rounded-ds-sm bg-ds-surface-2 px-3 py-2.5 text-left text-[13px] text-ds-text hover:bg-ds-surface-3">
          <IconBadgeCc className="size-4 text-ds-text-2" /> Captions and subtitles
          <IconArrowRight className="ml-auto size-4 text-ds-text-3" />
        </button>
      </div>
    </div>
  );
}

// ── Captions ────────────────────────────────────────────────────────────────

function CaptionRow({ cue, active, fps }: { cue: CaptionClip; active: boolean; fps: number }) {
  const [draft, setDraft] = useState(cue.text);
  useEffect(() => setDraft(cue.text), [cue.text]);
  const selected = useEditor((state) => state.selectedClipIds.includes(cue.id));
  const commit = () => {
    const text = draft.trim();
    if (!text) {
      setDraft(cue.text);
      return;
    }
    if (text !== cue.text) void run("Edit caption", [{ op: "update-caption", clipId: cue.id, text }]);
  };
  return (
    <div className={cn("group flex gap-2 rounded-ds-sm p-2", selected ? "bg-ds-accent-soft" : active ? "bg-ds-surface-2" : "hover:bg-ds-surface-2")}>
      <button
        type="button"
        onClick={() => {
          useEditor.getState().setPlayhead(cue.startMs);
          useEditor.getState().selectClip(cue.id);
        }}
        className="w-14 shrink-0 pt-1 text-left font-mono text-[10px] tabular text-ds-text-3 hover:text-ds-accent"
      >
        {formatTimecode(cue.startMs, { fps }).slice(3, 10)}
      </button>
      <textarea
        value={draft}
        rows={Math.min(3, Math.max(1, Math.ceil(draft.length / 28)))}
        aria-label={`Caption at ${formatTimecode(cue.startMs, { fps })}`}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => useEditor.getState().selectClip(cue.id)}
        onBlur={commit}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            (event.target as HTMLTextAreaElement).blur();
          }
        }}
        className="min-w-0 flex-1 resize-none bg-transparent text-[13px] leading-snug text-ds-text outline-none"
      />
      <button type="button" onClick={() => void run("Delete caption", [{ op: "delete-clips", clipIds: [cue.id] }])} aria-label="Delete caption" className="pc-press flex size-6 shrink-0 items-center justify-center rounded text-ds-text-3 opacity-0 hover:text-ds-danger group-hover:opacity-100 focus-visible:opacity-100">
        <IconX className="size-3.5" />
      </button>
    </div>
  );
}

export function CaptionsTab() {
  const composition = useEditor((state) => state.composition);
  const playheadMs = useEditor((state) => state.playheadMs);
  const burnCaptions = useEditor((state) => state.burnCaptions);
  if (!composition) return null;
  const track = composition.tracks.find((candidate) => candidate.kind === "caption");
  const cues = track?.kind === "caption" ? [...track.clips].sort((a, b) => a.startMs - b.startMs) : [];
  const style = track?.kind === "caption" ? track.style : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader title="Captions">
        <button type="button" onClick={() => useEditor.getState().setBurnCaptions(!burnCaptions)} className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", burnCaptions ? "bg-ds-accent-soft text-ds-accent" : "bg-ds-surface-2 text-ds-text-3")}>
          {burnCaptions ? "Shown" : "Hidden"}
        </button>
      </PanelHeader>
      <div className="flex flex-col gap-2 px-3 pb-3">
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant="outline" className="pc-press" onClick={() => void addCaptionAt()}>
            <IconPlus className="size-4" /> Add at playhead
          </Button>
          <Button size="sm" variant="outline" className="pc-press" onClick={() => void generateCaptionsFromNarration()}>
            <IconWand className="size-4" /> From narration
          </Button>
        </div>
        {style ? (
          <div className="flex flex-wrap gap-1">
            {CAPTION_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => void run(`Caption style: ${preset}`, [{ op: "set-caption-style", style: { preset } }])}
                className={cn("pc-press rounded-full px-2.5 py-1 text-[11px] font-medium capitalize", style.preset === preset ? "bg-primary text-primary-foreground" : "bg-ds-surface-2 text-ds-text-2 hover:text-ds-text")}
              >
                {preset}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {cues.length === 0 ? (
          <EmptyState icon={<IconBadgeCc className="size-6" />} title="No captions yet">
            Generate them from the narration transcript, or add one at the playhead and type.
          </EmptyState>
        ) : (
          cues.map((cue) => <CaptionRow key={cue.id} cue={cue} fps={composition.fps} active={playheadMs >= cue.startMs && playheadMs < cue.startMs + cue.durationMs} />)
        )}
      </div>
    </div>
  );
}

// ── Elements ────────────────────────────────────────────────────────────────

const STICKER_PREVIEW: Record<string, typeof IconStar> = {
  check: IconCheck,
  "circle-check": IconCircleCheck,
  star: IconStar,
  sparkle: IconSparkles,
  zap: IconBolt,
  heart: IconHeart,
  rocket: IconRocket,
  "arrow-right": IconArrowRight,
  "arrow-up-right": IconArrowUpRight,
  "trending-up": IconTrendingUp,
  lightbulb: IconBulb,
  target: IconTarget,
  clock: IconClock,
  eye: IconEye,
  mic: IconMicrophone,
  play: IconPlayerPlay,
  wand: IconWand,
  shield: IconShield,
};

export function ElementsTab() {
  const brief = useEditor((state) => state.composition?.brief);
  if (!brief) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader title="Elements" />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <h3 className="ds-overline mb-2 text-ds-text-3">Shapes</h3>
        <div className="grid grid-cols-4 gap-2">
          {SHAPE_ELEMENTS.map((element) => {
            const layer = element.build(brief);
            const shape = layer.type === "shape" ? layer : null;
            const fill = shape?.fill ? fillToCss(shape.fill as never) ?? "transparent" : "transparent";
            return (
              <button key={element.id} type="button" {...draggable({ type: "element", layer, label: element.label })} onClick={() => void addElementAt(layer)} title={element.label} aria-label={`Add ${element.label}`} className="pc-press flex aspect-square items-center justify-center rounded-ds-sm bg-ds-surface-2 outline-none hover:bg-ds-surface-3 focus-visible:ring-2 focus-visible:ring-ds-accent">
                <span
                  className="block"
                  style={{
                    width: shape?.shape === "line" ? 28 : shape?.shape === "rect" && element.id === "pill" ? 30 : 24,
                    height: shape?.shape === "line" ? 3 : element.id === "pill" ? 12 : 24,
                    background: shape?.shape === "ring" || element.id === "frame" ? "transparent" : shape?.shape === "line" ? (shape.stroke ?? "#888") : fill,
                    border: shape?.shape === "ring" || element.id === "frame" ? `3px solid ${shape?.stroke ?? "#888"}` : undefined,
                    borderRadius: shape?.shape === "ellipse" || shape?.shape === "ring" || element.id === "pill" ? 999 : element.id === "card" || element.id === "frame" ? 6 : 0,
                    clipPath: shape?.shape === "triangle" ? "polygon(50% 0, 100% 100%, 0 100%)" : undefined,
                  }}
                />
              </button>
            );
          })}
        </div>
        <h3 className="ds-overline mb-2 mt-4 text-ds-text-3">Stickers</h3>
        <div className="grid grid-cols-4 gap-2">
          {STICKER_ICONS.map((icon) => {
            const Icon = STICKER_PREVIEW[icon] ?? IconStar;
            const layer = iconElement(brief, icon);
            return (
              <button key={icon} type="button" {...draggable({ type: "element", layer, label: icon })} onClick={() => void addElementAt(layer)} title={icon} aria-label={`Add ${icon} sticker`} className="pc-press flex aspect-square items-center justify-center rounded-ds-sm bg-ds-surface-2 outline-none hover:bg-ds-surface-3 focus-visible:ring-2 focus-visible:ring-ds-accent">
                <Icon className="size-6" style={{ color: brief.palette.accent }} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Effects (motion presets) ────────────────────────────────────────────────

function useEffectTarget(): { clipId: string; layerIds: string[]; label: string } | null {
  const composition = useEditor((state) => state.composition);
  const selectedClipIds = useEditor((state) => state.selectedClipIds);
  const selectedLayer = useEditor((state) => state.selectedLayer);
  return useMemo(() => {
    const selection = currentSelection();
    if (selection.kind === "layer") return { clipId: selection.clip.id, layerIds: [selection.layer.id], label: selection.layer.name ?? selection.layer.type };
    if (selection.kind === "clip") return { clipId: selection.clip.id, layerIds: selection.clip.layers.filter((layer) => layer.type !== "camera").map((layer) => layer.id), label: selection.clip.name ?? "clip" };
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composition, selectedClipIds, selectedLayer]);
}

export function EffectsTab() {
  const target = useEffectTarget();
  const [mode, setMode] = useState<"enter" | "exit">("enter");
  const groups = ["enter", "text", "emphasis", "camera", "ambient"] as const;
  const groupLabel = { enter: "In", text: "Text", emphasis: "Emphasis", camera: "Camera", ambient: "Loop" } as const;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader title="Animations">
        <Segmented size="sm" ariaLabel="Animation direction" value={mode} onChange={setMode} options={[{ value: "enter", label: "In" }, { value: "exit", label: "Out" }]} />
      </PanelHeader>
      <p className="px-3 pb-2 text-[11px] text-ds-text-3">{target ? `Applies to ${target.label} at the playhead.` : "Select a clip or layer, or drag an animation onto a clip."}</p>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {groups.map((group) => {
          const presets = MOTION_PRESETS.filter((preset) => preset.group === group && (mode === "enter" || preset.supportsExit));
          if (presets.length === 0) return null;
          return (
            <section key={group} className="mb-3">
              <h3 className="ds-overline mb-1.5 text-ds-text-3">{groupLabel[group]}</h3>
              <div className="grid grid-cols-2 gap-1.5">
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    title={preset.description}
                    disabled={!target}
                    {...draggable({ type: "motion", presetId: preset.id, label: preset.label })}
                    onClick={() => target && applyMotion(target.clipId, target.layerIds, preset.id, mode)}
                    className="pc-press flex h-10 items-center gap-2 rounded-ds-sm bg-ds-surface-2 px-2.5 text-left text-xs font-medium text-ds-text outline-none hover:bg-ds-surface-3 focus-visible:ring-2 focus-visible:ring-ds-accent disabled:cursor-grab disabled:opacity-70"
                  >
                    <IconSparkles className="size-3.5 shrink-0 text-ds-accent" />
                    <span className="truncate">{preset.label}</span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ── Transitions ─────────────────────────────────────────────────────────────

function TransitionDemo({ type }: { type: string }) {
  return (
    <span className="ds-transition-demo relative block aspect-video w-full overflow-hidden rounded-[6px]" data-type={type}>
      <span className="absolute inset-0 bg-[#3a3f4f]" />
      <span className="ds-transition-b absolute inset-0 bg-ds-accent" />
    </span>
  );
}

export function TransitionsTab() {
  const target = useEffectTarget();
  const composition = useEditor((state) => state.composition);
  const current = target && composition ? composition.tracks.flatMap((track) => (track.kind === "visual" ? track.clips : [])).find((clip) => clip.id === target.clipId)?.transitionIn : undefined;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader title="Transitions" />
      <p className="px-3 pb-2 text-[11px] text-ds-text-3">{target ? `Plays into ${target.label}.` : "Select the clip after a cut, or drag a transition onto it."}</p>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <div className="grid grid-cols-2 gap-2">
          {TRANSITION_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              disabled={!target}
              {...draggable({ type: "transition", transition: preset.transition, label: preset.label })}
              onClick={() => target && applyTransition(target.clipId, preset.transition.type === "cut" ? null : preset.transition)}
              className={cn(
                "pc-press flex flex-col gap-1.5 rounded-ds-sm bg-ds-surface-2 p-1.5 text-left outline-none hover:bg-ds-surface-3 focus-visible:ring-2 focus-visible:ring-ds-accent disabled:cursor-grab disabled:opacity-80",
                current?.type === preset.transition.type && "ring-2 ring-ds-accent",
              )}
            >
              <TransitionDemo type={preset.transition.type} />
              <span className="truncate px-0.5 text-[11px] font-medium text-ds-text">{preset.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Filters ─────────────────────────────────────────────────────────────────

export const FILTER_SAMPLE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4aa3ff"/><stop offset="1" stop-color="#ffd1a1"/></linearGradient></defs><rect width="160" height="120" fill="url(#s)"/><circle cx="118" cy="42" r="16" fill="#ffcf4a"/><path d="M0 92 Q40 62 80 86 T160 78 V120 H0Z" fill="#2f9e6e"/><path d="M0 104 Q50 84 100 100 T160 98 V120 H0Z" fill="#1f6b4c"/><rect x="26" y="70" width="18" height="26" fill="#e2574c"/><rect x="22" y="64" width="26" height="8" fill="#a33a32"/></svg>`,
  );

export function FiltersTab() {
  const composition = useEditor((state) => state.composition);
  const target = useEffectTarget();
  if (!composition) return null;
  const selection = currentSelection();
  const ref = selection.kind === "layer" ? { clipId: selection.clip.id, layerId: selection.layer.id } : selection.kind === "clip" ? { clipId: selection.clip.id } : null;
  const currentFilter = selection.kind === "layer" ? selection.layer.filter : selection.kind === "clip" ? selection.clip.filter : undefined;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader title="Filters" />
      <p className="px-3 pb-2 text-[11px] text-ds-text-3">{target ? `Applies to ${target.label}.` : "Select a clip, or drag a filter onto one."}</p>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <div className="grid grid-cols-3 gap-2">
          {(["none", ...FILTER_PRESETS] as const).map((preset) => {
            const active = preset === "none" ? !currentFilter : currentFilter?.preset === preset;
            return (
              <button
                key={preset}
                type="button"
                disabled={!ref}
                {...draggable({ type: "filter", preset, label: preset === "none" ? "None" : FILTER_PRESET_INFO[preset].label })}
                onClick={() => ref && applyFilter(ref, preset === "none" ? null : (preset as FilterPreset), currentFilter?.intensity ?? 1)}
                className="pc-press flex flex-col gap-1 rounded-ds-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ds-accent disabled:cursor-grab"
              >
                <img src={FILTER_SAMPLE} alt="" draggable={false} className={cn("aspect-[4/3] w-full rounded-[6px] object-cover", active && "ring-2 ring-ds-accent ring-offset-2 ring-offset-[var(--ds-surface)]")} style={{ filter: preset === "none" ? undefined : colorFilterCss({ filter: { preset, intensity: 1 } }) }} />
                <span className={cn("truncate text-[11px]", active ? "font-semibold text-ds-text" : "text-ds-text-2")}>{preset === "none" ? "None" : FILTER_PRESET_INFO[preset].label}</span>
              </button>
            );
          })}
        </div>
        {ref && currentFilter ? (
          <div className="mt-4 flex items-center gap-3">
            <span className="text-xs text-ds-text-2">Intensity</span>
            <Slider
              label="Filter intensity"
              value={currentFilter.intensity}
              min={0}
              max={1}
              step={0.05}
              onChange={(intensity) => {
                const filter = { ...currentFilter, intensity };
                useEditor.getState().preview([ref.layerId ? { op: "update-layer", clipId: ref.clipId, layerId: ref.layerId, patch: { filter } } : { op: "update-clip", clipId: ref.clipId, patch: { filter } }]);
              }}
              onCommit={(intensity) => applyFilter(ref, currentFilter.preset, intensity)}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function LeftTabContent({ tab }: { tab: LeftTab }) {
  switch (tab) {
    case "media":
      return <MediaTab />;
    case "audio":
      return <AudioTab />;
    case "text":
      return <TextTab />;
    case "captions":
      return <CaptionsTab />;
    case "elements":
      return <ElementsTab />;
    case "effects":
      return <EffectsTab />;
    case "transitions":
      return <TransitionsTab />;
    case "filters":
      return <FiltersTab />;
  }
}

/** Desktop: a labelled icon strip plus the open tab's panel. */
export function LeftPanel({ className, collapsible = true }: { className?: string; collapsible?: boolean }) {
  const tab = useEditor((state) => state.leftTab);
  const open = useEditor((state) => state.leftOpen);
  return (
    <div className={cn("flex min-h-0", className)}>
      <nav aria-label="Editor tools" className="ds-no-scrollbar flex w-[60px] shrink-0 flex-col items-center gap-0.5 overflow-y-auto py-2">
        {LEFT_TABS.map((item) => {
          const active = tab === item.id && open;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => (collapsible && tab === item.id && open ? useEditor.getState().setLeftOpen(false) : useEditor.getState().setLeftTab(item.id))}
              aria-pressed={active}
              className={cn("pc-press flex w-[52px] flex-col items-center gap-1 rounded-ds-sm py-2 outline-none focus-visible:ring-2 focus-visible:ring-ds-accent", active ? "bg-ds-surface-3 text-ds-text" : "text-ds-text-2 hover:bg-ds-surface-2 hover:text-ds-text")}
            >
              <item.icon className="size-5" strokeWidth={1.7} />
              <span className="text-[10px] font-medium leading-none">{item.label}</span>
            </button>
          );
        })}
      </nav>
      {open ? (
        <div className="flex min-h-0 w-[280px] flex-col border-l border-ds-border">
          <LeftTabContent tab={tab} />
        </div>
      ) : null}
    </div>
  );
}
