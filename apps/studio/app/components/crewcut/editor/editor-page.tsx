import { writeClientAppState } from "@agent-native/core/client/application-state";
import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { type Composition, DEFAULT_EXPORT_RESOLUTION, EXPORT_RESOLUTIONS, type ExportResolution, crewcutEndingClip, crewcutEndingStartMs, exportSize, formatTimecode, isCrewcutEnding } from "@crewcut/composition";
import {
  IconAdjustmentsHorizontal,
  IconArrowLeft,
  IconCloud,
  IconDots,
  IconDownload,
  IconGitBranch,
  IconLink,
  IconLoader2,
  IconSparkles,
  IconTemplate,
  IconUpload,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import { Button, Dialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, FieldRow, IconButton, Select, SkeletonLines, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ds";
import { SaveTemplateDialog } from "./save-template";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { errorMessage, formatAgo } from "@/lib/crewcut";
import { TAB_ID } from "@/lib/tab-id";
import { cn } from "@/lib/utils";

import { copySelection, cutSelection, deleteSelection, duplicateSelection, paste, run, selectionContext, splitAtPlayhead, transformOps, trimToPlayhead, currentSelection } from "./commands";
import { EditorAssistant } from "./assistant";
import { useEditor } from "./editor-store";
import { Inspector } from "./inspector";
import { LeftPanel } from "./left-panel";
import { MobileEditor } from "./mobile-editor";
import { PreviewPanel } from "./preview";
import { ShareDialog } from "./share-dialog";
import { type PublishPlatform, PUBLISH_PLATFORMS, PublishBody, PublishButton, PublishFooter, usePublishFlow } from "./publish";
import { Timeline } from "./timeline";

type Layout = "phone" | "tablet" | "laptop" | "desktop";

function useLayout(): Layout {
  const [layout, setLayout] = useState<Layout>("laptop");
  useEffect(() => {
    const pick = () => {
      const width = window.innerWidth;
      setLayout(width < 640 ? "phone" : width < 1024 ? "tablet" : width < 1360 ? "laptop" : "desktop");
    };
    pick();
    window.addEventListener("resize", pick);
    return () => window.removeEventListener("resize", pick);
  }, []);
  return layout;
}

const TIMELINE_STORAGE_KEY = "crewcut.editor.timeline";

/**
 * Timeline sizing for laptops and short desktops. The default height follows
 * the window (about a third of it), short windows (< 820 px) switch to a
 * compact density, a manual resize is remembered, and the timeline can
 * collapse to its toolbar so the preview gets the room.
 */
function useTimelineSizing() {
  const [viewportHeight, setViewportHeight] = useState(900);
  const [custom, setCustom] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(TIMELINE_STORAGE_KEY) ?? "null") as { height?: number | null; collapsed?: boolean } | null;
      if (saved?.height) setCustom(saved.height);
      if (saved?.collapsed) setCollapsed(true);
    } catch {
      // Storage unavailable: defaults still work.
    }
    const update = () => setViewportHeight(window.innerHeight);
    update();
    window.addEventListener("resize", update);
    const toggle = () => setCollapsed((value) => !value);
    window.addEventListener("crewcut:toggle-timeline", toggle);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("crewcut:toggle-timeline", toggle);
    };
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(TIMELINE_STORAGE_KEY, JSON.stringify({ height: custom, collapsed }));
    } catch {
      // Ignore storage errors.
    }
  }, [custom, collapsed]);
  const compact = viewportHeight < 820;
  const automatic = Math.round(Math.min(360, Math.max(compact ? 150 : 200, viewportHeight * (compact ? 0.3 : 0.34))));
  const max = Math.round(viewportHeight * 0.65);
  const collapsedHeight = compact ? 38 : 46;
  const height = collapsed ? collapsedHeight : Math.max(120, Math.min(max, custom ?? automatic));
  return {
    compact,
    collapsed,
    height,
    max,
    toggle: () => setCollapsed((value) => !value),
    resize: (next: number) => {
      setCollapsed(false);
      setCustom(Math.max(120, Math.min(max, Math.round(next))));
    },
    reset: () => {
      setCustom(null);
      setCollapsed(false);
    },
  };
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

/** Keyboard: CapCut/NLE shortcuts. No animation on keyboard-driven actions. */
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
      if (isTyping(event.target) || event.defaultPrevented) return;
      if ((event.target as HTMLElement | null)?.closest?.("[role=menu],[role=dialog],[role=listbox]")) return;
      const state = useEditor.getState();
      const composition = state.composition;
      if (!composition) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod) {
        const handled = (() => {
          if (key === "z") return void (event.shiftKey ? state.redo() : state.undo()), true;
          if (key === "y") return void state.redo(), true;
          if (key === "c") return copySelection(), true;
          if (key === "x") return cutSelection(), true;
          if (key === "v") return void paste(), true;
          if (key === "d") return void duplicateSelection(), true;
          if (key === "b") return splitAtPlayhead(), true;
          return false;
        })();
        if (handled) event.preventDefault();
        return;
      }
      // Nudge the selected layer: Alt+arrows (1 px), Alt+Shift (10 px).
      if (event.altKey && key.startsWith("arrow")) {
        const selection = currentSelection();
        if (selection.kind !== "layer") return;
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
        const dy = key === "arrowup" ? -step : key === "arrowdown" ? step : 0;
        const { layer, clip } = selection;
        void run("Nudge", transformOps(clip, layer, { x: layer.transform.x + (dx / composition.width) * 100, y: layer.transform.y + (dy / composition.height) * 100 }));
        return;
      }
      switch (key) {
        case " ":
          event.preventDefault();
          stopShuttle();
          state.setPlaying(!state.playing);
          break;
        case "arrowleft":
          event.preventDefault();
          state.setPlaying(false);
          if (event.shiftKey) state.setPlayhead(state.playheadMs - 1000);
          else state.stepFrames(-1);
          break;
        case "arrowright":
          event.preventDefault();
          state.setPlaying(false);
          if (event.shiftKey) state.setPlayhead(state.playheadMs + 1000);
          else state.stepFrames(1);
          break;
        case "j":
          state.setPlaying(false);
          runShuttle(shuttle.current.rate < 0 ? Math.max(-8, shuttle.current.rate * 2) : -1);
          break;
        case "k":
          stopShuttle();
          state.setPlaying(false);
          break;
        case "l":
          if (shuttle.current.rate > 0) runShuttle(Math.min(8, shuttle.current.rate * 2));
          else {
            stopShuttle();
            state.setPlaying(true);
          }
          break;
        case "i":
          state.setInOut("in", Math.round(state.playheadMs));
          break;
        case "o":
          state.setInOut("out", Math.round(state.playheadMs));
          break;
        case "home":
          state.setPlayhead(0);
          break;
        case "end":
          state.setPlayhead(composition.durationMs);
          break;
        case "s":
          splitAtPlayhead();
          break;
        case "q":
          trimToPlayhead("start");
          break;
        case "w":
          trimToPlayhead("end");
          break;
        case "b":
          state.setTool(state.tool === "blade" ? "select" : "blade");
          break;
        case "t":
          if (event.shiftKey) window.dispatchEvent(new CustomEvent("crewcut:toggle-timeline"));
          break;
        case "v":
          state.setTool("select");
          break;
        case "f":
          window.dispatchEvent(new CustomEvent("crewcut:toggle-fullscreen"));
          break;
        case "m":
          void run("Add marker", [{ op: "set-marker", atMs: Math.round(state.playheadMs), label: "" }]);
          break;
        case "delete":
        case "backspace":
          event.preventDefault();
          deleteSelection(event.shiftKey || undefined);
          break;
        case "+":
        case "=":
          state.setZoom(state.zoom * 1.5);
          break;
        case "-":
          state.setZoom(state.zoom / 1.5);
          break;
        case "escape":
          if (state.tool === "blade") state.setTool("select");
          else state.selectClip(null);
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

// ── Top bar ─────────────────────────────────────────────────────────────────

function SaveStatus() {
  const saving = useEditor((state) => state.saving);
  const lastSavedAt = useEditor((state) => state.lastSavedAt);
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <span className="hidden items-center gap-1.5 whitespace-nowrap text-[12px] text-ds-text-3 md:flex" aria-live="polite">
      {saving > 0 ? <IconLoader2 className="size-3.5 motion-safe:animate-spin" /> : <IconCloud className="size-3.5" />}
      {saving > 0 ? "Saving…" : lastSavedAt ? `Saved ${formatAgo(new Date(lastSavedAt).toISOString())}` : "All changes saved"}
    </span>
  );
}

export function EditableTitle({ className }: { className?: string }) {
  const title = useEditor((state) => state.composition?.title ?? "");
  const videoId = useEditor((state) => state.videoId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  useEffect(() => setDraft(title), [title]);
  const save = async () => {
    setEditing(false);
    const next = draft.trim();
    if (!next || next === title) return setDraft(title);
    try {
      await callAction("rename-video" as never, { videoId, title: next } as never);
      await useEditor.getState().refresh();
    } catch (error) {
      toast.error(errorMessage(error));
      setDraft(title);
    }
  };
  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        aria-label="Project title"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          if (event.key === "Escape") (setDraft(title), setEditing(false));
        }}
        className={cn("h-8 min-w-0 rounded-ds-sm bg-ds-surface-2 px-2 text-[14px] font-semibold text-ds-text outline-none ring-2 ring-ds-accent", className)}
      />
    );
  }
  return (
    <button type="button" onClick={() => setEditing(true)} title="Rename" className={cn("min-w-0 truncate rounded-ds-sm px-1.5 py-1 text-left text-[14px] font-semibold text-ds-text hover:bg-ds-surface-2", className)}>
      {title}
    </button>
  );
}

interface RenderRow {
  id: string;
  status: string;
  progress: number | null;
  stage: string | null;
  outputBytes: number | null;
  error: string | null;
  createdAt: string;
  compositionVersion: number;
  resolution?: ExportResolution;
}

const RESOLUTION_KEY = "crewcut.export-resolution";

/** The export size this person picked last (per browser; 1080p until they choose). */
function useExportResolution(): [ExportResolution, (value: ExportResolution) => void] {
  const [value, setValue] = useState<ExportResolution>(DEFAULT_EXPORT_RESOLUTION);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(RESOLUTION_KEY);
      if (saved && EXPORT_RESOLUTIONS.some((entry) => entry.id === saved)) setValue(saved as ExportResolution);
    } catch {
      // Storage blocked: keep the default.
    }
  }, []);
  const choose = (next: ExportResolution) => {
    setValue(next);
    try {
      window.localStorage.setItem(RESOLUTION_KEY, next);
    } catch {
      // Storage blocked: the choice lasts until the page closes.
    }
  };
  return [value, choose];
}

const resolutionLabel = (id: ExportResolution | undefined) => EXPORT_RESOLUTIONS.find((entry) => entry.id === (id ?? DEFAULT_EXPORT_RESOLUTION))?.label ?? "1080p";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Set when the dialog shows the publish step for that platform. */
  platform: PublishPlatform | null;
  onPlatformChange: (platform: PublishPlatform | null) => void;
}

export function ExportDialog(props: ExportDialogProps) {
  const composition = useEditor((state) => state.composition);
  return composition ? <ExportDialogContent {...props} composition={composition} /> : null;
}

function ExportDialogContent({ open, onOpenChange, platform, onPlatformChange, composition }: ExportDialogProps & { composition: Composition }) {
  const videoId = useEditor((state) => state.videoId);
  const version = useEditor((state) => state.version);
  // The export matches the editor: captions are in it when they're shown in the preview.
  const burnCaptions = useEditor((state) => state.burnCaptions);
  const [starting, setStarting] = useState(false);
  const [watching, setWatching] = useState<string | null>(null);
  const [resolution, setResolution] = useExportResolution();
  const output = exportSize(composition.width, composition.height, resolution);
  const query = useActionQuery("get-video", { videoId, include: ["renders"] } as never, { enabled: open, refetchInterval: open && watching ? 1500 : false } as never);
  const allRenders = (query.data as { renders?: RenderRow[] } | undefined)?.renders ?? [];
  const renders = allRenders.slice(0, 4);
  const active = renders.find((render) => render.id === watching);
  useEffect(() => {
    if (active && (active.status === "done" || active.status === "failed")) {
      if (active.status === "done") toast.success(platform ? "Export finished: ready to publish" : "Your video is ready to download");
      setWatching(null);
    }
  }, [active?.status]);
  const ending = composition.tracks.flatMap((track) => (track.kind === "visual" ? track.clips : [])).find((clip) => isCrewcutEnding(clip)) ?? null;
  const toggleEnding = (on: boolean) => {
    if (!on && ending) return void run("Remove the Crewcut ending", [{ op: "delete-clips", clipIds: [ending.id] }]);
    const main = composition.tracks.find((track) => track.kind === "visual");
    if (on && main) void run("Add the Crewcut ending", [{ op: "add-clip", trackId: main.id, clip: crewcutEndingClip(composition, crewcutEndingStartMs(composition), `crewcut-ending-${Date.now().toString(36)}`) as never }]);
  };
  const start = async () => {
    setStarting(true);
    try {
      const result = (await callAction("render-video" as never, { videoId, burnCaptions, resolution } as never)) as { renderId: string };
      setWatching(result.renderId);
      void query.refetch();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setStarting(false);
    }
  };
  const flow = usePublishFlow({ videoId, composition, platform, renders: allRenders, exporting: starting || Boolean(watching), startExport: () => void start() });
  const download = async (renderId: string) => {
    try {
      const { url } = (await callAction("get-render-link" as never, { videoId, renderId, download: true } as never)) as { url: string };
      window.location.assign(url);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={platform ? `Publish to ${PUBLISH_PLATFORMS[platform]?.label ?? ""}` : "Export video"}
      footer={
        platform ? (
          <PublishFooter flow={flow} onBack={() => (flow.reset(), onPlatformChange(null))} />
        ) : (
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <PublishButton onChoose={onPlatformChange} size="default" />
          <Button onClick={() => void start()} disabled={starting || Boolean(watching)} className="pc-press">
            {starting || watching ? <IconLoader2 className="size-4 motion-safe:animate-spin" /> : <IconUpload className="size-4" />}
            {watching ? "Exporting…" : "Export"}
          </Button>
        </>
        )
      }
    >
      {platform ? (
        <PublishBody flow={flow} composition={composition} version={version} />
      ) : (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-2 rounded-ds-md bg-ds-surface-2 p-3 text-center">
          {[
            ["Format", `${composition.ratio}`],
            ["Size", `${output.width}×${output.height}`],
            ["Length", formatTimecode(composition.durationMs, { fps: composition.fps }).slice(3, 8)],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="ds-overline text-ds-text-3">{label}</p>
              <p className="font-mono text-sm tabular text-ds-text">{value}</p>
            </div>
          ))}
        </div>
        <FieldRow label="Resolution">
          <Select
            label="Resolution"
            className="w-full"
            value={resolution}
            onChange={(value) => setResolution(value as ExportResolution)}
            options={EXPORT_RESOLUTIONS.map((entry) => {
              const size = exportSize(composition.width, composition.height, entry.id);
              return { value: entry.id, label: `${entry.label} · ${size.width}×${size.height}` };
            })}
          />
        </FieldRow>
        {/* The project's frame rate (same setting as the Project panel), so the export matches the editor. */}
        <FieldRow label="Frame rate">
          <Select
            label="Frame rate"
            className="w-full"
            value={String(composition.fps)}
            onChange={(fps) => void run(`${fps} fps`, [{ op: "set-format", fps: Number(fps) as 30 }])}
            options={["24", "25", "30", "50", "60"].map((fps) => ({ value: fps, label: `${fps} fps` }))}
          />
        </FieldRow>
        {/* The ending is a clip on the timeline: this switch adds or removes it there, so the editor still shows exactly what exports. */}
        <FieldRow label="Ending">
          <Switch label="Crewcut ending" checked={ending !== null} onCheckedChange={(on) => toggleEnding(on)} />
        </FieldRow>
        {renders.length ? (
          <div className="flex flex-col gap-1.5">
            <p className="ds-overline text-ds-text-3">Previous exports</p>
            {renders.map((render) => (
              <div key={render.id} className="flex items-center gap-2 rounded-ds-sm bg-ds-surface-2 px-2.5 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-ds-text">
                    Exported {formatAgo(render.createdAt)}
                    {render.compositionVersion !== version ? <span className="text-ds-text-3"> · before your latest edits</span> : null}
                  </p>
                  {render.status === "running" || render.status === "queued" ? (
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ds-surface-3" role="progressbar" aria-valuenow={Math.round((render.progress ?? 0) * 100)}>
                      <div className="h-full rounded-full bg-ds-accent transition-[width] duration-500" style={{ width: `${Math.max(3, Math.round((render.progress ?? 0) * 100))}%` }} />
                    </div>
                  ) : (
                    <p className={cn("text-[11px]", render.status === "failed" ? "text-ds-danger" : "text-ds-text-3")}>{render.status === "failed" ? (render.error ?? "Failed") : render.status === "done" ? `Ready · ${resolutionLabel(render.resolution)} · ${((render.outputBytes ?? 0) / 1048576).toFixed(1)} MB` : render.status}</p>
                  )}
                </div>
                {render.status === "done" ? (
                  <Button size="sm" variant="outline" onClick={() => void download(render.id)}>
                    <IconDownload className="size-4" /> Download
                  </Button>
                ) : render.status === "running" || render.status === "queued" ? (
                  <span className="font-mono text-xs tabular text-ds-text-2">{Math.round((render.progress ?? 0) * 100)}%</span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      )}
    </Dialog>
  );
}

function RightPanel({ className }: { className?: string }) {
  const tab = useEditor((state) => state.rightTab);
  return (
    <Tabs value={tab} onValueChange={(value) => useEditor.getState().setRightTab(value as "properties" | "assistant")} className={cn("flex min-h-0 flex-col", className)}>
      <TabsList variant="pill" className="mx-3 mt-3 shrink-0">
        <TabsTrigger variant="pill" value="properties">
          <IconAdjustmentsHorizontal /> Properties
        </TabsTrigger>
        <TabsTrigger variant="pill" value="assistant">
          <IconSparkles /> Assistant
        </TabsTrigger>
      </TabsList>
      <TabsContent value="properties" className="flex min-h-0 flex-1 flex-col outline-none">
        <Inspector className="min-h-0 flex-1" />
      </TabsContent>
      {/* Kept mounted while hidden so a prompt sent from anywhere in the editor always has a chat to land in. */}
      <TabsContent value="assistant" forceMount className="flex min-h-0 flex-1 flex-col outline-none data-[state=inactive]:hidden">
        <EditorAssistant />
      </TabsContent>
    </Tabs>
  );
}

function TopBar({ onExport, onPublish, onInspector, compact, short }: { onExport: () => void; onPublish: (platform: PublishPlatform) => void; onInspector?: () => void; compact?: boolean; short?: boolean }) {
  const videoId = useEditor((state) => state.videoId);
  const title = useEditor((state) => state.composition?.title ?? "");
  const [shareOpen, setShareOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const navigate = useNavigate();
  return (
    <header className={cn("flex shrink-0 items-center gap-2 px-3", short ? "h-12" : "h-14")}>
      <Link to="/projects" className="pc-press flex size-8 shrink-0 items-center justify-center rounded-ds-sm text-ds-text-2 hover:bg-ds-surface-3 hover:text-ds-text" aria-label="Back to projects">
        <IconArrowLeft className="size-4" />
      </Link>
      <EditableTitle className="max-w-[40vw]" />
      <SaveStatus />
      <div className="ml-auto flex items-center gap-1.5">
        <Button asChild variant="ghost" size="sm" className="hidden lg:inline-flex">
          <Link to={`/videos/${videoId}`}>
            <IconGitBranch className="size-4" /> Pipeline
          </Link>
        </Button>
        <Button variant="outline" size="sm" className="pc-press hidden sm:inline-flex" onClick={() => setShareOpen(true)}>
          <IconLink className="size-4" /> {compact ? null : "Share"}
        </Button>
        <ShareDialog open={shareOpen} onOpenChange={setShareOpen} videoId={videoId} title={title} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="More" variant="ghost">
              <IconDots />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem icon={<IconTemplate />} onSelect={() => setTemplateOpen(true)}>
              Save as template
            </DropdownMenuItem>
            {/* Only where the bar's own Pipeline button is hidden (narrower than lg). */}
            <DropdownMenuItem icon={<IconGitBranch />} className="lg:hidden" onSelect={() => navigate(`/videos/${videoId}`)}>
              Pipeline
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <SaveTemplateDialog open={templateOpen} onOpenChange={setTemplateOpen} />
        {onInspector ? (
          <IconButton label="Properties" variant="soft" onClick={onInspector}>
            <IconAdjustmentsHorizontal />
          </IconButton>
        ) : null}
        <PublishButton onChoose={onPublish} className="hidden md:inline-flex" />
        <Button size="sm" onClick={onExport} className="pc-press">
          <IconUpload className="size-4" /> Export
        </Button>
      </div>
    </header>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export function EditorPage({ videoId }: { videoId: string }) {
  const layout = useLayout();
  const [params, setParams] = useSearchParams();
  const query = useActionQuery("get-composition", { videoId } as never);
  const composition = useEditor((state) => state.composition);
  const loadedFor = useEditor((state) => state.videoId);
  const leftOpen = useEditor((state) => state.leftOpen);
  const timeline = useTimelineSizing();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [publishTo, setPublishTo] = useState<PublishPlatform | null>(null);
  const openExport = () => (setPublishTo(null), setExportOpen(true));
  const openPublish = (platform: PublishPlatform) => (setPublishTo(platform), setExportOpen(true));
  // Back from connecting YouTube: carry on to publishing.
  useEffect(() => {
    const connected = params.get("connected");
    const error = params.get("error");
    if (!connected && !error) return;
    if (connected && connected in PUBLISH_PLATFORMS) {
      toast.success(`${PUBLISH_PLATFORMS[connected]?.label} connected`);
      openPublish(connected);
    }
    if (error) toast.error(error);
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("connected");
        next.delete("error");
        return next;
      },
      { replace: true },
    );
  }, [params]);
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
    if (layout === "laptop" || layout === "tablet") useEditor.getState().setLeftOpen(false);
    if (layout === "desktop") useEditor.getState().setLeftOpen(true);
  }, [layout]);

  useEffect(() => {
    // Tablets: selecting something opens its properties; asking the agent opens the assistant.
    if (layout !== "tablet") return;
    return useEditor.subscribe((state, previous) => {
      if (state.selectedClipIds !== previous.selectedClipIds && state.selectedClipIds.length) setInspectorOpen(true);
      if (state.assistantOpen && !previous.assistantOpen) {
        setInspectorOpen(true);
        useEditor.getState().setAssistantOpen(false);
      }
    });
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
        <p className="text-sm text-ds-text-2">This video has nothing to edit yet.</p>
        <Button asChild variant="outline" className="mt-4">
          <Link to={`/videos/${videoId}`}>Back to the pipeline</Link>
        </Button>
      </div>
    );
  }
  if (!composition || loadedFor !== videoId) return null;

  if (layout === "phone") {
    return (
      <>
        <MobileEditor onExport={openExport} />
        <ExportDialog open={exportOpen} onOpenChange={setExportOpen} platform={publishTo} onPlatformChange={setPublishTo} />
      </>
    );
  }

  const resizeHandle = (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize timeline"
      tabIndex={0}
      title="Drag to resize · double-click to hide or show the timeline"
      onDoubleClick={timeline.toggle}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp") timeline.resize(timeline.height + 24);
        if (event.key === "ArrowDown") timeline.resize(timeline.height - 24);
        if (event.key === "Enter") timeline.toggle();
      }}
      onPointerDown={(event) => {
        if (event.detail > 1) return;
        const startY = event.clientY;
        const startHeight = timeline.height;
        const move = (moveEvent: PointerEvent) => timeline.resize(startHeight - (moveEvent.clientY - startY));
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
      className={cn("group flex shrink-0 cursor-row-resize items-center justify-center", timeline.compact ? "h-1.5" : "h-2")}
    >
      <span className="h-1 w-10 rounded-full bg-ds-border group-hover:bg-ds-text-3" />
    </div>
  );

  const tablet = layout === "tablet";
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col bg-ds-bg">
      <TopBar onExport={openExport} onPublish={openPublish} {...(tablet ? { onInspector: () => setInspectorOpen(true) } : {})} compact={tablet} short={timeline.compact} />
      <div className={cn("flex min-h-0 flex-1", timeline.compact ? "gap-1.5 px-1.5" : "gap-2 px-2")}>
        <div className="relative flex min-h-0">
          <LeftPanel className={cn("ds-panel h-full", tablet && leftOpen && "absolute inset-y-0 left-0 z-40 shadow-[var(--ds-shadow-lg)]")} />
        </div>
        <div className={cn("ds-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", timeline.compact ? "p-1.5" : "p-2")}>
          <PreviewPanel className="min-h-0 flex-1" dense={timeline.compact} />
        </div>
        {!tablet ? <RightPanel className="ds-panel w-[clamp(280px,24vw,340px)] shrink-0 overflow-hidden" /> : null}
      </div>
      {resizeHandle}
      <div className={cn("ds-panel shrink-0 overflow-hidden transition-[height] duration-200 ease-[var(--ds-ease-out)] motion-reduce:transition-none", timeline.compact ? "mx-1.5 mb-1.5" : "mx-2 mb-2")} style={{ height: timeline.height }}>
        <Timeline density={timeline.compact ? "compact" : "regular"} collapsed={timeline.collapsed} onToggleCollapse={timeline.toggle} />
      </div>
      {tablet ? (
        <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}>
          <SheetContent side="right" className="w-[340px] p-0">
            <SheetTitle className="sr-only">Properties</SheetTitle>
            <SheetDescription className="sr-only">Edit the selected clip or layer.</SheetDescription>
            <RightPanel className="h-full" />
          </SheetContent>
        </Sheet>
      ) : null}
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} platform={publishTo} onPlatformChange={setPublishTo} />
    </div>
  );
}

