import { clipEndMs, formatTimecode } from "@proofcut/composition";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { useEditor } from "./editor-store";

/** Scenes → layers, with each scene's narration lines (Cutroom's script tree, layer-aware). */
export function SceneTree({ className }: { className?: string }) {
  const composition = useEditor((state) => state.composition);
  const playheadMs = useEditor((state) => state.playheadMs);
  const selectedClipIds = useEditor((state) => state.selectedClipIds);
  const selectedLayer = useEditor((state) => state.selectedLayer);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  if (!composition) return null;
  const scenes = composition.tracks.find((track) => track.kind === "visual");
  const voice = composition.tracks.find((track) => track.kind === "audio" && track.role === "voice");
  const voiceClips = voice?.kind === "audio" ? voice.clips : [];

  return (
    <nav className={cn("flex min-h-0 flex-col overflow-y-auto py-2", className)} aria-label="Scenes">
      {scenes?.kind === "visual"
        ? scenes.clips.map((clip, index) => {
            const open = !collapsed.has(clip.id);
            const active = playheadMs >= clip.startMs && playheadMs < clipEndMs(clip);
            const lines = voiceClips.filter((line) => line.lineId && clip.lineIds.includes(line.lineId));
            return (
              <div key={clip.id} className="px-2">
                <div className={cn("flex items-center gap-1 rounded-md", selectedClipIds.includes(clip.id) && !selectedLayer && "bg-pc-accent-soft")}>
                  <button
                    type="button"
                    aria-label={open ? "Collapse scene" : "Expand scene"}
                    onClick={() => setCollapsed((current) => {
                      const next = new Set(current);
                      if (next.has(clip.id)) next.delete(clip.id);
                      else next.add(clip.id);
                      return next;
                    })}
                    className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                  >
                    {open ? <IconChevronDown className="size-3.5" /> : <IconChevronRight className="size-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const state = useEditor.getState();
                      state.selectClip(clip.id);
                      state.selectLayer(null);
                      state.setPlayhead(clip.startMs);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
                  >
                    <span className={cn("size-1.5 shrink-0 rounded-full", active ? "bg-pc-accent" : "bg-transparent")} />
                    <span className="truncate text-[13px] font-medium text-foreground">
                      {index + 1}. {clip.name ?? clip.id}
                    </span>
                    <span className="ml-auto shrink-0 pr-1 font-mono text-[10px] text-muted-foreground tabular">{formatTimecode(clip.startMs, { fps: composition.fps }).slice(3, 8)}</span>
                  </button>
                </div>
                {open ? (
                  <div className="mb-1 ml-7 flex flex-col">
                    {lines.map((line) => (
                      <button
                        key={line.id}
                        type="button"
                        onClick={() => useEditor.getState().setPlayhead(line.startMs)}
                        className="rounded px-1.5 py-1 text-left text-[12px] leading-snug text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        “{line.text}”
                      </button>
                    ))}
                    {[...clip.layers].reverse().map((layer) => (
                      <button
                        key={layer.id}
                        type="button"
                        onClick={() => useEditor.getState().selectLayer({ clipId: clip.id, layerId: layer.id })}
                        className={cn(
                          "flex items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] hover:bg-accent",
                          selectedLayer?.layerId === layer.id ? "bg-pc-accent-soft text-foreground" : "text-muted-foreground",
                        )}
                      >
                        <span className="w-10 shrink-0 font-mono text-[9px] uppercase">{layer.type}</span>
                        <span className="truncate">{layer.type === "text" ? layer.text.replace(/\*/g, "").replace(/\n/g, " ") : (layer.name ?? layer.id)}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })
        : null}
    </nav>
  );
}
