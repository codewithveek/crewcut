import { type Composition, type Track } from "@crewcut/composition";
import {
  IconAdjustments,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowLeft,
  IconArrowsExchange,
  IconArrowsMaximize,
  IconAspectRatio,
  IconBadgeCc,
  IconChevronLeft,
  IconClipboard,
  IconColorFilter,

  IconCopy,
  IconGauge,
  IconLayersSubtract,
  IconMicrophone,
  IconMusic,
  IconPalette,
  IconPencil,
  IconPhoto,
  IconPlus,
  IconScissors,
  IconShape,
  IconSparkles,
  IconStack2,
  IconTrash,
  IconTypography,
  IconUpload,
  IconVolume,
  IconVolumeOff,
  IconWaveSine,
  IconWand,
  IconArrowsMove,
} from "@tabler/icons-react";
import { useRef, useState } from "react";
import { Link } from "react-router";

import { BottomSheet, Button, ColorField } from "@/components/ds";
import { cn } from "@/lib/utils";

import { type Selection, addCaptionAt, copySelection, deleteSelection, describeSelection, duplicateSelection, generateCaptionsFromNarration, paste, run, setFormat, splitAtPlayhead, toggleTrack } from "./commands";
import { type LeftTab, useEditor } from "./editor-store";
import { EditorAssistant, askEditorAgent } from "./assistant";
import { EditableTitle } from "./editor-page";
import { Inspector } from "./inspector";
import { LeftTabContent, VoiceRecorder } from "./left-panel";
import { FullscreenControls, PreviewStage, Timecode, useFullscreen } from "./preview";
import { type MobileLaneKit, Timeline } from "./timeline";

/**
 * Phone editor (CapCut-style): preview on top, a timeline that scrolls under
 * a fixed centre playhead, and a bottom toolbar whose tools change with what
 * is selected. Tools open bottom sheets that reuse the desktop panels, so a
 * phone edit is the same edit as on desktop.
 */

type Sheet =
  | { kind: "left"; tab: LeftTab; title: string }
  | { kind: "inspector"; tab: string | null; title: string }
  | { kind: "format" }
  | { kind: "canvas" }
  | { kind: "record" }
  | { kind: "add" }
  | null;

interface Tool {
  id: string;
  label: string;
  icon: typeof IconPhoto;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

function toolsFor(selection: Selection, open: (sheet: Sheet) => void, composition: Composition): Tool[] {
  const inspector = (tab: string | null, title: string) => () => open({ kind: "inspector", tab, title });
  const left = (tab: LeftTab, title: string) => () => open({ kind: "left", tab, title });
  const common = {
    split: { id: "split", label: "Split", icon: IconScissors, onSelect: splitAtPlayhead },
    duplicate: { id: "duplicate", label: "Duplicate", icon: IconCopy, onSelect: () => void duplicateSelection() },
    copy: { id: "copy", label: "Copy", icon: IconClipboard, onSelect: () => void copySelection() },
    delete: { id: "delete", label: "Delete", icon: IconTrash, onSelect: () => deleteSelection(), danger: true },
  };
  switch (selection.kind) {
    case "none":
      return [
        { id: "assistant", label: "Assistant", icon: IconSparkles, onSelect: () => useEditor.getState().setAssistantOpen(true) },
        { id: "media", label: "Media", icon: IconPhoto, onSelect: left("media", "Media") },
        { id: "audio", label: "Audio", icon: IconMusic, onSelect: left("audio", "Audio") },
        { id: "text", label: "Text", icon: IconTypography, onSelect: left("text", "Text") },
        { id: "captions", label: "Captions", icon: IconBadgeCc, onSelect: left("captions", "Captions") },
        { id: "elements", label: "Elements", icon: IconShape, onSelect: left("elements", "Elements") },
        { id: "record", label: "Voiceover", icon: IconMicrophone, onSelect: () => open({ kind: "record" }) },
        { id: "format", label: "Format", icon: IconAspectRatio, onSelect: () => open({ kind: "format" }) },
        { id: "canvas", label: "Background", icon: IconPalette, onSelect: () => open({ kind: "canvas" }) },
        { id: "paste", label: "Paste", icon: IconClipboard, onSelect: () => void paste(), disabled: !useEditor.getState().clipboard },
        { id: "project", label: "Project", icon: IconAdjustments, onSelect: inspector(null, "Project") },
      ];
    case "multi":
      return [common.duplicate, common.copy, common.delete];
    case "caption":
      return [
        { id: "edit", label: "Edit", icon: IconPencil, onSelect: inspector("caption", "Edit caption") },
        { id: "style", label: "Style", icon: IconPalette, onSelect: inspector("style", "Caption style") },
        common.split,
        { id: "add", label: "Add", icon: IconPlus, onSelect: () => void addCaptionAt(selection.clip.startMs + selection.clip.durationMs) },
        { id: "auto", label: "Auto", icon: IconWand, onSelect: () => void generateCaptionsFromNarration() },
        common.duplicate,
        common.delete,
      ];
    case "audio":
      return [
        { id: "volume", label: "Volume", icon: IconVolume, onSelect: inspector("basic", "Volume & fades") },
        common.split,
        { id: "speed", label: "Speed", icon: IconGauge, onSelect: inspector("speed", "Speed") },
        common.duplicate,
        common.copy,
        common.delete,
      ];
    case "clip":
      return [
        common.split,
        { id: "animation", label: "Animation", icon: IconSparkles, onSelect: left("effects", "Animation") },
        { id: "transition", label: "Transition", icon: IconArrowsExchange, onSelect: left("transitions", "Transition") },
        { id: "filters", label: "Filters", icon: IconColorFilter, onSelect: left("filters", "Filters") },
        { id: "adjust", label: "Adjust", icon: IconAdjustments, onSelect: inspector("adjust", "Adjust") },
        { id: "layers", label: "Layers", icon: IconStack2, onSelect: inspector("layers", "Layers") },
        { id: "background", label: "Clip", icon: IconPalette, onSelect: inspector("clip", "Clip") },
        common.duplicate,
        common.delete,
      ];
    case "layer": {
      const { layer, solo } = selection;
      const tools: Tool[] = [];
      if (layer.type === "text") {
        tools.push({ id: "edit", label: "Edit", icon: IconPencil, onSelect: inspector("text", "Text") });
      }
      if (solo) tools.push(common.split);
      if (layer.type === "video") {
        tools.push({ id: "volume", label: "Volume", icon: IconVolume, onSelect: inspector("audio", "Volume") });
        tools.push({ id: "speed", label: "Speed", icon: IconGauge, onSelect: inspector("speed", "Speed") });
      }
      tools.push({ id: "transform", label: "Transform", icon: IconArrowsMove, onSelect: inspector("basic", "Transform") });
      tools.push({ id: "animation", label: "Animation", icon: IconSparkles, onSelect: inspector("animation", "Animation") });
      if (layer.type !== "text") {
        tools.push({ id: "filters", label: "Filters", icon: IconColorFilter, onSelect: inspector("adjust", "Filters & adjust") });
      }
      if (solo && (layer.type === "image" || layer.type === "video")) tools.push({ id: "transition", label: "Transition", icon: IconArrowsExchange, onSelect: left("transitions", "Transition") });
      tools.push({ id: "opacity", label: "Opacity", icon: IconLayersSubtract, onSelect: inspector("basic", "Opacity & blend") });
      tools.push(common.duplicate, common.copy, common.delete);
      tools.push({ id: "ask", label: "Ask AI", icon: IconWand, onSelect: () => void askEditorAgent("Look at the selected layer and suggest one improvement, then make it as one step I can undo.") });
      void composition;
      return tools;
    }
  }
}

function FormatSheetContent({ onDone }: { onDone: () => void }) {
  const ratio = useEditor((state) => state.composition?.ratio);
  const options = ["16:9", "9:16", "1:1", "4:5", "4:3", "3:4", "21:9", "2:3"] as const;
  return (
    <div className="grid grid-cols-4 gap-2">
      {options.map((option) => {
        const [w, h] = option.split(":").map(Number) as [number, number];
        const scale = 30 / Math.max(w, h);
        return (
          <button
            key={option}
            type="button"
            onClick={() => {
              if (option !== ratio) setFormat(option);
              onDone();
            }}
            className={cn("pc-press flex h-20 flex-col items-center justify-center gap-2 rounded-ds-md text-xs font-medium tabular", option === ratio ? "bg-ds-accent-soft text-ds-accent shadow-[inset_0_0_0_1.5px_var(--ds-accent)]" : "bg-ds-surface-2 text-ds-text-2")}
          >
            <span className="rounded-[3px] border-2 border-current" style={{ width: w * scale, height: h * scale }} />
            {option}
          </button>
        );
      })}
    </div>
  );
}

function CanvasSheetContent() {
  const composition = useEditor((state) => state.composition);
  const selectedClipIds = useEditor((state) => state.selectedClipIds);
  if (!composition) return null;
  const clipAtPlayhead = composition.tracks.find((track) => track.kind === "visual")?.clips.find((clip) => useEditor.getState().playheadMs >= clip.startMs && useEditor.getState().playheadMs < clip.startMs + clip.durationMs);
  const target = selectedClipIds[0] ?? clipAtPlayhead?.id;
  const swatches = ["#000000", "#ffffff", "#15171d", composition.brief.palette.background, composition.brief.palette.surface, composition.brief.palette.accent, "#ff5d5d", "#f97316", "#ffd400", "#3ccf7f", "#2b7de9", "#b546c9"];
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="ds-overline mb-2 text-ds-text-3">Whole video</p>
        <ColorField label="Canvas colour" value={composition.brief.palette.background} onChange={(background) => background && void run("Canvas colour", [{ op: "set-art-direction", brief: { palette: { background } } }])} />
      </div>
      {target ? (
        <div>
          <p className="ds-overline mb-2 text-ds-text-3">Clip under the playhead</p>
          <div className="grid grid-cols-6 gap-2">
            {swatches.map((swatch) => (
              <button key={swatch} type="button" aria-label={swatch} onClick={() => void run("Clip background", [{ op: "update-clip", clipId: target, patch: { background: swatch } }])} className="pc-press aspect-square rounded-ds-sm shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)]" style={{ background: swatch }} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** What a lane is for, in the person's words, and where adding to it happens. */
function laneMeta(track: Track, isMain: boolean): { icon: typeof IconPhoto; add: string; sheet: Sheet } {
  if (isMain) return { icon: IconPhoto, add: "Add photos or videos", sheet: { kind: "left", tab: "media", title: "Media" } };
  if (track.kind === "caption") return { icon: IconBadgeCc, add: "Add captions", sheet: { kind: "left", tab: "captions", title: "Captions" } };
  if (track.kind === "audio") {
    if (track.role === "voice") return { icon: IconMicrophone, add: "Add voiceover", sheet: { kind: "record" } };
    if (track.role === "music") return { icon: IconMusic, add: "Add music", sheet: { kind: "left", tab: "audio", title: "Audio" } };
    return { icon: IconWaveSine, add: "Add sound effects", sheet: { kind: "left", tab: "audio", title: "Audio" } };
  }
  return { icon: IconTypography, add: "Add text or stickers", sheet: { kind: "left", tab: "text", title: "Text" } };
}

const LEAD_TILE = "pc-press flex shrink-0 flex-col items-center justify-center gap-1 rounded-ds-sm text-[10px] font-medium leading-none outline-none focus-visible:ring-2 focus-visible:ring-ds-accent";

/**
 * The phone timeline's lead-in (CapCut style): the half-screen before 0:00
 * holds each lane's controls instead of empty space. Main track: mute its
 * sound, ask the assistant, change the format. Other lanes: a chip that adds
 * to that lane. Empty lanes get a "+ Add …" button; the main track ends in "+".
 */
function mobileLaneKit(composition: Composition, open: (sheet: Sheet) => void): MobileLaneKit {
  return {
    lead: (track, isMain) => {
      const meta = laneMeta(track, isMain);
      if (isMain) {
        const muted = Boolean((track as { muted?: boolean }).muted);
        return (
          <>
            <button type="button" onClick={() => toggleTrack(track, "muted")} aria-pressed={muted} className={cn(LEAD_TILE, "h-12 w-11", muted ? "text-ds-danger" : "text-ds-text-2")}>
              {muted ? <IconVolumeOff className="size-5" /> : <IconVolume className="size-5" />}
              {muted ? "Unmute" : "Mute"}
            </button>
            <button type="button" onClick={() => useEditor.getState().setAssistantOpen(true)} className={cn(LEAD_TILE, "h-12 w-[52px] bg-ds-surface-2 text-ds-text shadow-[inset_0_0_0_1px_var(--ds-hairline)]")}>
              <IconSparkles className="size-5 text-ds-accent" />
              Ask AI
            </button>
            <button type="button" onClick={() => open({ kind: "format" })} aria-label={`Format: ${composition.ratio}`} className={cn(LEAD_TILE, "h-12 w-[52px] bg-ds-surface-2 text-ds-text shadow-[inset_0_0_0_1px_var(--ds-hairline)]")}>
              <IconAspectRatio className="size-5 text-ds-text-2" />
              {composition.ratio}
            </button>
          </>
        );
      }
      const muted = track.kind === "audio" && Boolean((track as { muted?: boolean }).muted);
      return (
        <button type="button" onClick={() => open(meta.sheet)} aria-label={meta.add} className={cn(LEAD_TILE, "size-8 bg-ds-surface-2 shadow-[inset_0_0_0_1px_var(--ds-hairline)]", muted ? "text-ds-danger" : "text-ds-text-2")}>
          {muted ? <IconVolumeOff className="size-4" /> : <meta.icon className="size-4" />}
        </button>
      );
    },
    empty: (track, isMain) => {
      const meta = laneMeta(track, isMain);
      return { label: meta.add, onSelect: () => open(meta.sheet) };
    },
    tail: (track, isMain) =>
      isMain && track.clips.length > 0 ? (
        <button type="button" onClick={() => open({ kind: "left", tab: "media", title: "Media" })} aria-label="Add photos or videos at the end" className="pc-press flex size-10 items-center justify-center rounded-ds-sm bg-primary text-primary-foreground shadow-[var(--ds-shadow-sm)]">
          <IconPlus className="size-5" />
        </button>
      ) : null,
  };
}

function AddSheetContent({ onPick }: { onPick: (sheet: Sheet) => void }) {
  const items: Array<{ label: string; icon: typeof IconPhoto; sheet: Sheet }> = [
    { label: "Photos & videos", icon: IconPhoto, sheet: { kind: "left", tab: "media", title: "Media" } },
    { label: "Music & sounds", icon: IconMusic, sheet: { kind: "left", tab: "audio", title: "Audio" } },
    { label: "Text", icon: IconTypography, sheet: { kind: "left", tab: "text", title: "Text" } },
    { label: "Stickers & shapes", icon: IconShape, sheet: { kind: "left", tab: "elements", title: "Elements" } },
    { label: "Captions", icon: IconBadgeCc, sheet: { kind: "left", tab: "captions", title: "Captions" } },
    { label: "Voiceover", icon: IconMicrophone, sheet: { kind: "record" } },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map((item) => (
        <button key={item.label} type="button" onClick={() => onPick(item.sheet)} className="pc-press flex h-24 flex-col items-center justify-center gap-2 rounded-ds-md bg-ds-surface-2 text-center text-xs font-medium text-ds-text">
          <item.icon className="size-6 text-ds-accent" />
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function MobileEditor({ onExport }: { onExport: () => void }) {
  const composition = useEditor((state) => state.composition);
  const selectedClipIds = useEditor((state) => state.selectedClipIds);
  const selectedLayer = useEditor((state) => state.selectedLayer);
  const undoCount = useEditor((state) => state.undoStack.length);
  const assistantOpen = useEditor((state) => state.assistantOpen);
  const redoCount = useEditor((state) => state.redoStack.length);
  const [sheet, setSheet] = useState<Sheet>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const { fullscreen, enter, exit } = useFullscreen(stageRef);
  if (!composition) return null;
  const selection = describeSelection(composition, selectedClipIds, selectedLayer);
  const open = (next: Sheet) => {
    if (next?.kind === "inspector") useEditor.getState().setInspectorTab(next.tab);
    if (next?.kind === "left") useEditor.getState().setLeftTab(next.tab);
    setSheet(next);
  };
  const tools = toolsFor(selection, open, composition);
  const aspect = composition.width / composition.height;
  const sheetTitle = !sheet ? "" : sheet.kind === "left" || sheet.kind === "inspector" ? sheet.title : sheet.kind === "format" ? "Format" : sheet.kind === "canvas" ? "Background" : sheet.kind === "record" ? "Voiceover" : "Add";

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-ds-bg text-ds-text">
      <header className="flex h-12 shrink-0 items-center gap-1 px-2 pt-[env(safe-area-inset-top)]">
        <Link to="/projects" aria-label="Back to projects" className="pc-press flex size-10 shrink-0 items-center justify-center rounded-full text-ds-text-2">
          <IconArrowLeft className="size-5" />
        </Link>
        <EditableTitle className="min-w-0 flex-1 text-center" />
        <Button size="sm" className="pc-press shrink-0 rounded-full" onClick={onExport}>
          <IconUpload className="size-4" /> Export
        </Button>
      </header>

      <div ref={stageRef} className={cn("relative flex shrink-0 bg-black", fullscreen ? "fixed inset-0 z-[300]" : "")} style={fullscreen ? undefined : { height: `min(40dvh, ${Math.round(100 / aspect)}vw)` }}>
        <PreviewStage className="min-h-0 flex-1" interactive={!fullscreen} />
        {fullscreen ? <FullscreenControls onExit={() => void exit()} /> : null}
      </div>

      <div className="flex h-12 shrink-0 items-center gap-1 px-2">
        <button type="button" aria-label="Play or pause" onClick={() => useEditor.getState().setPlaying(!useEditor.getState().playing)} className="pc-press flex size-10 items-center justify-center rounded-full">
          <PlayGlyph />
        </button>
        <button type="button" aria-label="Undo" disabled={undoCount < 2} onClick={() => void useEditor.getState().undo()} className="pc-press flex size-10 items-center justify-center rounded-full text-ds-text-2 disabled:opacity-30">
          <IconArrowBackUp className="size-5" />
        </button>
        <Timecode className="mx-auto text-[12px]" />
        <button type="button" aria-label="Redo" disabled={redoCount === 0} onClick={() => void useEditor.getState().redo()} className="pc-press flex size-10 items-center justify-center rounded-full text-ds-text-2 disabled:opacity-30">
          <IconArrowForwardUp className="size-5" />
        </button>
        <button type="button" aria-label="Full screen" onClick={() => void enter()} className="pc-press flex size-10 items-center justify-center rounded-full text-ds-text-2">
          <IconArrowsMaximize className="size-5" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1 border-t border-ds-border">
        <Timeline variant="mobile" mobileLanes={mobileLaneKit(composition, open)} />
        <button type="button" aria-label="Add media, text or audio" onClick={() => open({ kind: "add" })} className="pc-press absolute bottom-3 right-3 z-30 flex size-11 items-center justify-center rounded-ds-md bg-primary text-primary-foreground shadow-[var(--ds-shadow-lg)]">
          <IconPlus className="size-5" />
        </button>
      </div>

      <nav aria-label={selection.kind === "none" ? "Editing tools" : "Tools for the selection"} className="flex shrink-0 items-stretch border-t border-ds-border bg-ds-surface pb-[env(safe-area-inset-bottom)]">
        {selection.kind !== "none" ? (
          <button type="button" aria-label="Done, clear selection" onClick={() => useEditor.getState().selectClip(null)} className="pc-press flex w-12 shrink-0 items-center justify-center border-r border-ds-border text-ds-text-2">
            <IconChevronLeft className="size-5" />
          </button>
        ) : null}
        <div className="ds-no-scrollbar flex min-w-0 flex-1 overflow-x-auto">
          {tools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              disabled={tool.disabled}
              onClick={tool.onSelect}
              className={cn("pc-press flex h-16 w-[68px] shrink-0 flex-col items-center justify-center gap-1 text-[11px] font-medium disabled:opacity-30", tool.danger ? "text-ds-danger" : "text-ds-text")}
            >
              <tool.icon className="size-[22px]" strokeWidth={1.6} />
              {tool.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Always mounted (hidden when closed) so prompts sent from tools always land in the chat. */}
      <div
        role="dialog"
        aria-modal="false"
        aria-label="Assistant"
        className={cn("fixed inset-x-0 bottom-0 z-[160] flex h-[78dvh] flex-col rounded-t-[22px] bg-ds-surface text-ds-text shadow-[var(--ds-shadow-lg),0_0_0_1px_var(--ds-hairline)]", !assistantOpen && "hidden")}
      >
        <div className="flex shrink-0 items-center gap-2 px-4 pb-1 pt-3">
          <IconSparkles className="size-4 text-ds-accent" />
          <h2 className="ds-heading min-w-0 flex-1">Assistant</h2>
          <button type="button" aria-label="Close the assistant" onClick={() => useEditor.getState().setAssistantOpen(false)} className="pc-press flex size-9 items-center justify-center rounded-full bg-ds-surface-2 text-ds-text-2">
            <IconChevronLeft className="size-5 -rotate-90" />
          </button>
        </div>
        <EditorAssistant className="pb-[env(safe-area-inset-bottom)]" />
      </div>

      <BottomSheet open={sheet !== null} onOpenChange={(value) => !value && setSheet(null)} title={sheetTitle} modal={sheet?.kind === "add" || sheet?.kind === "format"}>
        {sheet?.kind === "left" ? (
          <div className="-mx-4 flex h-[55dvh] min-h-0 flex-col">
            <LeftTabContent tab={sheet.tab} />
          </div>
        ) : sheet?.kind === "inspector" ? (
          <div className="-mx-4 flex h-[50dvh] min-h-0 flex-col">
            <Inspector className="min-h-0 flex-1" />
          </div>
        ) : sheet?.kind === "format" ? (
          <FormatSheetContent onDone={() => setSheet(null)} />
        ) : sheet?.kind === "canvas" ? (
          <CanvasSheetContent />
        ) : sheet?.kind === "record" ? (
          <VoiceRecorder onAdded={() => setSheet(null)} />
        ) : sheet?.kind === "add" ? (
          <AddSheetContent onPick={(next) => open(next)} />
        ) : null}
      </BottomSheet>
    </div>
  );
}

function PlayGlyph() {
  const playing = useEditor((state) => state.playing);
  return playing ? (
    <svg viewBox="0 0 24 24" className="size-6 fill-current" aria-hidden>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="size-6 fill-current" aria-hidden>
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
    </svg>
  );
}


