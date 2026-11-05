import {
  type AnyClip,
  FILTER_PRESETS,
  FILTER_PRESET_INFO,
  type Layer,
  type LeafLayer,
  MOTION_PRESETS,
  TEXT_PRESETS,
  TRANSITION_PRESETS,
  type Track,
  type VisualClip,
  clipEndMs,
} from "@crewcut/composition";
import {
  IconArrowBarToLeft,
  IconArrowBarToRight,
  IconArrowsExchange,
  IconBadgeCc,
  IconBookmark,
  IconClipboard,
  IconColorFilter,
  IconCopy,
  IconCut,
  IconDiamond,
  IconEye,
  IconEyeOff,
  IconFlipHorizontal,
  IconFlipVertical,
  IconGauge,
  IconLayersSubtract,
  IconLock,
  IconLockOpen,
  IconPencil,
  IconPlus,
  IconScissors,
  IconSparkles,
  IconStack2,
  IconTrash,
  IconTypography,
  IconVolume,
  IconVolumeOff,
} from "@tabler/icons-react";

import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ds";

import {
  addCaptionAt,
  addElementAt,
  addTrack,
  applyFilter,
  applyMotion,
  applyTransition,
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  paste,
  removeTrack,
  run,
  selectionContext,
  soloLayer,
  splitAtPlayhead,
  toggleTrack,
  trackSpecOf,
  transformOps,
  trimToPlayhead,
} from "./commands";
import { askEditorAgent } from "./assistant";
import { useEditor } from "./editor-store";

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

function TrackStateItems({ track }: { track: Track }) {
  const muted = track.kind !== "caption" && Boolean((track as { muted?: boolean }).muted);
  return (
    <>
      <ContextMenuItem icon={track.locked ? <IconLockOpen /> : <IconLock />} onSelect={() => toggleTrack(track, "locked")}>
        {track.locked ? "Unlock track" : "Lock track"}
      </ContextMenuItem>
      {track.kind !== "audio" ? (
        <ContextMenuItem icon={track.hidden ? <IconEye /> : <IconEyeOff />} onSelect={() => toggleTrack(track, "hidden")}>
          {track.hidden ? "Show track" : "Hide track"}
        </ContextMenuItem>
      ) : null}
      {track.kind !== "caption" ? (
        <ContextMenuItem icon={muted ? <IconVolume /> : <IconVolumeOff />} onSelect={() => toggleTrack(track, "muted")}>
          {muted ? "Unmute track" : "Mute track"}
        </ContextMenuItem>
      ) : null}
    </>
  );
}

function SpeedSub({ clipId }: { clipId: string }) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger icon={<IconGauge />}>Speed</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        {[0.25, 0.5, 0.75, 1, 1.5, 2, 3].map((rate) => (
          <ContextMenuItem key={rate} onSelect={() => void run(`Speed ${rate}×`, [{ op: "set-clip-speed", clipId, rate }])}>
            {rate}×
          </ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

function VisualEffectSubs({ clip, layerId }: { clip: VisualClip; layerId?: string }) {
  const layerIds = layerId ? [layerId] : clip.layers.filter((layer) => layer.type !== "camera").map((layer) => layer.id);
  return (
    <>
      <ContextMenuSub>
        <ContextMenuSubTrigger icon={<IconArrowsExchange />}>Transition in</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem onSelect={() => applyTransition(clip.id, null)}>None (cut)</ContextMenuItem>
          {TRANSITION_PRESETS.filter((preset) => preset.transition.type !== "cut").map((preset) => (
            <ContextMenuItem key={preset.id} onSelect={() => applyTransition(clip.id, preset.transition)}>
              {preset.label}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger icon={<IconColorFilter />}>Filter</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem onSelect={() => applyFilter({ clipId: clip.id, ...(layerId ? { layerId } : {}) }, null)}>None</ContextMenuItem>
          {FILTER_PRESETS.map((preset) => (
            <ContextMenuItem key={preset} onSelect={() => applyFilter({ clipId: clip.id, ...(layerId ? { layerId } : {}) }, preset)}>
              {FILTER_PRESET_INFO[preset].label}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      {layerIds.length ? (
        <ContextMenuSub>
          <ContextMenuSubTrigger icon={<IconSparkles />}>Animation</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuLabel>In</ContextMenuLabel>
            {MOTION_PRESETS.filter((preset) => preset.group === "enter" || preset.group === "text").map((preset) => (
              <ContextMenuItem key={preset.id} onSelect={() => applyMotion(clip.id, layerIds, preset.id, "enter")}>
                {preset.label}
              </ContextMenuItem>
            ))}
            <ContextMenuSeparator />
            <ContextMenuLabel>Out</ContextMenuLabel>
            {MOTION_PRESETS.filter((preset) => preset.supportsExit).map((preset) => (
              <ContextMenuItem key={`${preset.id}-out`} onSelect={() => applyMotion(clip.id, layerIds, preset.id, "exit")}>
                {preset.label}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      ) : null}
    </>
  );
}

function ClipboardItems() {
  const hasClipboard = useEditor((state) => state.clipboard !== null);
  return (
    <>
      <ContextMenuItem icon={<IconCut />} shortcut={`${MOD}X`} onSelect={cutSelection}>
        Cut
      </ContextMenuItem>
      <ContextMenuItem icon={<IconCopy />} shortcut={`${MOD}C`} onSelect={() => copySelection()}>
        Copy
      </ContextMenuItem>
      <ContextMenuItem icon={<IconClipboard />} shortcut={`${MOD}V`} disabled={!hasClipboard} onSelect={() => void paste()}>
        Paste at playhead
      </ContextMenuItem>
      <ContextMenuItem icon={<IconStack2 />} shortcut={`${MOD}D`} onSelect={() => void duplicateSelection()}>
        Duplicate
      </ContextMenuItem>
    </>
  );
}

/** Right-click on a timeline clip. */
export function ClipMenu({ clip, track }: { clip: AnyClip; track: Track }) {
  const playheadMs = useEditor((state) => state.playheadMs);
  const inside = playheadMs > clip.startMs && playheadMs < clipEndMs(clip);
  const solo = "layers" in clip ? soloLayer(clip) : null;
  const hasSpeed = "src" in clip || solo?.type === "video";
  return (
    <ContextMenuContent>
      <ClipboardItems />
      <ContextMenuSeparator />
      <ContextMenuItem icon={<IconScissors />} shortcut="S" disabled={!inside} onSelect={splitAtPlayhead}>
        Split at playhead
      </ContextMenuItem>
      <ContextMenuItem icon={<IconArrowBarToLeft />} shortcut="Q" disabled={!inside} onSelect={() => trimToPlayhead("start")}>
        Trim start to playhead
      </ContextMenuItem>
      <ContextMenuItem icon={<IconArrowBarToRight />} shortcut="W" disabled={!inside} onSelect={() => trimToPlayhead("end")}>
        Trim end to playhead
      </ContextMenuItem>
      <ContextMenuSeparator />
      {hasSpeed ? <SpeedSub clipId={clip.id} /> : null}
      {"layers" in clip ? <VisualEffectSubs clip={clip} {...(solo ? { layerId: solo.id } : {})} /> : null}
      {"words" in clip ? (
        <ContextMenuItem icon={<IconPencil />} onSelect={() => useEditor.getState().setLeftTab("captions")}>
          Edit captions
        </ContextMenuItem>
      ) : null}
      <ContextMenuSeparator />
      <TrackStateItems track={track} />
      <ContextMenuItem icon={<IconSparkles />} onSelect={() => void askEditorAgent("Look at the selected clip and suggest one improvement, then make it as one step I can undo.", selectionContext())}>
        Ask the agent about this
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem icon={<IconTrash />} shortcut="Del" danger onSelect={() => deleteSelection(false)}>
        Delete
      </ContextMenuItem>
      <ContextMenuItem icon={<IconLayersSubtract />} shortcut="⇧Del" danger onSelect={() => deleteSelection(true)}>
        Delete and close gap
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

/** Right-click on a layer in the preview or the layer list. */
export function LayerMenu({ clip, layer }: { clip: VisualClip; layer: Layer | LeafLayer }) {
  const index = clip.layers.findIndex((candidate) => candidate.id === layer.id);
  const top = clip.layers.length - 1;
  const reorder = (toIndex: number, label: string) => void run(label, [{ op: "reorder-layer", clipId: clip.id, layerId: layer.id, toIndex }]);
  const flip = (axis: "flipX" | "flipY") => void run(axis === "flipX" ? "Flip horizontal" : "Flip vertical", [{ op: "update-layer", clipId: clip.id, layerId: layer.id, patch: { [axis]: !layer[axis] } }]);
  return (
    <ContextMenuContent>
      <ClipboardItems />
      <ContextMenuSeparator />
      {index >= 0 && clip.layers.length > 1 ? (
        <ContextMenuSub>
          <ContextMenuSubTrigger icon={<IconStack2 />}>Arrange</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem disabled={index === top} onSelect={() => reorder(top, "Bring to front")}>
              Bring to front
            </ContextMenuItem>
            <ContextMenuItem disabled={index === top} onSelect={() => reorder(index + 1, "Bring forward")}>
              Bring forward
            </ContextMenuItem>
            <ContextMenuItem disabled={index === 0} onSelect={() => reorder(index - 1, "Send backward")}>
              Send backward
            </ContextMenuItem>
            <ContextMenuItem disabled={index === 0} onSelect={() => reorder(0, "Send to back")}>
              Send to back
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      ) : null}
      <ContextMenuItem icon={<IconFlipHorizontal />} onSelect={() => flip("flipX")}>
        Flip horizontal
      </ContextMenuItem>
      <ContextMenuItem icon={<IconFlipVertical />} onSelect={() => flip("flipY")}>
        Flip vertical
      </ContextMenuItem>
      <ContextMenuItem
        icon={<IconDiamond />}
        onSelect={() => {
          const ops = transformOps(clip, layer, { x: layer.transform.x, y: layer.transform.y, scale: layer.transform.scale, opacity: layer.transform.opacity });
          // Force keyframes even for static properties.
          const localMs = Math.round(useEditor.getState().playheadMs - clip.startMs - layer.startMs);
          void run("Keyframe position, scale, opacity", [
            ...ops.filter((op) => op.op !== "update-layer"),
            ...(["x", "y", "scale", "opacity"] as const)
              .filter((property) => !layer.keyframes[property]?.length)
              .map((property) => ({ op: "set-keyframe" as const, clipId: clip.id, layerId: layer.id, property, atMs: localMs, value: layer.transform[property] })),
          ]);
        }}
      >
        Keyframe here
      </ContextMenuItem>
      <ContextMenuSeparator />
      <VisualEffectSubs clip={clip} layerId={layer.id} />
      <ContextMenuSeparator />
      <ContextMenuItem icon={layer.hidden ? <IconEye /> : <IconEyeOff />} onSelect={() => void run(layer.hidden ? "Show layer" : "Hide layer", [{ op: "update-layer", clipId: clip.id, layerId: layer.id, patch: { hidden: !layer.hidden } }])}>
        {layer.hidden ? "Show layer" : "Hide layer"}
      </ContextMenuItem>
      <ContextMenuItem icon={<IconSparkles />} onSelect={() => void askEditorAgent("Look at the selected layer and suggest one improvement, then make it as one step I can undo.", selectionContext())}>
        Ask the agent about this
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem icon={<IconTrash />} shortcut="Del" danger onSelect={() => deleteSelection(false)}>
        Delete
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

/** Right-click on a track header. */
export function TrackMenu({ track }: { track: Track }) {
  const visualCount = useEditor((state) => state.composition?.tracks.filter((candidate) => candidate.kind === "visual").length ?? 0);
  const isMain = useEditor((state) => state.composition?.tracks.find((candidate) => candidate.kind === "visual")?.id === track.id);
  return (
    <ContextMenuContent>
      <ContextMenuLabel>{track.name}</ContextMenuLabel>
      <TrackStateItems track={track} />
      <ContextMenuSeparator />
      {track.kind !== "caption" ? (
        <ContextMenuItem icon={<IconPlus />} onSelect={() => addTrack(trackSpecOf(track))}>
          Add {track.kind === "audio" ? `${track.role} ` : "overlay "}track
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem icon={<IconTrash />} danger disabled={isMain || (track.kind === "visual" && visualCount <= 1)} onSelect={() => removeTrack(track)}>
        Delete track
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

/** Right-click on empty space in a lane. */
export function LaneMenu({ track, atMs }: { track: Track; atMs: number }) {
  const hasClipboard = useEditor((state) => state.clipboard !== null);
  const brief = useEditor((state) => state.composition?.brief);
  const title = TEXT_PRESETS.find((preset) => preset.id === "subtitle");
  return (
    <ContextMenuContent>
      <ContextMenuItem icon={<IconClipboard />} disabled={!hasClipboard} onSelect={() => void paste(atMs)}>
        Paste here
      </ContextMenuItem>
      {track.kind === "visual" && brief && title ? (
        <ContextMenuItem icon={<IconTypography />} onSelect={() => void addElementAt(title.build(brief), atMs)}>
          Add text here
        </ContextMenuItem>
      ) : null}
      {track.kind === "caption" ? (
        <ContextMenuItem icon={<IconBadgeCc />} onSelect={() => void addCaptionAt(atMs)}>
          Add caption here
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem icon={<IconBookmark />} onSelect={() => void run("Add marker", [{ op: "set-marker", atMs: Math.round(atMs), label: "" }])}>
        Add marker here
      </ContextMenuItem>
      <ContextMenuItem icon={<IconScissors />} onSelect={splitAtPlayhead}>
        Split at playhead
      </ContextMenuItem>
      <ContextMenuSeparator />
      <TrackStateItems track={track} />
    </ContextMenuContent>
  );
}
