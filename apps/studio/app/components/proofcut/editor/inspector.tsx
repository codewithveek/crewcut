import {
  type AnimatableProperty,
  type Composition,
  type Layer,
  type LeafLayer,
  MOTION_PRESETS,
  TRANSITION_PRESETS,
  TRANSITION_TYPES,
  type VisualClip,
  applyMotionPreset,
  findLayer,
  formatTimecode,
  lintMotion,
  parseTimecode,
  removeKeyframe,
  resolveLayerTransform,
  setKeyframe,
  setTransition,
  trimClip,
  updateClip,
  updateLayer,
} from "@proofcut/composition";
import { IconDiamond, IconDiamondFilled, IconHistory, IconRobot, IconSparkles, IconUser } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { askAgent, formatAgo } from "@/lib/proofcut";
import { cn } from "@/lib/utils";

import { useEditor } from "./editor-store";

const TRANSFORM_FIELDS: Array<{ property: AnimatableProperty; label: string; step: number; unit: string }> = [
  { property: "x", label: "X", step: 0.5, unit: "%" },
  { property: "y", label: "Y", step: 0.5, unit: "%" },
  { property: "width", label: "W", step: 0.5, unit: "%" },
  { property: "height", label: "H", step: 0.5, unit: "%" },
  { property: "scale", label: "Scale", step: 0.01, unit: "" },
  { property: "rotation", label: "Rotate", step: 1, unit: "°" },
  { property: "opacity", label: "Opacity", step: 0.05, unit: "" },
  { property: "blur", label: "Blur", step: 0.5, unit: "px" },
  { property: "offsetX", label: "Offset X", step: 1, unit: "px" },
  { property: "offsetY", label: "Offset Y", step: 1, unit: "px" },
];

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-2 border-b border-border px-3 py-3", className)}>
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function NumberField({ label, value, step, unit, onCommit, keyed, onToggleKey }: { label: string; value: number; step: number; unit: string; onCommit: (value: number) => void; keyed?: "on" | "has" | "none"; onToggleKey?: () => void }) {
  const [draft, setDraft] = useState(String(round(value)));
  useEffect(() => setDraft(String(round(value))), [value]);
  const commit = () => {
    const next = Number(draft);
    if (Number.isFinite(next) && Math.abs(next - value) > 1e-9) onCommit(next);
    else setDraft(String(round(value)));
  };
  return (
    <label className="flex items-center gap-1.5 text-xs">
      <span className="w-14 shrink-0 text-muted-foreground">{label}</span>
      <input
        inputMode="decimal"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") commit();
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            const next = round(Number(draft) + (event.key === "ArrowUp" ? 1 : -1) * step * (event.shiftKey ? 10 : 1));
            setDraft(String(next));
            onCommit(next);
          }
        }}
        className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-[12px] tabular outline-none focus-visible:ring-2 focus-visible:ring-[var(--pc-accent)]"
      />
      <span className="w-4 text-[10px] text-muted-foreground">{unit}</span>
      {onToggleKey ? (
        <button
          type="button"
          onClick={onToggleKey}
          aria-label={keyed === "on" ? `Remove ${label} keyframe at playhead` : `Add ${label} keyframe at playhead`}
          title={keyed === "on" ? "Remove keyframe at playhead" : "Add keyframe at playhead"}
          className={cn("pc-press flex size-6 items-center justify-center rounded", keyed === "none" ? "text-muted-foreground/50 hover:text-foreground" : "text-pc-accent")}
        >
          {keyed === "on" ? <IconDiamondFilled className="size-3.5" /> : <IconDiamond className="size-3.5" />}
        </button>
      ) : null}
    </label>
  );
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function LayerInspector({ composition, clip, layer }: { composition: Composition; clip: VisualClip; layer: Layer | LeafLayer }) {
  const playheadMs = useEditor((state) => state.playheadMs);
  const commit = useEditor((state) => state.commit);
  const localMs = playheadMs - clip.startMs - layer.startMs;
  const resolved = resolveLayerTransform(layer, localMs, composition.seed);
  const [presetId, setPresetId] = useState("fade-rise");
  const [mode, setMode] = useState<"enter" | "exit">("enter");
  const preset = MOTION_PRESETS.find((candidate) => candidate.id === presetId);

  const keyStateFor = (property: AnimatableProperty): "on" | "has" | "none" => {
    const keyframes = layer.keyframes[property];
    if (!keyframes?.length) return "none";
    return keyframes.some((keyframe) => Math.abs(keyframe.atMs - localMs) < 1000 / composition.fps / 2) ? "on" : "has";
  };

  const setProperty = (property: AnimatableProperty, value: number) => {
    // Auto-key: properties that already animate get a keyframe at the playhead.
    if (layer.keyframes[property]?.length) {
      const input = { clipId: clip.id, layerId: layer.id, property, atMs: Math.round(localMs), value };
      void commit("set-keyframe", input, (c) => setKeyframe(c, input));
      return;
    }
    const patch = { transform: { [property]: value } };
    void commit("update-layer", { clipId: clip.id, layerId: layer.id, patch }, (c) => updateLayer(c, { clipId: clip.id, layerId: layer.id, patch }));
  };

  const toggleKey = (property: AnimatableProperty, value: number) => {
    const atMs = Math.round(localMs);
    if (keyStateFor(property) === "on") {
      const existing = layer.keyframes[property]?.find((keyframe) => Math.abs(keyframe.atMs - localMs) < 1000 / composition.fps / 2);
      const input = { clipId: clip.id, layerId: layer.id, property, atMs: existing?.atMs ?? atMs, remove: true };
      void commit("set-keyframe", input, (c) => removeKeyframe(c, { ...input }));
    } else {
      const input = { clipId: clip.id, layerId: layer.id, property, atMs, value };
      void commit("set-keyframe", input, (c) => setKeyframe(c, input));
    }
  };

  return (
    <>
      <Section title={`${layer.type} layer`}>
        <p className="truncate text-[13px] font-medium text-foreground">{layer.name ?? layer.id}</p>
        <p className="text-[11px] text-muted-foreground tabular">Layer time {formatTimecode(Math.max(0, localMs), { fps: composition.fps })}</p>
      </Section>
      {layer.type === "text" ? (
        <Section title="Text">
          <TextEditor
            value={layer.text}
            onCommit={(text) => void commit("update-layer", { clipId: clip.id, layerId: layer.id, patch: { text } }, (c) => updateLayer(c, { clipId: clip.id, layerId: layer.id, patch: { text } }))}
          />
          <p className="text-[11px] text-muted-foreground">Wrap words in *stars* to accent them.</p>
          <NumberField label="Size" value={layer.style.size} step={2} unit="px" onCommit={(size) => void commit("update-layer", { clipId: clip.id, layerId: layer.id, patch: { style: { size } } }, (c) => updateLayer(c, { clipId: clip.id, layerId: layer.id, patch: { style: { size } } }))} />
          <NumberField label="Weight" value={layer.style.weight} step={100} unit="" onCommit={(weight) => void commit("update-layer", { clipId: clip.id, layerId: layer.id, patch: { style: { weight: Math.round(weight / 100) * 100 } } }, (c) => updateLayer(c, { clipId: clip.id, layerId: layer.id, patch: { style: { weight: Math.round(weight / 100) * 100 } } }))} />
          <label className="flex items-center gap-1.5 text-xs">
            <span className="w-14 shrink-0 text-muted-foreground">Colour</span>
            <input
              type="color"
              value={(layer.style.color ?? composition.brief.palette.ink).slice(0, 7)}
              onChange={(event) => {
                const color = event.target.value;
                void commit("update-layer", { clipId: clip.id, layerId: layer.id, patch: { style: { color } } }, (c) => updateLayer(c, { clipId: clip.id, layerId: layer.id, patch: { style: { color } } }));
              }}
              className="h-7 w-10 rounded border border-input bg-transparent"
            />
          </label>
        </Section>
      ) : null}
      <Section title="Transform · auto-keys animated properties">
        {TRANSFORM_FIELDS.filter((field) => layer.type !== "group" || !["width", "height"].includes(field.property)).map((field) => {
          const value = field.property === "width" ? (resolved.width ?? 0) : field.property === "height" ? (resolved.height ?? 0) : (resolved[field.property] as number);
          return (
            <NumberField
              key={field.property}
              label={field.label}
              value={value}
              step={field.step}
              unit={field.unit}
              keyed={keyStateFor(field.property)}
              onCommit={(next) => setProperty(field.property, next)}
              onToggleKey={() => toggleKey(field.property, value)}
            />
          );
        })}
      </Section>
      <Section title="Motion presets">
        <div className="flex gap-1.5">
          <select value={presetId} onChange={(event) => setPresetId(event.target.value)} className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs">
            {(["enter", "text", "emphasis", "camera", "ambient"] as const).map((group) => (
              <optgroup key={group} label={group}>
                {MOTION_PRESETS.filter((candidate) => candidate.group === group && (candidate.appliesTo === "any" || candidate.appliesTo.includes(layer.type))).map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {preset?.supportsExit ? (
            <select value={mode} onChange={(event) => setMode(event.target.value as "enter" | "exit")} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
              <option value="enter">Enter</option>
              <option value="exit">Exit</option>
            </select>
          ) : null}
        </div>
        {preset ? <p className="text-[11px] text-muted-foreground">{preset.description}</p> : null}
        <Button
          size="sm"
          variant="secondary"
          className="pc-press"
          onClick={() => {
            const input = { clipId: clip.id, layerIds: [layer.id], presetId, mode: preset?.supportsExit ? mode : ("enter" as const), atMs: mode === "exit" ? undefined : Math.max(0, Math.round(localMs)) };
            const clean = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as typeof input;
            void commit("apply-motion-preset", clean, (c) => applyMotionPreset(c, { ...clean, layerIds: [layer.id] }));
          }}
        >
          Apply at playhead
        </Button>
      </Section>
    </>
  );
}

function TextEditor({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <textarea
      value={draft}
      rows={3}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => event.stopPropagation()}
      onBlur={() => {
        if (draft.trim() && draft !== value) onCommit(draft);
      }}
      className="w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--pc-accent)]"
    />
  );
}

function ClipInspector({ composition, clip }: { composition: Composition; clip: VisualClip }) {
  const commit = useEditor((state) => state.commit);
  const selectLayer = useEditor((state) => state.selectLayer);
  const fps = composition.fps;
  const [startDraft, setStartDraft] = useState(formatTimecode(clip.startMs, { fps }));
  const [endDraft, setEndDraft] = useState(formatTimecode(clip.startMs + clip.durationMs, { fps }));
  useEffect(() => {
    setStartDraft(formatTimecode(clip.startMs, { fps }));
    setEndDraft(formatTimecode(clip.startMs + clip.durationMs, { fps }));
  }, [clip.startMs, clip.durationMs, fps]);
  const trimTo = (edge: "start" | "end", text: string) => {
    const ms = parseTimecode(text, fps);
    if (ms === null) return;
    const input = { clipId: clip.id, edge, toMs: Math.round(ms), ripple: useEditor.getState().ripple };
    void commit("trim-clip", input, (c) => trimClip(c, input));
  };
  return (
    <>
      <Section title="Clip">
        <p className="truncate text-[13px] font-medium text-foreground">{clip.name ?? clip.id}</p>
        {(["start", "end"] as const).map((edge) => (
          <label key={edge} className="flex items-center gap-1.5 text-xs">
            <span className="w-14 shrink-0 text-muted-foreground">{edge === "start" ? "In" : "Out"}</span>
            <input
              value={edge === "start" ? startDraft : endDraft}
              onChange={(event) => (edge === "start" ? setStartDraft : setEndDraft)(event.target.value)}
              onBlur={(event) => trimTo(edge, event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") trimTo(edge, (event.target as HTMLInputElement).value);
              }}
              className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-[12px] tabular outline-none focus-visible:ring-2 focus-visible:ring-[var(--pc-accent)]"
            />
          </label>
        ))}
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className={cn("rounded-full px-2 py-0.5 text-[11px]", clip.timing === "narration" ? "bg-pc-accent-soft text-pc-accent" : "bg-muted text-muted-foreground")}>
            {clip.timing === "narration" ? "Timed by narration" : "Manual timing"}
          </span>
          {clip.timing === "manual" ? (
            <button
              type="button"
              className="text-[11px] text-pc-accent underline-offset-2 hover:underline"
              onClick={() => void commit("update-clip", { clipId: clip.id, patch: { timing: "narration" } }, (c) => updateClip(c, { clipId: clip.id, patch: { timing: "narration" } }))}
            >
              Re-lock to voice
            </button>
          ) : null}
        </div>
      </Section>
      <Section title="Transition in">
        <select
          value={clip.transitionIn?.type ?? "none"}
          onChange={(event) => {
            const type = event.target.value;
            const preset = TRANSITION_PRESETS.find((candidate) => candidate.transition.type === type)?.transition;
            const transition = type === "none" ? null : { ...(preset ?? { durationMs: 500, direction: "left" as const, easing: "move" as const }), type: type as (typeof TRANSITION_TYPES)[number] };
            void commit("set-transition", { clipId: clip.id, transition }, (c) => setTransition(c, { clipId: clip.id, transition }));
          }}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="none">None</option>
          {TRANSITION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        {clip.transitionIn ? (
          <NumberField
            label="Length"
            value={clip.transitionIn.durationMs}
            step={10}
            unit="ms"
            onCommit={(durationMs) => void commit("set-transition", { clipId: clip.id, transition: { durationMs } }, (c) => setTransition(c, { clipId: clip.id, transition: { durationMs } }))}
          />
        ) : null}
      </Section>
      <Section title="Layers">
        <ul className="flex flex-col">
          {[...clip.layers].reverse().map((layer) => (
            <li key={layer.id}>
              <button type="button" onClick={() => selectLayer({ clipId: clip.id, layerId: layer.id })} className="pc-press flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-accent">
                <span className="w-12 shrink-0 font-mono text-[10px] uppercase text-muted-foreground">{layer.type}</span>
                <span className="truncate text-foreground">{layer.type === "text" ? layer.text.replace(/\*/g, "") : (layer.name ?? layer.id)}</span>
                {Object.keys(layer.keyframes).length > 0 ? <IconDiamondFilled className="ml-auto size-3 shrink-0 text-pc-accent" /> : null}
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

function CompositionInspector({ composition }: { composition: Composition }) {
  const versions = useEditor((state) => state.versions);
  const version = useEditor((state) => state.version);
  const restore = useEditor((state) => state.restore);
  const videoId = useEditor((state) => state.videoId);
  const findings = useMemo(() => lintMotion(composition).slice(0, 8), [composition]);
  const { brief } = composition;
  return (
    <>
      <Section title="Art direction">
        <p className="text-[13px] font-medium leading-snug text-foreground">{brief.mood}</p>
        <div className="flex gap-1">
          {(["background", "surface", "ink", "muted", "accent"] as const).map((key) => (
            <span key={key} title={`${key} ${brief.palette[key]}`} className="size-6 rounded shadow-[0_0_0_1px_var(--pc-hairline)]" style={{ background: brief.palette[key] }} />
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {brief.typePairing.display} / {brief.typePairing.body} · {brief.layoutGrid} · {brief.motionSignature} · {brief.pacing}
        </p>
        <Button size="sm" variant="secondary" className="pc-press self-start" onClick={() => askAgent(`Give video ${videoId} a fresh art direction and recompose it. Keep it different from my recent videos.`, { videoId })}>
          <IconSparkles className="size-4" />
          Try a different look
        </Button>
      </Section>
      <Section title={`Motion review · ${findings.length || "clean"}`}>
        {findings.length === 0 ? (
          <p className="text-xs text-muted-foreground">Springs, entrances, stagger and blur follow the motion rules.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {findings.map((finding, index) => (
              <li key={index} className="text-xs">
                <span className={cn("font-medium", finding.severity === "minor" ? "text-weak" : "text-unsupported")}>{finding.code.replace(/_/g, " ")}</span>
                <span className="text-muted-foreground"> — {finding.fix}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="History" className="border-b-0">
        <ul className="flex flex-col">
          {versions.slice(0, 25).map((entry) => (
            <li key={entry.version}>
              <button
                type="button"
                onClick={() => void restore(entry.version)}
                disabled={entry.version === version}
                className={cn("pc-press flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left text-xs hover:bg-accent disabled:cursor-default", entry.version === version && "bg-pc-accent-soft")}
              >
                {entry.authorKind === "agent" ? <IconRobot className="mt-0.5 size-3.5 shrink-0 text-pc-accent" /> : <IconUser className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-foreground">{entry.label.replace(/^Agent: /, "")}</span>
                  <span className="text-[10px] text-muted-foreground tabular">
                    v{entry.version} · {formatAgo(entry.createdAt)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {versions.length === 0 ? (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <IconHistory className="size-3.5" /> No edits yet.
          </p>
        ) : null}
      </Section>
    </>
  );
}

export function Inspector({ className }: { className?: string }) {
  const composition = useEditor((state) => state.composition);
  const selectedClipIds = useEditor((state) => state.selectedClipIds);
  const selectedLayer = useEditor((state) => state.selectedLayer);
  if (!composition) return null;
  const visualClip = (clipId: string | undefined) => {
    for (const track of composition.tracks) {
      if (track.kind !== "visual") continue;
      const clip = track.clips.find((candidate) => candidate.id === clipId);
      if (clip) return clip;
    }
    return undefined;
  };
  const layerClip = visualClip(selectedLayer?.clipId);
  const layerLocation = layerClip && selectedLayer ? findLayer(layerClip, selectedLayer.layerId) : null;
  const clip = visualClip(selectedClipIds[0]);
  return (
    <aside className={cn("flex min-h-0 flex-col overflow-y-auto", className)} aria-label="Inspector">
      {layerClip && layerLocation ? (
        <LayerInspector composition={composition} clip={layerClip} layer={layerLocation.layer} />
      ) : clip ? (
        <ClipInspector composition={composition} clip={clip} />
      ) : (
        <CompositionInspector composition={composition} />
      )}
    </aside>
  );
}
