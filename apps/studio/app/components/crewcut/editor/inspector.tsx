import { callAction } from "@agent-native/core/client/hooks";
import {
  ASPECT_RATIOS,
  ASPECT_RATIO_INFO,
  type Adjust,
  type AnimatableProperty,
  type AudioTrack,
  BLEND_MODES,
  CAPTION_HIGHLIGHT_STYLES,
  CAPTION_PRESETS,
  type CaptionClip,
  type Composition,
  type CompositionOpInput,
  DEFAULT_ADJUST,
  FILTER_PRESETS,
  FILTER_PRESET_INFO,
  FONT_FAMILIES,
  type Filter,
  type Layer,
  type LeafLayer,
  MOTION_PRESETS,
  TRANSITION_PRESETS,
  TRANSITION_CATALOG,
  TRANSITION_GROUP_LABELS,
  TRANSITION_TYPES,
  type TransitionType,
  defaultTransition,
  type TextLayer,
  type VisualClip,
  colorFilterCss,
  formatTimecode,
  lintMotion,
  parseTimecode,
  resolveLayerTransform,
} from "@crewcut/composition";
import {
  IconAlignBoxCenterMiddle,
  IconAlignBoxLeftMiddle,
  IconAlignBoxRightMiddle,
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconArrowDown,
  IconArrowUp,
  IconBadgeCc,
  IconDiamondFilled,
  IconEye,
  IconEyeOff,
  IconFlipHorizontal,
  IconFlipVertical,
  IconHistory,
  IconLayoutAlignBottom,
  IconLayoutAlignMiddle,
  IconLayoutAlignTop,
  IconMusic,
  IconPhoto,
  IconPlus,
  IconRefresh,
  IconRobot,
  IconSparkles,
  IconStack2,
  IconTrash,
  IconTypography,
  IconUser,
  IconVideo,
  IconWaveSine,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  Button,
  ColorField,
  ContextMenu,
  ContextMenuTrigger,
  FieldRow,
  IconButton,
  InfiniteSentinel,
  KeyframeToggle,
  type KeyframeToggleProps,
  ScrubField,
  Section,
  Segmented,
  Select,
  SliderField,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextField,
} from "@/components/ds";
import { errorMessage, formatAgo } from "@/lib/crewcut";
import { cn } from "@/lib/utils";

import { FILTER_SAMPLE } from "./left-panel";
import { ReplaceMediaDialog } from "./replace-media";
import { type Selection, applyFilter, applyMotion, copySelection, deleteSelection, describeSelection, duplicateSelection, offerLookForAll, offerTransitionForAll, setFormat, snapCutsToBeat, transformOps } from "./commands";
import { LayerMenu } from "./context-menus";
import { askEditorAgent } from "./assistant";
import { useEditor } from "./editor-store";

// ── Plumbing ────────────────────────────────────────────────────────────────

const preview = (ops: CompositionOpInput[]) => useEditor.getState().preview(ops);
const commit = (label: string, ops: CompositionOpInput[]) => void useEditor.getState().commitOps(label, ops);
/** Commit, then (if it saved) run a follow-up such as an "apply to all" offer. */
const commitThen = (label: string, ops: CompositionOpInput[], after: () => void) =>
  void useEditor
    .getState()
    .commitOps(label, ops)
    .then((ok) => ok && after());

function useLocalMs(clip: VisualClip, layer: { startMs: number }): number {
  const playheadMs = useEditor((state) => state.playheadMs);
  return playheadMs - clip.startMs - layer.startMs;
}

function keyframeProps(composition: Composition, clip: VisualClip, layer: Layer | LeafLayer, localMs: number, property: AnimatableProperty, value: number, label: string): KeyframeToggleProps {
  const tolerance = 1000 / composition.fps / 2;
  const keys = layer.keyframes[property] ?? [];
  const at = keys.find((key) => Math.abs(key.atMs - localMs) < tolerance);
  return {
    label,
    state: at ? "on" : keys.length ? "has" : "none",
    onToggle: () =>
      at
        ? commit(`Remove ${label} keyframe`, [{ op: "remove-keyframe", clipId: clip.id, layerId: layer.id, property, atMs: at.atMs }])
        : commit(`${label} keyframe`, [{ op: "set-keyframe", clipId: clip.id, layerId: layer.id, property, atMs: Math.round(localMs), value }]),
  };
}

interface TabSpec {
  id: string;
  label: string;
  content: React.ReactNode;
}

function InspectorFrame({ icon, title, subtitle, tabs, actions }: { icon: React.ReactNode; title: string; subtitle?: string; tabs: TabSpec[]; actions?: React.ReactNode }) {
  const requested = useEditor((state) => state.inspectorTab);
  const value = tabs.some((tab) => tab.id === requested) ? (requested as string) : (tabs[0]?.id ?? "");
  return (
    <Tabs value={value} onValueChange={(tab) => useEditor.getState().setInspectorTab(tab)} className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-ds-sm bg-ds-surface-2 text-ds-text-2 [&_svg]:size-4">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-ds-text">{title}</p>
          {subtitle ? <p className="truncate text-[11px] text-ds-text-3">{subtitle}</p> : null}
        </div>
        {actions}
      </div>
      {tabs.length > 1 ? (
        <TabsList className="ds-no-scrollbar shrink-0 overflow-x-auto">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      ) : (
        <div className="border-b border-ds-border" />
      )}
      {tabs.map((tab) => (
        <TabsContent key={tab.id} value={tab.id} className="min-h-0 flex-1 overflow-y-auto outline-none">
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}

// ── Transform (image-4 style) ───────────────────────────────────────────────

function TransformSections({ composition, clip, layer }: { composition: Composition; clip: VisualClip; layer: Layer | LeafLayer }) {
  const localMs = useLocalMs(clip, layer);
  const resolved = resolveLayerTransform(layer, localMs, composition.seed);
  const key = (property: AnimatableProperty, value: number, label: string) => keyframeProps(composition, clip, layer, localMs, property, value, label);
  const live = (props: Partial<Record<AnimatableProperty, number>>) => preview(transformOps(clip, layer, props));
  const save = (label: string, props: Partial<Record<AnimatableProperty, number>>) => commit(label, transformOps(clip, layer, props));
  const pxX = (resolved.x / 100) * composition.width;
  const pxY = (resolved.y / 100) * composition.height;
  const positionKey = key("x", resolved.x, "Position");
  const hasCrop = resolved.clipTop + resolved.clipRight + resolved.clipBottom + resolved.clipLeft > 0;
  const align = (edge: "left" | "center" | "right" | "top" | "middle" | "bottom") => commit(`Align ${edge}`, [{ op: "align-layers", targets: [{ clipId: clip.id, layerId: layer.id }], edge }]);
  return (
    <>
      <Section title="Transform">
        <div className="grid grid-cols-[72px_minmax(0,1fr)_minmax(0,1fr)_20px] items-center gap-2">
          <span className="text-xs text-ds-text-2">Position</span>
          <ScrubField label="X" unit="px" step={1} value={Math.round(pxX)} onScrub={(value) => live({ x: (value / composition.width) * 100 })} onCommit={(value) => save("Move X", { x: (value / composition.width) * 100 })} />
          <ScrubField label="Y" unit="px" step={1} value={Math.round(pxY)} onScrub={(value) => live({ y: (value / composition.height) * 100 })} onCommit={(value) => save("Move Y", { y: (value / composition.height) * 100 })} />
          <KeyframeToggle
            {...positionKey}
            onToggle={() =>
              positionKey.state === "on"
                ? commit("Remove position keyframe", (["x", "y"] as const).map((property) => ({ op: "remove-keyframe" as const, clipId: clip.id, layerId: layer.id, property, atMs: Math.round(localMs) })))
                : commit("Position keyframe", (["x", "y"] as const).map((property) => ({ op: "set-keyframe" as const, clipId: clip.id, layerId: layer.id, property, atMs: Math.round(localMs), value: resolved[property] })))
            }
          />
        </div>
        <SliderField label="Scale" value={resolved.scale} min={0.05} max={4} step={0.01} unit="%" format={(v) => Math.round(v * 100)} parse={(v) => v / 100} onChange={(scale) => live({ scale })} onCommit={(scale) => save("Scale", { scale })} keyframe={key("scale", resolved.scale, "Scale")} />
        <SliderField label="Scale X" value={resolved.scaleX} min={0.05} max={4} step={0.01} unit="%" format={(v) => Math.round(v * 100)} parse={(v) => v / 100} onChange={(scaleX) => live({ scaleX })} onCommit={(scaleX) => save("Scale X", { scaleX })} keyframe={key("scaleX", resolved.scaleX, "Scale X")} />
        <SliderField label="Scale Y" value={resolved.scaleY} min={0.05} max={4} step={0.01} unit="%" format={(v) => Math.round(v * 100)} parse={(v) => v / 100} onChange={(scaleY) => live({ scaleY })} onCommit={(scaleY) => save("Scale Y", { scaleY })} keyframe={key("scaleY", resolved.scaleY, "Scale Y")} />
        <SliderField label="Rotate" value={resolved.rotation} min={-180} max={180} step={1} unit="°" centered onChange={(rotation) => live({ rotation })} onCommit={(rotation) => save("Rotate", { rotation })} keyframe={key("rotation", resolved.rotation, "Rotation")} />
        {layer.type !== "text" && layer.type !== "group" ? (
          <div className="grid grid-cols-[72px_minmax(0,1fr)_minmax(0,1fr)_20px] items-center gap-2">
            <span className="text-xs text-ds-text-2">Size</span>
            <ScrubField label="W" unit="%" step={0.5} min={0.5} value={Math.round((resolved.width ?? 10) * 10) / 10} onScrub={(width) => live({ width })} onCommit={(width) => save("Width", { width })} />
            <ScrubField label="H" unit="%" step={0.5} min={0.5} value={Math.round((resolved.height ?? 10) * 10) / 10} onScrub={(height) => live({ height })} onCommit={(height) => save("Height", { height })} />
            <span />
          </div>
        ) : null}
        <FieldRow label="Flip & align">
          <IconButton size="sm" label="Flip horizontal" active={layer.flipX} onClick={() => commit("Flip horizontal", [{ op: "update-layer", clipId: clip.id, layerId: layer.id, patch: { flipX: !layer.flipX } }])}>
            <IconFlipHorizontal />
          </IconButton>
          <IconButton size="sm" label="Flip vertical" active={layer.flipY} onClick={() => commit("Flip vertical", [{ op: "update-layer", clipId: clip.id, layerId: layer.id, patch: { flipY: !layer.flipY } }])}>
            <IconFlipVertical />
          </IconButton>
          <span className="mx-0.5 h-4 w-px bg-ds-border" />
          <IconButton size="sm" label="Align left" onClick={() => align("left")}>
            <IconAlignBoxLeftMiddle />
          </IconButton>
          <IconButton size="sm" label="Centre horizontally" onClick={() => align("center")}>
            <IconAlignBoxCenterMiddle />
          </IconButton>
          <IconButton size="sm" label="Align right" onClick={() => align("right")}>
            <IconAlignBoxRightMiddle />
          </IconButton>
          <IconButton size="sm" label="Align top" onClick={() => align("top")}>
            <IconLayoutAlignTop />
          </IconButton>
          <IconButton size="sm" label="Centre vertically" onClick={() => align("middle")}>
            <IconLayoutAlignMiddle />
          </IconButton>
          <IconButton size="sm" label="Align bottom" onClick={() => align("bottom")}>
            <IconLayoutAlignBottom />
          </IconButton>
        </FieldRow>
      </Section>
      <Section title="Blending">
        <FieldRow label="Blend">
          <Select label="Blend mode" className="w-full" value={layer.blendMode} onChange={(blendMode) => commit(`Blend: ${blendMode}`, [{ op: "update-layer", clipId: clip.id, layerId: layer.id, patch: { blendMode } }])} options={BLEND_MODES.map((mode) => ({ value: mode, label: mode.replace("-", " ").replace(/^\w/, (c) => c.toUpperCase()) }))} />
        </FieldRow>
        <SliderField label="Opacity" value={resolved.opacity} min={0} max={1} step={0.01} unit="%" format={(v) => Math.round(v * 100)} parse={(v) => v / 100} onChange={(opacity) => live({ opacity })} onCommit={(opacity) => save("Opacity", { opacity })} keyframe={key("opacity", resolved.opacity, "Opacity")} />
        <SliderField label="Blur" value={resolved.blur} min={0} max={40} step={0.5} unit="px" onChange={(blur) => live({ blur })} onCommit={(blur) => save("Blur", { blur })} keyframe={key("blur", resolved.blur, "Blur")} />
      </Section>
      <Section
        title="Crop"
        defaultOpen={hasCrop}
        enabled={hasCrop}
        onEnabledChange={(enabled) => commit(enabled ? "Crop" : "Remove crop", transformOps(clip, layer, enabled ? { clipTop: 5, clipBottom: 5, clipLeft: 5, clipRight: 5 } : { clipTop: 0, clipBottom: 0, clipLeft: 0, clipRight: 0 }))}
      >
        {(
          [
            ["clipTop", "Top"],
            ["clipBottom", "Bottom"],
            ["clipLeft", "Left"],
            ["clipRight", "Right"],
          ] as const
        ).map(([property, label]) => (
          <SliderField key={property} label={label} value={resolved[property]} min={0} max={100} step={0.5} unit="%" onChange={(value) => live({ [property]: value })} onCommit={(value) => save(`Crop ${label.toLowerCase()}`, { [property]: value })} keyframe={key(property, resolved[property], `Crop ${label}`)} />
        ))}
      </Section>
    </>
  );
}

function MediaSection({ clip, layer }: { clip: VisualClip; layer: Extract<Layer, { type: "image" | "video" }> }) {
  const [replacing, setReplacing] = useState(false);
  const assetUrls = useEditor((state) => state.assetUrls);
  const src = layer.src.startsWith("asset:") ? (assetUrls[layer.src.slice(6)] ?? "") : layer.src;
  const slotLabel = layer.slot ? (layer.name ?? layer.slot) : undefined;
  return (
    <Section title={layer.type === "video" ? "Video" : "Image"}>
      <div className="flex items-center gap-3">
        <span className="block size-14 shrink-0 overflow-hidden rounded-ds-sm bg-ds-surface-2 shadow-[0_0_0_1px_var(--ds-hairline)]">
          {src ? layer.type === "image" ? <img src={src} alt="" className="h-full w-full object-cover" /> : <video src={src} muted preload="metadata" className="h-full w-full object-cover" /> : null}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {layer.slot ? <span className="truncate text-[11px] text-ds-text-3">Template spot · {slotLabel}</span> : null}
          <Button size="sm" variant="outline" className="pc-press self-start" onClick={() => setReplacing(true)}>
            {layer.type === "image" ? "Replace photo" : "Replace video"}
          </Button>
        </div>
      </div>
      <ReplaceMediaDialog open={replacing} onOpenChange={setReplacing} target={{ clipId: clip.id, layerId: layer.id }} kind={layer.type} slotLabel={slotLabel} />
      <FieldRow label="Fit">
        <Segmented ariaLabel="Fit" size="sm" value={layer.fit} onChange={(fit) => commit(fit === "cover" ? "Fill frame" : "Fit frame", [{ op: "update-layer", clipId: clip.id, layerId: layer.id, patch: { fit } }])} options={[{ value: "contain", label: "Fit" }, { value: "cover", label: "Fill" }]} />
      </FieldRow>
      <SliderField label="Corners" value={layer.radius} min={0} max={200} step={1} unit="px" onChange={(radius) => preview([{ op: "update-layer", clipId: clip.id, layerId: layer.id, patch: { radius } }])} onCommit={(radius) => commit("Corner radius", [{ op: "update-layer", clipId: clip.id, layerId: layer.id, patch: { radius } }])} />
      <FieldRow label="Background">
        <ColorField label="Clip background" allowNone value={typeof clip.background === "string" ? clip.background : undefined} onChange={(background) => commit("Background", [{ op: "update-clip", clipId: clip.id, patch: { background } }])} />
      </FieldRow>
    </Section>
  );
}

// ── Text ────────────────────────────────────────────────────────────────────

const FONT_OPTIONS = [
  { value: "display", label: "Headline (this video's style)", group: "Pairing" },
  { value: "body", label: "Body (this video's style)", group: "Pairing" },
  { value: "mono", label: "Monospace (this video's style)", group: "Pairing" },
  ...FONT_FAMILIES.map((family) => ({ value: family, label: family, group: "Fonts" })),
];
const WEIGHTS = [300, 400, 500, 600, 700, 800, 900].map((weight) => ({ value: String(weight), label: String(weight) }));

function TextSections({ composition, clip, layer }: { composition: Composition; clip: VisualClip; layer: TextLayer }) {
  const { style } = layer;
  const patch = (label: string, stylePatch: Record<string, unknown>) => commit(label, [{ op: "update-layer", clipId: clip.id, layerId: layer.id, patch: { style: stylePatch } }]);
  const live = (stylePatch: Record<string, unknown>) => preview([{ op: "update-layer", clipId: clip.id, layerId: layer.id, patch: { style: stylePatch } }]);
  const [focusKey, setFocusKey] = useState(0);
  useEffect(() => {
    const focus = () => setFocusKey((value) => value + 1);
    window.addEventListener("crewcut:edit-text", focus);
    return () => window.removeEventListener("crewcut:edit-text", focus);
  }, []);
  useEffect(() => {
    if (focusKey) document.getElementById(`text-${layer.id}`)?.focus();
  }, [focusKey, layer.id]);
  return (
    <>
      <Section title="Text">
        <div id={`text-wrap-${layer.id}`}>
          <TextFieldWithId id={`text-${layer.id}`} value={layer.text} onCommit={(text) => commit("Edit text", [{ op: "update-layer", clipId: clip.id, layerId: layer.id, patch: { text } }])} />
        </div>
        <p className="text-[11px] text-ds-text-3">Wrap words in *stars* to colour them with the accent.</p>
        <FieldRow label="Font">
          <Select label="Font" className="w-full" value={style.font} onChange={(font) => patch(`Font: ${font}`, { font })} options={FONT_OPTIONS} />
        </FieldRow>
        <FieldRow label="Weight">
          <Select label="Weight" className="w-full" value={String(style.weight)} onChange={(weight) => patch("Font weight", { weight: Number(weight) })} options={WEIGHTS} />
        </FieldRow>
        <SliderField label="Size" value={style.size} min={12} max={400} step={1} unit="px" onChange={(size) => live({ size })} onCommit={(size) => patch("Text size", { size })} />
        <FieldRow label="Colour">
          <ColorField label="Text colour" value={style.color ?? composition.brief.palette.ink} onChange={(color) => patch("Text colour", { color })} />
          <ColorField label="Accent colour" value={style.accentColor ?? composition.brief.palette.accent} onChange={(accentColor) => patch("Accent colour", { accentColor })} />
        </FieldRow>
        <FieldRow label="Align">
          <Segmented
            ariaLabel="Text alignment"
            size="sm"
            value={style.align}
            onChange={(align) => patch(`Align ${align}`, { align })}
            options={[
              { value: "left", label: <IconAlignLeft className="size-4" />, title: "Left" },
              { value: "center", label: <IconAlignCenter className="size-4" />, title: "Centre" },
              { value: "right", label: <IconAlignRight className="size-4" />, title: "Right" },
            ]}
          />
          <button type="button" onClick={() => patch(style.uppercase ? "Normal case" : "Uppercase", { uppercase: !style.uppercase })} className={cn("pc-press h-7 rounded-ds-xs px-2 text-xs font-semibold", style.uppercase ? "bg-ds-accent-soft text-ds-accent" : "bg-ds-surface-2 text-ds-text-2")}>
            AA
          </button>
          <button type="button" onClick={() => patch(style.italic ? "Upright" : "Italic", { italic: !style.italic })} className={cn("pc-press h-7 rounded-ds-xs px-2 text-xs italic", style.italic ? "bg-ds-accent-soft text-ds-accent" : "bg-ds-surface-2 text-ds-text-2")}>
            I
          </button>
        </FieldRow>
        <SliderField label="Spacing" value={style.tracking} min={-0.1} max={0.5} step={0.005} unit="em" format={(v) => Math.round(v * 1000) / 1000} onChange={(tracking) => live({ tracking })} onCommit={(tracking) => patch("Letter spacing", { tracking })} />
        <SliderField label="Line height" value={style.leading} min={0.7} max={2.5} step={0.01} onChange={(leading) => live({ leading })} onCommit={(leading) => patch("Line height", { leading })} />
        <SliderField label="Max width" value={style.maxWidth} min={5} max={100} step={1} unit="%" onChange={(maxWidth) => live({ maxWidth })} onCommit={(maxWidth) => patch("Text width", { maxWidth })} />
      </Section>
      <Section title="Background" defaultOpen={Boolean(style.background)} enabled={Boolean(style.background)} onEnabledChange={(on) => patch(on ? "Text background" : "Remove text background", on ? { background: "#000000b3", padding: Math.max(style.padding, 18), radius: Math.max(style.radius, 12) } : { background: null })}>
        <FieldRow label="Colour">
          <ColorField label="Background colour" value={style.background} onChange={(background) => patch("Text background", { background })} />
        </FieldRow>
        <SliderField label="Padding" value={style.padding} min={0} max={120} step={1} unit="px" onChange={(padding) => live({ padding })} onCommit={(padding) => patch("Padding", { padding })} />
        <SliderField label="Corners" value={style.radius} min={0} max={200} step={1} unit="px" onChange={(radius) => live({ radius })} onCommit={(radius) => patch("Corner radius", { radius })} />
      </Section>
      <Section title="Stroke" defaultOpen={style.strokeWidth > 0} enabled={style.strokeWidth > 0 && Boolean(style.strokeColor)} onEnabledChange={(on) => patch(on ? "Text stroke" : "Remove stroke", on ? { strokeColor: style.strokeColor ?? "#000000", strokeWidth: 6 } : { strokeWidth: 0 })}>
        <FieldRow label="Colour">
          <ColorField label="Stroke colour" value={style.strokeColor ?? "#000000"} onChange={(strokeColor) => patch("Stroke colour", { strokeColor })} />
        </FieldRow>
        <SliderField label="Width" value={style.strokeWidth} min={0} max={40} step={0.5} unit="px" onChange={(strokeWidth) => live({ strokeWidth })} onCommit={(strokeWidth) => patch("Stroke width", { strokeWidth })} />
      </Section>
      <Section
        title="Shadow"
        defaultOpen={Boolean(layer.shadow)}
        enabled={Boolean(layer.shadow)}
        onEnabledChange={(on) => commit(on ? "Text shadow" : "Remove shadow", [{ op: "update-layer", clipId: clip.id, layerId: layer.id, patch: { shadow: on ? { color: "#000000aa", blur: 24, x: 0, y: 6 } : null } }])}
      >
        {layer.shadow ? (
          <>
            <FieldRow label="Colour">
              <ColorField label="Shadow colour" value={layer.shadow.color} onChange={(color) => commit("Shadow colour", [{ op: "update-layer", clipId: clip.id, layerId: layer.id, patch: { shadow: { ...layer.shadow, color } } }])} />
            </FieldRow>
            <SliderField label="Blur" value={layer.shadow.blur} min={0} max={120} step={1} unit="px" onCommit={(blur) => commit("Shadow blur", [{ op: "update-layer", clipId: clip.id, layerId: layer.id, patch: { shadow: { ...layer.shadow, blur } } }])} />
            <SliderField label="Offset" value={layer.shadow.y} min={-60} max={60} step={1} unit="px" centered onCommit={(y) => commit("Shadow offset", [{ op: "update-layer", clipId: clip.id, layerId: layer.id, patch: { shadow: { ...layer.shadow, y } } }])} />
          </>
        ) : null}
      </Section>
    </>
  );
}

function TextFieldWithId({ id, value, onCommit }: { id: string; value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <textarea
      id={id}
      aria-label="Text"
      rows={3}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => (draft.trim() && draft !== value ? onCommit(draft) : setDraft(value))}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) (event.target as HTMLTextAreaElement).blur();
        if (event.key === "Escape") {
          setDraft(value);
          (event.target as HTMLTextAreaElement).blur();
        }
      }}
      className="w-full resize-y rounded-ds-xs bg-ds-surface-2 px-2 py-1.5 text-[13px] leading-relaxed text-ds-text shadow-[inset_0_0_0_1px_var(--ds-hairline)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--ds-accent)]"
    />
  );
}

// ── Animation ───────────────────────────────────────────────────────────────

function AnimationSections({ clip, layer }: { clip: VisualClip; layer: Layer | LeafLayer }) {
  const [mode, setMode] = useState<"enter" | "exit" | "loop">("enter");
  const animated = Object.entries(layer.keyframes).filter(([, keys]) => keys && keys.length > 0);
  const presets = MOTION_PRESETS.filter((preset) =>
    (preset.appliesTo === "any" || preset.appliesTo.includes(layer.type)) &&
    (mode === "loop" ? preset.group === "ambient" || preset.group === "emphasis" : mode === "exit" ? preset.supportsExit : preset.group === "enter" || preset.group === "text" || preset.group === "camera"),
  );
  return (
    <>
      {layer.type === "text" ? (
        <Section title="Text reveal">
          <FieldRow label="Style">
            <Select
              label="Text reveal"
              className="w-full"
              value={layer.animation?.preset ?? "none"}
              onChange={(preset) => commit(preset === "none" ? "Remove text reveal" : `Text reveal: ${preset}`, [{ op: "update-layer", clipId: clip.id, layerId: layer.id, patch: { animation: preset === "none" ? null : { ...(layer.animation ?? {}), preset } } }])}
              options={[{ value: "none", label: "None" }, ...["fade-rise", "mask-rise", "blur-in", "scale-in", "typewriter", "highlight"].map((value) => ({ value, label: value.replace("-", " ") }))]}
            />
          </FieldRow>
          {layer.animation ? (
            <>
              <FieldRow label="By">
                <Segmented ariaLabel="Reveal unit" size="sm" value={layer.animation.unit} onChange={(unit) => commit(`Reveal by ${unit}`, [{ op: "update-layer", clipId: clip.id, layerId: layer.id, patch: { animation: { unit } } }])} options={[{ value: "word", label: "Word" }, { value: "line", label: "Line" }, { value: "char", label: "Letter" }]} />
              </FieldRow>
              <SliderField label="Stagger" value={layer.animation.staggerMs} min={0} max={400} step={5} unit="ms" onCommit={(staggerMs) => commit("Reveal stagger", [{ op: "update-layer", clipId: clip.id, layerId: layer.id, patch: { animation: { staggerMs } } }])} />
              <SliderField label="Duration" value={layer.animation.durationMs} min={50} max={3000} step={10} unit="ms" onCommit={(durationMs) => commit("Reveal duration", [{ op: "update-layer", clipId: clip.id, layerId: layer.id, patch: { animation: { durationMs } } }])} />
              <SliderField label="Delay" value={layer.animation.delayMs} min={0} max={5000} step={10} unit="ms" onCommit={(delayMs) => commit("Reveal delay", [{ op: "update-layer", clipId: clip.id, layerId: layer.id, patch: { animation: { delayMs } } }])} />
            </>
          ) : null}
        </Section>
      ) : null}
      <Section title="Animations" actions={<Segmented ariaLabel="Animation type" size="sm" value={mode} onChange={setMode} options={[{ value: "enter", label: "In" }, { value: "exit", label: "Out" }, { value: "loop", label: "Loop" }]} />}>
        <div className="grid grid-cols-2 gap-1.5">
          {presets.map((preset) => (
            <button key={preset.id} type="button" title={preset.description} onClick={() => applyMotion(clip.id, [layer.id], preset.id, mode === "exit" ? "exit" : "enter")} className="pc-press flex h-9 items-center gap-1.5 rounded-ds-sm bg-ds-surface-2 px-2 text-left text-xs font-medium text-ds-text hover:bg-ds-surface-3">
              <IconSparkles className="size-3.5 shrink-0 text-ds-accent" />
              <span className="truncate">{preset.label}</span>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-ds-text-3">{mode === "exit" ? "Out animations end at the layer's end." : "Starts at the playhead."}</p>
      </Section>
      <Section title={`Keyframes · ${animated.length}`}>
        {animated.length === 0 ? (
          <p className="text-xs text-ds-text-3">No keyframes. Tap a ◇ next to any property to add one at the playhead.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-1">
              {animated.map(([property, keys]) => (
                <li key={property} className="flex items-center gap-2 text-xs">
                  <IconDiamondFilled className="size-3 text-ds-accent" />
                  <span className="font-mono text-ds-text">{property}</span>
                  <span className="text-ds-text-3">{keys?.length} keys</span>
                  <button type="button" className="ml-auto text-[11px] text-ds-text-3 hover:text-ds-danger" onClick={() => commit(`Clear ${property} keyframes`, [{ op: "update-layer", clipId: clip.id, layerId: layer.id, patch: { keyframes: { [property]: [] } } }])}>
                    Clear
                  </button>
                </li>
              ))}
            </ul>
            <Button size="sm" variant="ghost" className="self-start text-ds-danger" onClick={() => commit("Clear all keyframes", [{ op: "update-layer", clipId: clip.id, layerId: layer.id, patch: { keyframes: Object.fromEntries(animated.map(([property]) => [property, []])) } }])}>
              Clear all
            </Button>
          </>
        )}
      </Section>
    </>
  );
}

// ── Colour (filters + adjust) ───────────────────────────────────────────────

const ADJUST_FIELDS: Array<{ key: keyof Adjust; label: string; min: number; max: number; media?: boolean }> = [
  { key: "brightness", label: "Brightness", min: -100, max: 100 },
  { key: "contrast", label: "Contrast", min: -100, max: 100 },
  { key: "saturation", label: "Saturation", min: -100, max: 100 },
  { key: "hue", label: "Hue", min: -180, max: 180 },
  { key: "temperature", label: "Temperature", min: -100, max: 100 },
  { key: "tint", label: "Tint", min: -100, max: 100 },
  { key: "vignette", label: "Vignette", min: 0, max: 100, media: true },
];

function ColorSections({ target, adjust, filter, allowVignette }: { target: { clipId: string; layerId?: string }; adjust: Adjust | undefined; filter: Filter | undefined; allowVignette: boolean }) {
  const current = { ...DEFAULT_ADJUST, ...adjust };
  const opFor = (patch: Record<string, unknown>): CompositionOpInput => (target.layerId ? { op: "update-layer", clipId: target.clipId, layerId: target.layerId, patch } : { op: "update-clip", clipId: target.clipId, patch });
  const changed = ADJUST_FIELDS.some((field) => current[field.key] !== 0);
  return (
    <>
      <Section title="Filter">
        <div className="grid grid-cols-4 gap-1.5">
          {(["none", ...FILTER_PRESETS] as const).map((preset) => {
            const active = preset === "none" ? !filter : filter?.preset === preset;
            return (
              <button key={preset} type="button" onClick={() => applyFilter(target, preset === "none" ? null : preset, filter?.intensity ?? 1)} className="pc-press flex flex-col gap-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ds-accent">
                <img src={FILTER_SAMPLE} alt="" className={cn("aspect-square w-full rounded-[6px] object-cover", active && "ring-2 ring-ds-accent ring-offset-1 ring-offset-[var(--ds-surface)]")} style={{ filter: preset === "none" ? undefined : colorFilterCss({ filter: { preset, intensity: 1 } }) }} />
                <span className={cn("truncate text-[10px]", active ? "font-semibold text-ds-text" : "text-ds-text-3")}>{preset === "none" ? "None" : FILTER_PRESET_INFO[preset].label}</span>
              </button>
            );
          })}
        </div>
        {filter ? <SliderField label="Intensity" value={filter.intensity} min={0} max={1} step={0.01} unit="%" format={(v) => Math.round(v * 100)} parse={(v) => v / 100} onChange={(intensity) => preview([opFor({ filter: { ...filter, intensity } })])} onCommit={(intensity) => commitThen("Filter intensity", [opFor({ filter: { ...filter, intensity } })], () => offerLookForAll(target, "filter"))} /> : null}
      </Section>
      <Section title="Adjust" actions={changed ? <IconButton size="xs" label="Reset adjustments" onClick={() => commitThen("Reset adjustments", [opFor({ adjust: null })], () => offerLookForAll(target, "adjust"))}><IconRefresh /></IconButton> : undefined}>
        {ADJUST_FIELDS.filter((field) => allowVignette || !field.media).map((field) => (
          <SliderField
            key={field.key}
            label={field.label}
            value={current[field.key]}
            min={field.min}
            max={field.max}
            step={1}
            centered={field.min < 0}
            onChange={(value) => preview([opFor({ adjust: { ...current, [field.key]: value } })])}
            onCommit={(value) => commitThen(field.label, [opFor({ adjust: { ...current, [field.key]: value } })], () => offerLookForAll(target, "adjust"))}
          />
        ))}
      </Section>
    </>
  );
}

// ── Speed and volume ────────────────────────────────────────────────────────

function SpeedSection({ clipId, rate }: { clipId: string; rate: number }) {
  const presets = [0.25, 0.5, 1, 1.5, 2, 3];
  return (
    <Section title="Speed">
      <div className="grid grid-cols-6 gap-1">
        {presets.map((value) => (
          <button key={value} type="button" onClick={() => value !== rate && commit(`Speed ${value}×`, [{ op: "set-clip-speed", clipId, rate: value }])} className={cn("pc-press h-8 rounded-ds-xs text-xs font-medium tabular", Math.abs(value - rate) < 0.001 ? "bg-primary text-primary-foreground" : "bg-ds-surface-2 text-ds-text-2 hover:text-ds-text")}>
            {value}×
          </button>
        ))}
      </div>
      <SliderField label="Custom" value={rate} min={0.25} max={4} step={0.05} unit="×" onCommit={(value) => commit(`Speed ${value}×`, [{ op: "set-clip-speed", clipId, rate: value }])} />
      <p className="text-[11px] text-ds-text-3">The clip's length changes with its speed; later clips make room.</p>
    </Section>
  );
}

// ── Inspectors per selection ────────────────────────────────────────────────

const LAYER_ICON: Record<string, React.ReactNode> = { text: <IconTypography />, image: <IconPhoto />, video: <IconVideo />, shape: <IconStack2 />, icon: <IconSparkles />, chart: <IconStack2 />, code: <IconStack2 />, group: <IconStack2 /> };

function LayerInspector({ composition, selection }: { composition: Composition; selection: Extract<Selection, { kind: "layer" }> }) {
  const { clip, layer, track } = selection;
  const basic: TabSpec = { id: "basic", label: layer.type === "text" ? "Transform" : "Basic", content: <>{layer.type === "image" || layer.type === "video" ? <MediaSection clip={clip} layer={layer} /> : null}<TransformSections composition={composition} clip={clip} layer={layer} /></> };
  const animation: TabSpec = { id: "animation", label: "Animation", content: <AnimationSections clip={clip} layer={layer} /> };
  const color: TabSpec = { id: "adjust", label: "Adjust", content: <ColorSections target={{ clipId: clip.id, layerId: layer.id }} adjust={layer.adjust} filter={layer.filter} allowVignette={layer.type === "image" || layer.type === "video"} /> };
  const tabs: TabSpec[] =
    layer.type === "text"
      ? [{ id: "text", label: "Text", content: <TextSections composition={composition} clip={clip} layer={layer} /> }, animation, basic]
      : layer.type === "video"
        ? [
            basic,
            {
              id: "audio",
              label: "Audio",
              content: (
                <Section title="Volume">
                  <SliderField label="Volume" value={layer.volume} min={0} max={2} step={0.01} unit="%" format={(v) => Math.round(v * 100)} parse={(v) => v / 100} onCommit={(volume) => commit("Video volume", [{ op: "update-layer", clipId: clip.id, layerId: layer.id, patch: { volume } }])} />
                  <FieldRow label="Mute">
                    <Switch label="Mute video sound" checked={layer.volume === 0} onCheckedChange={(muted) => commit(muted ? "Mute video" : "Unmute video", [{ op: "update-layer", clipId: clip.id, layerId: layer.id, patch: { volume: muted ? 0 : 1 } }])} />
                  </FieldRow>
                  {track.kind === "visual" && track.muted ? <p className="text-[11px] text-ds-warning">This track is muted, so the video stays silent.</p> : null}
                </Section>
              ),
            },
            { id: "speed", label: "Speed", content: <SpeedSection clipId={clip.id} rate={layer.playbackRate} /> },
            animation,
            color,
          ]
        : [basic, animation, color];
  const title = layer.type === "text" ? layer.text.replace(/\*/g, "").replace(/\n/g, " ").slice(0, 40) : (layer.name ?? layer.id);
  return (
    <InspectorFrame
      icon={LAYER_ICON[layer.type] ?? <IconStack2 />}
      title={title}
      subtitle={`${layer.type}${selection.solo ? "" : ` · in ${clip.name ?? clip.id}`}`}
      tabs={tabs}
      actions={
        selection.solo ? undefined : (
          <IconButton size="sm" label="Back to the clip" onClick={() => useEditor.getState().selectLayer(null)}>
            <IconStack2 />
          </IconButton>
        )
      }
    />
  );
}

function TimeFields({ composition, clip }: { composition: Composition; clip: { id: string; startMs: number; durationMs: number } }) {
  const fps = composition.fps;
  const trim = (edge: "start" | "end", text: string) => {
    const ms = parseTimecode(text, fps);
    if (ms === null) return;
    commit(edge === "start" ? "Set in point" : "Set out point", [{ op: "trim-clip", clipId: clip.id, edge, toMs: Math.max(0, Math.round(ms)), ripple: useEditor.getState().ripple }]);
  };
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2">
      <span className="text-xs text-ds-text-2">In / Out</span>
      <TimecodeBox value={formatTimecode(clip.startMs, { fps })} label="In point" onCommit={(text) => trim("start", text)} />
      <TimecodeBox value={formatTimecode(clip.startMs + clip.durationMs, { fps })} label="Out point" onCommit={(text) => trim("end", text)} />
    </div>
  );
}

function TimecodeBox({ value, label, onCommit }: { value: string; label: string; onCommit: (text: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => (draft !== value ? onCommit(draft) : undefined)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
      }}
      className="h-7 min-w-0 rounded-ds-xs bg-ds-surface-2 px-1.5 font-mono text-[11px] tabular text-ds-text shadow-[inset_0_0_0_1px_var(--ds-hairline)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--ds-accent)]"
    />
  );
}

function ClipInspector({ composition, clip }: { composition: Composition; clip: VisualClip }) {
  const selectLayer = useEditor((state) => state.selectLayer);
  const brief = composition.brief;
  const transition = clip.transitionIn;
  const layers = [...clip.layers].reverse();
  const clipTab: TabSpec = {
    id: "clip",
    label: "Clip",
    content: (
      <>
        <Section title="Clip">
          <FieldRow label="Name">
            <TextField label="Clip name" value={clip.name ?? ""} placeholder={clip.id} onCommit={(name) => commit("Rename clip", [{ op: "update-clip", clipId: clip.id, patch: { name: name.slice(0, 80) } }])} />
          </FieldRow>
          <TimeFields composition={composition} clip={clip} />
          <FieldRow label="Timing">
            <span className={cn("rounded-full px-2 py-0.5 text-[11px]", clip.timing === "narration" ? "bg-ds-accent-soft text-ds-accent" : "bg-ds-surface-2 text-ds-text-2")}>{clip.timing === "narration" ? "Follows the voice" : "Manual"}</span>
            {clip.timing === "manual" && clip.lineIds.length ? (
              <button type="button" className="text-[11px] text-ds-accent hover:underline" onClick={() => commit("Re-lock to voice", [{ op: "update-clip", clipId: clip.id, patch: { timing: "narration" } }])}>
                Re-lock to voice
              </button>
            ) : null}
          </FieldRow>
          <FieldRow label="Background">
            <ColorField label="Clip background" allowNone value={typeof clip.background === "string" ? clip.background : undefined} onChange={(background) => commit("Clip background", [{ op: "update-clip", clipId: clip.id, patch: { background } }])} swatches={[brief.palette.background, brief.palette.surface, brief.palette.accent, ...(brief.palette.accent2 ? [brief.palette.accent2] : []), "#000000", "#ffffff", "#15171d", "#f3f3f6"]} />
          </FieldRow>
        </Section>
        <Section title="Transition in" enabled={Boolean(transition)} onEnabledChange={(on) => commitThen(on ? "Add transition" : "Remove transition", [{ op: "set-transition", clipId: clip.id, transition: on ? (TRANSITION_PRESETS[0]?.transition ?? null) : null }], () => offerTransitionForAll(clip.id))}>
          <FieldRow label="Type">
            <Select
              label="Transition type"
              className="w-full"
              value={transition?.type ?? "crossfade"}
              onChange={(type) => {
                const next = type as TransitionType;
                const directions = TRANSITION_CATALOG[next].directions;
                const direction = transition && directions.includes(transition.direction) ? transition.direction : undefined;
                commitThen(`Transition: ${TRANSITION_CATALOG[next].label}`, [{ op: "set-transition", clipId: clip.id, transition: defaultTransition(next, direction) }], () => offerTransitionForAll(clip.id));
              }}
              options={TRANSITION_TYPES.filter((type) => type !== "cut").map((type) => ({ value: type, label: TRANSITION_CATALOG[type].label, group: TRANSITION_GROUP_LABELS[TRANSITION_CATALOG[type].group] }))}
            />
          </FieldRow>
          <SliderField label="Duration" value={transition?.durationMs ?? 500} min={100} max={3000} step={10} unit="ms" onCommit={(durationMs) => commitThen("Transition length", [{ op: "set-transition", clipId: clip.id, transition: { durationMs } }], () => offerTransitionForAll(clip.id))} />
          {transition && TRANSITION_CATALOG[transition.type].directions.length > 1 ? (
            <FieldRow label="Direction">
              <Segmented
                ariaLabel="Direction"
                size="sm"
                value={transition.direction}
                onChange={(direction) => commitThen(`Transition ${direction}`, [{ op: "set-transition", clipId: clip.id, transition: { direction } }], () => offerTransitionForAll(clip.id))}
                options={TRANSITION_CATALOG[transition.type].directions.map((direction) => ({
                  value: direction,
                  label: TRANSITION_CATALOG[transition.type].group === "spin" || ["triangle-distort", "bokeh-twirl", "zoom-spin"].includes(transition.type) ? (direction === "left" ? "↺" : "↻") : { left: "←", right: "→", up: "↑", down: "↓" }[direction],
                }))}
              />
            </FieldRow>
          ) : null}
        </Section>
      </>
    ),
  };
  const layersTab: TabSpec = {
    id: "layers",
    label: `Layers · ${clip.layers.length}`,
    content: (
      <ul className="flex flex-col p-2">
        {layers.map((layer, reversedIndex) => {
          const index = clip.layers.length - 1 - reversedIndex;
          return (
            <ContextMenu key={layer.id}>
              <ContextMenuTrigger asChild>
                <li className="group flex items-center gap-1 rounded-ds-sm px-1.5 hover:bg-ds-surface-2">
                  <button type="button" onClick={() => selectLayer({ clipId: clip.id, layerId: layer.id })} className="flex h-9 min-w-0 flex-1 items-center gap-2 text-left">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded bg-ds-surface-3 text-ds-text-2 [&_svg]:size-3.5">{LAYER_ICON[layer.type] ?? <IconStack2 />}</span>
                    <span className={cn("truncate text-[13px]", layer.hidden ? "text-ds-text-3 line-through" : "text-ds-text")}>{layer.type === "text" ? layer.text.replace(/\*/g, "").replace(/\n/g, " ") : (layer.name ?? layer.id)}</span>
                    {Object.values(layer.keyframes).some((keys) => keys?.length) ? <IconDiamondFilled className="size-3 shrink-0 text-ds-accent" /> : null}
                  </button>
                  <div className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100">
                    <IconButton size="xs" label="Move up" disabled={index === clip.layers.length - 1} onClick={() => commit("Bring forward", [{ op: "reorder-layer", clipId: clip.id, layerId: layer.id, toIndex: index + 1 }])}>
                      <IconArrowUp />
                    </IconButton>
                    <IconButton size="xs" label="Move down" disabled={index === 0} onClick={() => commit("Send backward", [{ op: "reorder-layer", clipId: clip.id, layerId: layer.id, toIndex: index - 1 }])}>
                      <IconArrowDown />
                    </IconButton>
                    <IconButton size="xs" label={layer.hidden ? "Show" : "Hide"} onClick={() => commit(layer.hidden ? "Show layer" : "Hide layer", [{ op: "update-layer", clipId: clip.id, layerId: layer.id, patch: { hidden: !layer.hidden } }])}>
                      {layer.hidden ? <IconEyeOff /> : <IconEye />}
                    </IconButton>
                    <IconButton size="xs" label="Delete layer" onClick={() => commit("Delete layer", [{ op: "remove-layers", clipId: clip.id, layerIds: [layer.id] }])}>
                      <IconTrash />
                    </IconButton>
                  </div>
                </li>
              </ContextMenuTrigger>
              <LayerMenu clip={clip} layer={layer} />
            </ContextMenu>
          );
        })}
        {layers.length === 0 ? <li className="p-3 text-xs text-ds-text-3">No layers. Add text or elements from the left panel.</li> : null}
      </ul>
    ),
  };
  return (
    <InspectorFrame
      icon={<IconStack2 />}
      title={clip.name ?? clip.id}
      subtitle={`${(clip.durationMs / 1000).toFixed(2)} s · ${clip.layers.length} layers`}
      tabs={[clipTab, layersTab, { id: "adjust", label: "Adjust", content: <ColorSections target={{ clipId: clip.id }} adjust={clip.adjust} filter={clip.filter} allowVignette /> }]}
    />
  );
}

/** Beat sync for a music clip: snap the cuts to its beat, with an optional tempo when the measured one is off. */
function BeatSyncRow({ clipId }: { clipId: string }) {
  const [bpm, setBpm] = useState("");
  const value = Number(bpm);
  const valid = !bpm || (value >= 40 && value <= 300);
  return (
    <FieldRow label="Beat">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <Button size="sm" variant="outline" className="pc-press min-w-0 flex-1" disabled={!valid} onClick={() => void snapCutsToBeat(clipId, bpm ? value : undefined)}>
          <IconWaveSine className="size-4 shrink-0" /> <span className="truncate">Snap cuts to the beat</span>
        </Button>
        <input
          value={bpm}
          inputMode="decimal"
          onChange={(event) => setBpm(event.target.value.replace(/[^\d.]/g, "").slice(0, 5))}
          onKeyDown={(event) => event.stopPropagation()}
          placeholder="Auto"
          aria-label="Tempo in BPM (leave empty to find it automatically)"
          title="Tempo in BPM. Leave empty to use the track's own or measure it."
          className={cn("h-7 w-14 rounded-ds-xs bg-ds-surface-2 px-1.5 text-center font-mono text-xs tabular text-ds-text outline-none shadow-[inset_0_0_0_1px_var(--ds-hairline)] placeholder:text-ds-text-3 focus:shadow-[inset_0_0_0_1.5px_var(--ds-accent)]", !valid && "shadow-[inset_0_0_0_1.5px_var(--ds-danger)]")}
        />
      </div>
    </FieldRow>
  );
}

function AudioInspector({ composition, selection }: { composition: Composition; selection: Extract<Selection, { kind: "audio" }> }) {
  const { clip, track } = selection;
  const op = (patch: Record<string, unknown>): CompositionOpInput => ({ op: "update-clip", clipId: clip.id, patch });
  const basic: TabSpec = {
    id: "basic",
    label: "Basic",
    content: (
      <>
        <Section title="Audio">
          <FieldRow label="Name">
            <TextField label="Label" value={clip.text ?? ""} placeholder={track.role} onCommit={(text) => commit("Rename audio", [op({ text: text.slice(0, 200) })])} />
          </FieldRow>
          <TimeFields composition={composition} clip={clip} />
          <SliderField label="Volume" value={clip.volume} min={0} max={2} step={0.01} unit="%" format={(v) => Math.round(v * 100)} parse={(v) => v / 100} onChange={(volume) => preview([op({ volume })])} onCommit={(volume) => commit("Volume", [op({ volume })])} />
          <SliderField label="Fade in" value={clip.fadeInMs} min={0} max={Math.min(10_000, clip.durationMs)} step={50} unit="s" format={(v) => Math.round(v / 100) / 10} parse={(v) => v * 1000} onCommit={(fadeInMs) => commit("Fade in", [op({ fadeInMs })])} />
          <SliderField label="Fade out" value={clip.fadeOutMs} min={0} max={Math.min(10_000, clip.durationMs)} step={50} unit="s" format={(v) => Math.round(v / 100) / 10} parse={(v) => v * 1000} onCommit={(fadeOutMs) => commit("Fade out", [op({ fadeOutMs })])} />
          {track.role === "music" ? (
            <BeatSyncRow clipId={clip.id} />
          ) : null}
          {track.role === "music" ? (
            <FieldRow label="Voice-over">
              <Switch label="Lower under the voice" checked={clip.duckUnderVoice} onCheckedChange={(duckUnderVoice) => commit(duckUnderVoice ? "Lower under the voice" : "Stop lowering under the voice", [op({ duckUnderVoice })])} />
              <span className="text-[11px] text-ds-text-3">Lower under the voice</span>
            </FieldRow>
          ) : null}
        </Section>
        <Section title="Track">
          <SliderField label="Track volume" value={(track as AudioTrack).volume} min={0} max={2} step={0.01} unit="%" format={(v) => Math.round(v * 100)} parse={(v) => v / 100} onCommit={(volume) => commit(`${track.name} volume`, [{ op: "set-track-state", trackId: track.id, patch: { volume } }])} />
          <FieldRow label="Mute">
            <Switch label={`Mute ${track.name}`} checked={track.muted} onCheckedChange={(muted) => commit(muted ? `Mute ${track.name}` : `Unmute ${track.name}`, [{ op: "set-track-state", trackId: track.id, patch: { muted } }])} />
          </FieldRow>
        </Section>
      </>
    ),
  };
  return <InspectorFrame icon={<IconMusic />} title={clip.text || track.name} subtitle={`${track.role} · ${(clip.durationMs / 1000).toFixed(2)} s`} tabs={[basic, { id: "speed", label: "Speed", content: <SpeedSection clipId={clip.id} rate={clip.playbackRate} /> }]} />;
}

function CaptionInspector({ composition, selection }: { composition: Composition; selection: Extract<Selection, { kind: "caption" }> }) {
  const clip = selection.clip as CaptionClip;
  const track = composition.tracks.find((candidate) => candidate.kind === "caption");
  const style = track?.kind === "caption" ? track.style : null;
  const setStyle = (label: string, patch: Record<string, unknown>) => commit(label, [{ op: "set-caption-style", style: patch }]);
  const liveStyle = (patch: Record<string, unknown>) => preview([{ op: "set-caption-style", style: patch }]);
  const words = clip.words.length ? clip.words.map((word) => word.text) : clip.text.split(/\s+/);
  const captionTab: TabSpec = {
    id: "caption",
    label: "Caption",
    content: (
      <Section title="Caption">
        <TextField
          multiline
          label="Caption text"
          value={clip.text}
          onCommit={(text) => commit("Edit caption", [{ op: "update-caption", clipId: clip.id, text }])}
        />
        <TimeFields composition={composition} clip={clip} />
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-ds-text-2">Highlight words</span>
          <div className="flex flex-wrap gap-1">
            {words.map((word, index) => {
              const on = clip.emphasis.includes(index);
              return (
                <button key={`${word}-${index}`} type="button" onClick={() => commit(on ? "Remove highlight" : "Highlight word", [{ op: "update-clip", clipId: clip.id, patch: { emphasis: on ? clip.emphasis.filter((value) => value !== index) : [...clip.emphasis, index].sort((a, b) => a - b) } }])} className={cn("pc-press rounded-full px-2 py-0.5 text-xs", on ? "bg-ds-accent text-ds-on-accent" : "bg-ds-surface-2 text-ds-text-2 hover:text-ds-text")}>
                  {word}
                </button>
              );
            })}
          </div>
        </div>
      </Section>
    ),
  };
  const styleTab: TabSpec = {
    id: "style",
    label: "Style",
    content: style ? (
      <>
        <Section title="Look">
          <div className="grid grid-cols-5 gap-1">
            {CAPTION_PRESETS.map((preset) => (
              <button key={preset} type="button" onClick={() => setStyle(`Caption style: ${preset}`, { preset })} className={cn("pc-press h-8 rounded-ds-xs text-[11px] font-medium capitalize", style.preset === preset ? "bg-primary text-primary-foreground" : "bg-ds-surface-2 text-ds-text-2 hover:text-ds-text")}>
                {preset}
              </button>
            ))}
          </div>
          <FieldRow label="Font">
            <Select label="Caption font" className="w-full" value={style.font} onChange={(font) => setStyle("Caption font", { font })} options={FONT_OPTIONS} />
          </FieldRow>
          <SliderField label="Size" value={style.size} min={16} max={160} step={1} unit="px" onChange={(size) => liveStyle({ size })} onCommit={(size) => setStyle("Caption size", { size })} />
          <FieldRow label="Weight">
            <Select label="Caption weight" className="w-full" value={String(style.weight)} onChange={(weight) => setStyle("Caption weight", { weight: Number(weight) })} options={WEIGHTS} />
          </FieldRow>
          <FieldRow label="Text">
            <Segmented
              ariaLabel="Caption alignment"
              size="sm"
              value={style.align}
              onChange={(align) => setStyle(`Captions ${align}`, { align })}
              options={[
                { value: "left", label: <IconAlignLeft className="size-4" />, title: "Left" },
                { value: "center", label: <IconAlignCenter className="size-4" />, title: "Centre" },
                { value: "right", label: <IconAlignRight className="size-4" />, title: "Right" },
              ]}
            />
            <button type="button" onClick={() => setStyle(style.uppercase ? "Normal case captions" : "Uppercase captions", { uppercase: !style.uppercase })} className={cn("pc-press h-7 rounded-ds-xs px-2 text-xs font-semibold", style.uppercase ? "bg-ds-accent-soft text-ds-accent" : "bg-ds-surface-2 text-ds-text-2")}>
              AA
            </button>
            <button type="button" onClick={() => setStyle(style.italic ? "Upright captions" : "Italic captions", { italic: !style.italic })} className={cn("pc-press h-7 rounded-ds-xs px-2 text-xs italic", style.italic ? "bg-ds-accent-soft text-ds-accent" : "bg-ds-surface-2 text-ds-text-2")}>
              I
            </button>
          </FieldRow>
          <FieldRow label="Colour">
            <ColorField label="Caption colour" value={style.color} onChange={(color) => color && setStyle("Caption colour", { color })} />
          </FieldRow>
          <FieldRow label="Box">
            <ColorField label="Caption background" allowNone value={style.background} onChange={(background) => setStyle(background ? "Caption box" : "No caption box", { background })} />
          </FieldRow>
          <FieldRow label="Shadow">
            <Switch label="Caption shadow" checked={style.shadow} onCheckedChange={(shadow) => setStyle(shadow ? "Caption shadow" : "No caption shadow", { shadow })} />
          </FieldRow>
        </Section>
        <Section title="Highlight">
          <p className="text-[11px] text-ds-text-3">How the spoken word (karaoke, boxed, outline) and highlighted words stand out.</p>
          <div className="grid grid-cols-4 gap-1">
            {CAPTION_HIGHLIGHT_STYLES.map((kind) => (
              <button key={kind} type="button" onClick={() => setStyle(`Highlight: ${kind}`, { highlightStyle: kind })} className={cn("pc-press h-8 rounded-ds-xs text-[11px] font-medium capitalize", style.highlightStyle === kind ? "bg-primary text-primary-foreground" : "bg-ds-surface-2 text-ds-text-2 hover:text-ds-text")}>
                {kind}
              </button>
            ))}
          </div>
          <FieldRow label="Colour">
            <ColorField label="Highlight colour" value={style.highlightColor} onChange={(highlightColor) => highlightColor && setStyle("Highlight colour", { highlightColor })} />
          </FieldRow>
        </Section>
        <Section title="Outline" enabled={(style.strokeWidth || (style.preset === "outline" ? 5 : 0)) > 0} onEnabledChange={(on) => setStyle(on ? "Caption outline" : "No caption outline", on ? { strokeWidth: style.strokeWidth || 5, strokeColor: style.strokeColor ?? "#000000" } : { strokeWidth: 0, ...(style.preset === "outline" ? { preset: "clean" } : {}) })}>
          <FieldRow label="Colour">
            <ColorField label="Outline colour" value={style.strokeColor ?? "#000000"} onChange={(strokeColor) => strokeColor && setStyle("Outline colour", { strokeColor })} />
          </FieldRow>
          <SliderField label="Width" value={style.strokeWidth || (style.preset === "outline" ? 5 : 0)} min={0} max={20} step={0.5} unit="px" onChange={(strokeWidth) => liveStyle({ strokeWidth })} onCommit={(strokeWidth) => setStyle("Outline width", { strokeWidth })} />
        </Section>
        <Section title="Position" actions={style.positionX !== undefined || style.positionY !== undefined || style.maxWidth !== undefined ? <IconButton size="xs" label="Reset position" onClick={() => setStyle("Reset caption position", { positionX: null, positionY: null, maxWidth: null })}><IconRefresh /></IconButton> : undefined}>
          <Segmented ariaLabel="Caption position" className="w-full" value={style.positionY === undefined && style.positionX === undefined ? style.position : "custom"} onChange={(position) => (position === "custom" ? setStyle("Custom position", { positionY: style.positionY ?? 70, positionX: style.positionX ?? 50 }) : setStyle(`Captions ${position}`, { position, positionY: null, positionX: null }))} options={[{ value: "top", label: "Top" }, { value: "middle", label: "Middle" }, { value: "bottom", label: "Bottom" }, { value: "custom", label: "Custom" }]} />
          {style.positionY !== undefined || style.positionX !== undefined ? (
            <>
              <SliderField label="Across" value={style.positionX ?? 50} min={5} max={95} step={0.5} unit="%" onChange={(positionX) => liveStyle({ positionX })} onCommit={(positionX) => setStyle("Caption position", { positionX })} />
              <SliderField label="Down" value={style.positionY ?? 70} min={4} max={96} step={0.5} unit="%" onChange={(positionY) => liveStyle({ positionY })} onCommit={(positionY) => setStyle("Caption height", { positionY })} />
            </>
          ) : null}
          <SliderField label="Width" value={style.maxWidth ?? (composition.height > composition.width ? 84 : 72)} min={20} max={100} step={1} unit="%" onChange={(maxWidth) => liveStyle({ maxWidth })} onCommit={(maxWidth) => setStyle("Caption width", { maxWidth })} />
          <p className="text-[11px] text-ds-text-3">Tip: drag the captions in the preview to place them; drag a corner to resize.</p>
        </Section>
      </>
    ) : null,
  };
  return <InspectorFrame icon={<IconBadgeCc />} title={clip.text.slice(0, 40)} subtitle={`Caption · ${(clip.durationMs / 1000).toFixed(2)} s`} tabs={[captionTab, styleTab]} />;
}

type HistoryEntry = { version: number; label: string; authorKind: string; createdAt: string };

/** Edit history: the latest 50 come with the composition; older ones load a page at a time. */
function HistoryList({ versions, version, videoId }: { versions: HistoryEntry[]; version: number; videoId: string }) {
  const [older, setOlder] = useState<HistoryEntry[]>([]);
  const [hasOlder, setHasOlder] = useState(true);
  const [loading, setLoading] = useState(false);
  // New edits shift every offset; start over from the fresh first page.
  useEffect(() => {
    setOlder([]);
    setHasOlder(true);
  }, [videoId, versions[0]?.version]);
  const seen = new Set(versions.map((entry) => entry.version));
  const all = [...versions, ...older.filter((entry) => !seen.has(entry.version))];
  const canLoadMore = hasOlder && versions.length >= 50;
  const [loadError, setLoadError] = useState<unknown>(null);
  useEffect(() => setLoadError(null), [videoId, versions[0]?.version]);
  async function loadOlder() {
    if (loading) return;
    setLoading(true);
    setLoadError(null);
    try {
      const page = (await callAction("list-composition-versions" as never, { videoId, offset: all.length, limit: 50 } as never)) as { versions: HistoryEntry[]; hasMore: boolean };
      setOlder((current) => [...current, ...page.versions]);
      setHasOlder(page.hasMore);
    } catch (error) {
      setLoadError(error);
    } finally {
      setLoading(false);
    }
  }
  return (
    <ul className="flex flex-col p-2">
      {all.map((entry) => (
        <li key={entry.version}>
          <button type="button" onClick={() => void useEditor.getState().restore(entry.version)} disabled={entry.version === version} className={cn("pc-press flex w-full items-start gap-2 rounded-ds-sm px-2 py-1.5 text-left text-xs hover:bg-ds-surface-2 disabled:cursor-default", entry.version === version && "bg-ds-accent-soft")}>
            {entry.authorKind === "agent" ? <IconRobot className="mt-0.5 size-3.5 shrink-0 text-ds-accent" /> : <IconUser className="mt-0.5 size-3.5 shrink-0 text-ds-text-3" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-ds-text">{entry.label.replace(/^Agent: /, "")}</span>
              <span className="text-[10px] tabular text-ds-text-3">
                v{entry.version} · {formatAgo(entry.createdAt)}
              </span>
            </span>
          </button>
        </li>
      ))}
      {all.length === 0 ? (
        <li className="flex items-center gap-1 p-2 text-xs text-ds-text-3">
          <IconHistory className="size-3.5" /> No edits yet.
        </li>
      ) : null}
      <li>
        <InfiniteSentinel hasMore={canLoadMore} loading={loading} onLoadMore={() => void loadOlder()} count={all.length} error={loadError} resetKey={`${videoId}|${versions[0]?.version ?? 0}`} />
      </li>
    </ul>
  );
}

function ProjectInspector({ composition }: { composition: Composition }) {
  const versions = useEditor((state) => state.versions);
  const version = useEditor((state) => state.version);
  const videoId = useEditor((state) => state.videoId);
  const burnCaptions = useEditor((state) => state.burnCaptions);
  const findings = useMemo(() => lintMotion(composition).slice(0, 8), [composition]);
  const { brief } = composition;
  const project: TabSpec = {
    id: "project",
    label: "Project",
    content: (
      <>
        <Section title="Project">
          <FieldRow label="Title">
            <TextField
              label="Project title"
              value={composition.title}
              onCommit={async (title) => {
                try {
                  await callAction("rename-video" as never, { videoId, title } as never);
                  await useEditor.getState().refresh();
                } catch (error) {
                  toast.error(errorMessage(error));
                }
              }}
            />
          </FieldRow>
          <div className="grid grid-cols-4 gap-1.5">
            {ASPECT_RATIOS.map((ratio) => {
              const [w, h] = ratio.split(":").map(Number) as [number, number];
              const scale = 26 / Math.max(w, h);
              return (
                <button key={ratio} type="button" title={ASPECT_RATIO_INFO[ratio].use} onClick={() => ratio !== composition.ratio && setFormat(ratio)} className={cn("pc-press flex h-16 flex-col items-center justify-center gap-1.5 rounded-ds-sm text-[11px] font-medium tabular", ratio === composition.ratio ? "bg-ds-accent-soft text-ds-accent shadow-[inset_0_0_0_1.5px_var(--ds-accent)]" : "bg-ds-surface-2 text-ds-text-2 hover:text-ds-text")}>
                  <span className="rounded-[3px] border-[1.5px] border-current" style={{ width: w * scale, height: h * scale }} />
                  {ratio}
                </button>
              );
            })}
          </div>
          <FieldRow label="Frame rate">
            <Select label="Frame rate" className="w-full" value={String(composition.fps)} onChange={(fps) => commit(`${fps} fps`, [{ op: "set-format", fps: Number(fps) as 30 }])} options={["24", "25", "30", "50", "60"].map((fps) => ({ value: fps, label: `${fps} fps` }))} />
          </FieldRow>
          <FieldRow label="Size">
            <span className="font-mono text-xs tabular text-ds-text-2">
              {composition.width} × {composition.height}
            </span>
          </FieldRow>
          <FieldRow label="Background">
            <ColorField label="Canvas colour" value={brief.palette.background} onChange={(background) => background && commit("Canvas colour", [{ op: "set-art-direction", brief: { palette: { background } } }])} />
          </FieldRow>
          <FieldRow label="Captions">
            <Switch label="Show captions" checked={burnCaptions} onCheckedChange={(on) => useEditor.getState().setBurnCaptions(on)} />
            <span className="text-[11px] text-ds-text-3">in the preview</span>
          </FieldRow>
        </Section>
        <Section title="Art direction">
          <p className="text-[13px] font-medium leading-snug text-ds-text">{brief.mood}</p>
          <div className="flex gap-1">
            {(["background", "surface", "ink", "muted", "accent"] as const).map((key) => (
              <span key={key} title={`${key} ${brief.palette[key]}`} className="size-6 rounded-[6px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)]" style={{ background: brief.palette[key] }} />
            ))}
          </div>
          <p className="text-[11px] text-ds-text-3">
            {brief.typePairing.display} / {brief.typePairing.body} · {brief.layoutGrid} · {brief.motionSignature}
          </p>
          <Button size="sm" variant="outline" className="pc-press self-start" onClick={() => void askEditorAgent(`Give video ${videoId} a fresh look: new colours, type and motion. Keep it different from my recent videos.`, { videoId })}>
            <IconSparkles className="size-4" /> Try a different look
          </Button>
        </Section>
        <Section title={`Motion check · ${findings.length || "all good"}`} defaultOpen={findings.length > 0}>
          {findings.length === 0 ? (
            <p className="text-xs text-ds-text-3">Animations move naturally and text stays readable.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {findings.map((finding, index) => (
                <li key={index} className="text-xs">
                  <span className={cn("font-medium", finding.severity === "minor" ? "text-ds-warning" : "text-ds-danger")}>{finding.code.replace(/_/g, " ")}</span>
                  <span className="text-ds-text-2"> — {finding.fix}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </>
    ),
  };
  const history: TabSpec = {
    id: "history",
    label: "History",
    content: (
      <HistoryList versions={versions} version={version} videoId={videoId} />
    ),
  };
  return <InspectorFrame icon={<IconStack2 />} title={composition.title} subtitle={`${composition.ratio} · ${(composition.durationMs / 1000).toFixed(1)} s`} tabs={[project, history]} />;
}

function MultiInspector({ count }: { count: number }) {
  return (
    <InspectorFrame
      icon={<IconStack2 />}
      title={`${count} clips selected`}
      tabs={[
        {
          id: "multi",
          label: "Selection",
          content: (
            <Section title="Selection">
              <div className="grid grid-cols-3 gap-2">
                <Button size="sm" variant="outline" onClick={() => copySelection()}>
                  Copy
                </Button>
                <Button size="sm" variant="outline" onClick={() => void duplicateSelection()}>
                  <IconPlus className="size-4" /> Duplicate
                </Button>
                <Button size="sm" variant="outline" className="text-ds-danger" onClick={() => deleteSelection()}>
                  <IconTrash className="size-4" /> Delete
                </Button>
              </div>
              <p className="text-[11px] text-ds-text-3">Shift-click clips to add or remove them from the selection.</p>
            </Section>
          ),
        },
      ]}
    />
  );
}

export function Inspector({ className }: { className?: string }) {
  const composition = useEditor((state) => state.composition);
  const selectedClipIds = useEditor((state) => state.selectedClipIds);
  const selectedLayer = useEditor((state) => state.selectedLayer);
  if (!composition) return null;
  const selection = describeSelection(composition, selectedClipIds, selectedLayer);
  const key = selection.kind === "layer" ? `l-${selection.layer.id}` : selection.kind === "none" ? "none" : selection.kind === "multi" ? "multi" : `c-${selection.clip.id}`;
  return (
    <aside className={cn("flex min-h-0 flex-col", className)} aria-label="Inspector" key={key}>
      {selection.kind === "layer" ? (
        <LayerInspector composition={composition} selection={selection} />
      ) : selection.kind === "clip" ? (
        <ClipInspector composition={composition} clip={selection.clip} />
      ) : selection.kind === "audio" ? (
        <AudioInspector composition={composition} selection={selection} />
      ) : selection.kind === "caption" ? (
        <CaptionInspector composition={composition} selection={selection} />
      ) : selection.kind === "multi" ? (
        <MultiInspector count={selection.clipIds.length} />
      ) : (
        <ProjectInspector composition={composition} />
      )}
    </aside>
  );
}

