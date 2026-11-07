import type { Composition, Layer, VisualClip } from "../schema";
import { type AspectRatio, FRAME_SIZE } from "../units";

/**
 * Templates as data: a finished video (a composition) whose swappable layers
 * carry a `slot` id. People make one from any project ("Save as template"),
 * admins publish one to the catalog; using it copies the composition and
 * puts the person's words and photos into the slots. Everything here is
 * pure, so the server, the gallery preview and tests share it.
 */

export type DataSlotKind = "photo" | "video" | "text";

export interface DataTemplateSlot {
  id: string;
  kind: DataSlotKind;
  label: string;
  /** Text: the sample copy. Photo/video: the designed media (`asset:<id>`). */
  default: string;
  /** Text: a length that still fits the design. */
  maxLength?: number;
}

/** A layer the author marked as swappable. */
export interface SlotPick {
  clipId: string;
  layerId: string;
  label?: string;
}

export function slotKindOf(layer: Layer): DataSlotKind | null {
  if (layer.type === "text") return "text";
  if (layer.type === "image") return "photo";
  if (layer.type === "video") return "video";
  return null;
}

type LayerVisit = (layer: Layer, clip: VisualClip) => Layer;

/** A copy of the composition with every visual layer (group children too) passed through `visit`. */
export function mapLayers(composition: Composition, visit: LayerVisit): Composition {
  return {
    ...composition,
    tracks: composition.tracks.map((track) => {
      if (track.kind !== "visual") return track;
      return {
        ...track,
        clips: track.clips.map((clip) => ({
          ...clip,
          layers: clip.layers.map((layer) => {
            const next = visit(layer, clip);
            if (next.type !== "group") return next;
            return { ...next, children: next.children.map((child) => visit(child as Layer, clip) as typeof child) };
          }),
        })),
      };
    }),
  } as Composition;
}

/** Visual layers in timeline order (clip start, then stacking order), with their clip. */
export function layersInOrder(composition: Composition): Array<{ clip: VisualClip; layer: Layer }> {
  const found: Array<{ clip: VisualClip; layer: Layer; order: number }> = [];
  let order = 0;
  for (const track of composition.tracks) {
    if (track.kind !== "visual") continue;
    for (const clip of track.clips) {
      for (const layer of clip.layers) {
        found.push({ clip, layer, order: order++ });
        if (layer.type === "group") for (const child of layer.children) found.push({ clip, layer: child as Layer, order: order++ });
      }
    }
  }
  return found.sort((a, b) => a.clip.startMs - b.clip.startMs || a.order - b.order).map(({ clip, layer }) => ({ clip, layer }));
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_-]+/g, "-")
      .slice(0, 32)
      .replace(/-+$/, "") || "slot"
  );
}

const plain = (text: string) => text.replace(/\*/g, "").replace(/\s+/g, " ").trim();

function defaultLabel(layer: Layer, kind: DataSlotKind, index: number): string {
  if (layer.name && !/^(Text|Photo|Image|Video)( \(.*\))?$/.test(layer.name)) return layer.name;
  if (kind === "text" && layer.type === "text") return plain(layer.text).slice(0, 40) || `Text ${index}`;
  return kind === "photo" ? `Photo ${index}` : kind === "video" ? `Video ${index}` : `Text ${index}`;
}

/**
 * Marks the chosen layers as the template's slots (and clears any old marks).
 * Slot ids come from the labels, so the same label in another format's
 * version of the template fills the same slot. Returns the slots in timeline order.
 */
export function markTemplateSlots(composition: Composition, picks: readonly SlotPick[]): { composition: Composition; slots: DataTemplateSlot[] } {
  const wanted = new Map(picks.map((pick) => [`${pick.clipId}/${pick.layerId}`, pick]));
  /** clip/layer → the slot it fills. */
  const assigned = new Map<string, { id: string; label: string }>();
  /** label + kind → slot id: one label is one slot, so a name repeated across scenes fills every copy. */
  const byLabel = new Map<string, string>();
  const used = new Set<string>();
  const counters: Record<DataSlotKind, number> = { photo: 0, video: 0, text: 0 };
  // Ids are given in timeline order so they read naturally (title, photo-1, photo-2…).
  for (const { clip, layer } of layersInOrder(composition)) {
    const key = `${clip.id}/${layer.id}`;
    const pick = wanted.get(key);
    const kind = slotKindOf(layer);
    if (!pick || !kind) continue;
    counters[kind] += 1;
    const label = (pick.label?.trim() || defaultLabel(layer, kind, counters[kind])).slice(0, 60);
    const labelKey = `${label.toLowerCase()}|${kind}`;
    let id = byLabel.get(labelKey);
    if (!id) {
      const base = slug(label);
      id = base;
      for (let n = 2; used.has(id); n += 1) id = `${base.slice(0, 28)}-${n}`;
      used.add(id);
      byLabel.set(labelKey, id);
    }
    assigned.set(key, { id, label });
  }
  const marked = mapLayers(composition, (layer, clip) => {
    const slot = assigned.get(`${clip.id}/${layer.id}`);
    const { slot: _old, ...rest } = layer as Layer & { slot?: string };
    void _old;
    if (!slot) return rest as Layer;
    return { ...rest, slot: slot.id, name: slot.label.slice(0, 80) } as Layer;
  });
  return { composition: marked, slots: templateSlotsOf(marked) };
}

/** The slots a template composition declares, in timeline order (one entry per slot id). */
export function templateSlotsOf(composition: Composition): DataTemplateSlot[] {
  const slots = new Map<string, DataTemplateSlot>();
  for (const { layer } of layersInOrder(composition)) {
    const id = (layer as { slot?: string }).slot;
    const kind = slotKindOf(layer);
    if (!id || !kind || slots.has(id)) continue;
    const label = layer.name?.trim() || id;
    if (layer.type === "text") {
      const length = plain(layer.text).length;
      slots.set(id, { id, kind, label, default: layer.text, maxLength: Math.min(600, Math.max(24, Math.ceil(length * 1.5))) });
    } else if (layer.type === "image" || layer.type === "video") {
      slots.set(id, { id, kind, label, default: layer.src });
    }
  }
  return [...slots.values()];
}

const MEDIA_VALUE = /^(asset:[A-Za-z0-9_-]+|https:\/\/\S+)$/;

/**
 * Puts the person's words and media into the slots. Text slots take any text
 * (600 characters at most); photo and video slots take `asset:<id>` or an
 * https link. Empty or unknown values keep the design's own content.
 */
export function fillTemplateSlots(composition: Composition, values: Readonly<Record<string, string>>): Composition {
  const entries = Object.entries(values).filter(([, value]) => value.trim());
  if (entries.length === 0) return composition;
  const map = new Map(entries.map(([id, value]) => [id, value.trim()]));
  return mapLayers(composition, (layer) => {
    const id = (layer as { slot?: string }).slot;
    const value = id ? map.get(id) : undefined;
    if (!value) return layer;
    if (layer.type === "text") return { ...layer, text: value.slice(0, 600) };
    if ((layer.type === "image" || layer.type === "video") && MEDIA_VALUE.test(value)) {
      const { alt: _alt, ...rest } = layer as typeof layer & { alt?: string };
      void _alt;
      return { ...rest, src: value } as Layer;
    }
    return layer;
  });
}

/** Asset ids (`asset:<id>`) a composition uses, in layers and audio clips. */
export function compositionAssetIds(composition: Composition): string[] {
  const ids = new Set<string>();
  for (const { layer } of layersInOrder(composition)) {
    if ((layer.type === "image" || layer.type === "video") && layer.src.startsWith("asset:")) ids.add(layer.src.slice(6));
  }
  for (const track of composition.tracks) {
    if (track.kind !== "audio") continue;
    for (const clip of track.clips) if (clip.src.startsWith("asset:")) ids.add(clip.src.slice(6));
  }
  return [...ids];
}

/** Rewrites `asset:<old>` references (layers and audio) to new asset ids. */
export function remapAssetRefs(composition: Composition, map: Readonly<Record<string, string>>): Composition {
  const swap = (src: string) => (src.startsWith("asset:") && map[src.slice(6)] ? `asset:${map[src.slice(6)]}` : src);
  const layered = mapLayers(composition, (layer) => (layer.type === "image" || layer.type === "video" ? ({ ...layer, src: swap(layer.src) } as Layer) : layer));
  return {
    ...layered,
    tracks: layered.tracks.map((track) => (track.kind === "audio" ? { ...track, clips: track.clips.map((clip) => ({ ...clip, src: swap(clip.src) })) } : track)),
  } as Composition;
}

/** Of the formats a template comes in, the one closest in shape to the one asked for. */
export function closestRatioOf(available: readonly AspectRatio[], ratio: AspectRatio): AspectRatio | null {
  if (available.includes(ratio)) return ratio;
  const target = FRAME_SIZE[ratio].width / FRAME_SIZE[ratio].height;
  const distance = (entry: AspectRatio) => Math.abs(Math.log(FRAME_SIZE[entry].width / FRAME_SIZE[entry].height / target));
  return [...available].sort((a, b) => distance(a) - distance(b))[0] ?? null;
}
