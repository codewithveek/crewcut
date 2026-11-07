import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { type AspectRatio, type Composition, type Layer, TEMPLATE_CATEGORIES, TEMPLATE_CATEGORY_LABELS, type TemplateCategory, formatTimecode, isCrewcutEnding } from "@crewcut/composition";
import { IconPhoto, IconTypography, IconVideo } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { Button, Dialog, FieldRow, Segmented, Select } from "@/components/ds";
import { errorMessage } from "@/lib/crewcut";
import { cn } from "@/lib/utils";

import { useCatalogAccess } from "../catalog/use-catalog-access";
import { useEditor } from "./editor-store";

/**
 * "Save as template": the person picks which words, photos and videos others
 * can change, names it, and the video becomes a template for their workspace
 * (or, for admins, a catalog template in a pack). Saving another format of
 * the same video into an existing template adds that format to it.
 */

interface Candidate {
  key: string;
  clipId: string;
  layerId: string;
  kind: "text" | "photo" | "video";
  startMs: number;
  preview: string;
  suggested: string;
  marked: boolean;
}

/** Resolves once every edit has been saved (the template is made from the saved video), or after 15 s. */
function waitForSaves(): Promise<void> {
  if (useEditor.getState().saving === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = window.setTimeout(done, 15_000);
    const stop = useEditor.subscribe((state) => state.saving === 0 && done());
    function done() {
      window.clearTimeout(timer);
      stop();
      resolve();
    }
  });
}

const plain = (text: string) => text.replace(/\*/g, "").replace(/\s+/g, " ").trim();

function candidatesOf(composition: Composition): Candidate[] {
  const found: Candidate[] = [];
  const counters = { text: 0, photo: 0, video: 0 };
  const visit = (clip: { id: string; startMs: number }, layer: Layer) => {
    const kind = layer.type === "text" ? "text" : layer.type === "image" ? "photo" : layer.type === "video" ? "video" : null;
    if (!kind) return;
    counters[kind] += 1;
    const generic = !layer.name || /^(Text|Photo|Image|Video)( \(.*\))?$/.test(layer.name);
    const suggested = !generic ? layer.name! : kind === "text" && layer.type === "text" ? plain(layer.text).slice(0, 40) || `Text ${counters.text}` : kind === "photo" ? `Photo ${counters.photo}` : `Video ${counters.video}`;
    found.push({
      key: `${clip.id}/${layer.id}`,
      clipId: clip.id,
      layerId: layer.id,
      kind,
      startMs: clip.startMs + Math.max(0, layer.startMs),
      preview: layer.type === "text" ? plain(layer.text) : layer.type === "image" || layer.type === "video" ? layer.src : "",
      suggested: suggested.slice(0, 60),
      marked: Boolean((layer as { slot?: string }).slot),
    });
  };
  for (const track of composition.tracks) {
    if (track.kind !== "visual") continue;
    for (const clip of track.clips) {
      if (isCrewcutEnding(clip)) continue;
      for (const layer of clip.layers) {
        visit(clip, layer);
        if (layer.type === "group") for (const child of layer.children) visit(clip, child as Layer);
      }
    }
  }
  return found.sort((a, b) => a.startMs - b.startMs);
}

interface SavedTemplate {
  id: string;
  name: string;
  ratios: AspectRatio[];
  canDelete: boolean;
}

interface CatalogListing {
  packs: Array<{ id: string; name: string; tier: string; status: string }>;
  items: Array<{ id: string; kind: string; name: string; current: { type: string } | null; draft: { type: string } | null }>;
}

export function SaveTemplateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const composition = useEditor((state) => state.composition);
  return composition && open ? <SaveTemplateContent composition={composition} open={open} onOpenChange={onOpenChange} /> : null;
}

function SaveTemplateContent({ composition, open, onOpenChange }: { composition: Composition; open: boolean; onOpenChange: (open: boolean) => void }) {
  const videoId = useEditor((state) => state.videoId);
  const assetUrls = useEditor((state) => state.assetUrls);
  const access = useCatalogAccess();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const candidates = useMemo(() => candidatesOf(composition), [composition]);
  // Start from the layers already marked (a template-made video), else every text and photo.
  const [chosen, setChosen] = useState<Set<string>>(() => {
    const marked = candidates.filter((candidate) => candidate.marked);
    return new Set((marked.length ? marked : candidates.filter((candidate) => candidate.kind !== "video")).map((candidate) => candidate.key));
  });
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [name, setName] = useState(composition.title);
  const [category, setCategory] = useState<TemplateCategory>("social");
  const [destination, setDestination] = useState<"workspace" | "catalog">("workspace");
  const [into, setInto] = useState("new");
  const [packId, setPackId] = useState("");
  const [publishNow, setPublishNow] = useState(false);
  const [saving, setSaving] = useState(false);

  const mine = useActionQuery("list-templates", { source: "yours" } as never, { enabled: open } as never);
  const ownTemplates = (((mine.data as { templates?: SavedTemplate[] } | undefined)?.templates ?? []).filter((template) => template.canDelete));
  const catalog = useActionQuery("list-catalog", { kind: "template" } as never, { enabled: open && destination === "catalog" && Boolean(access?.admin) } as never);
  const listing = catalog.data as CatalogListing | undefined;
  const catalogTemplates = (listing?.items ?? []).filter((item) => (item.draft ?? item.current)?.type === "data");
  useEffect(() => {
    if (!packId && listing?.packs[0]) setPackId(listing.packs.find((pack) => pack.id !== "pack_builtin")?.id ?? listing.packs[0].id);
  }, [listing, packId]);
  useEffect(() => setInto("new"), [destination]);

  const picks = candidates.filter((candidate) => chosen.has(candidate.key));
  const toggle = (key: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const show = (candidate: Candidate) => {
    const editor = useEditor.getState();
    editor.setPlayhead(candidate.startMs + 200);
    editor.selectLayer({ clipId: candidate.clipId, layerId: candidate.layerId });
  };

  const save = async () => {
    if (picks.length === 0) return toast.message("Choose at least one thing people can change.");
    setSaving(true);
    const slots = picks.map((candidate) => ({ clipId: candidate.clipId, layerId: candidate.layerId, label: (labels[candidate.key] ?? candidate.suggested).trim() || candidate.suggested }));
    try {
      // Saving uses the last saved version of the video: let pending edits land first.
      await waitForSaves();
      if (destination === "catalog") {
        const result = (await callAction("publish-video-as-template" as never, { videoId, slots, name: name.trim() || undefined, category, ...(into !== "new" ? { itemId: into } : { packId }) } as never)) as { itemId: string };
        if (publishNow) await callAction("set-catalog-item-status" as never, { itemId: result.itemId, status: "published" } as never);
        toast.success(publishNow ? "Published to the catalog" : "Saved to the catalog as unpublished changes", { action: { label: "Open admin", onClick: () => navigate("/admin") } });
      } else {
        const result = (await callAction("save-as-template" as never, { videoId, slots, name: name.trim() || undefined, category, ...(into !== "new" ? { templateId: into } : {}) } as never)) as { templateId: string; note?: string };
        if (result.note) toast.message(result.note);
        toast.success(into !== "new" ? `Added ${composition.ratio} to the template` : "Saved to your templates", { action: { label: "View", onClick: () => navigate(`/templates?source=yours&template=${result.templateId}`) } });
      }
      void queryClient.invalidateQueries({ queryKey: ["action", "list-templates"] });
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const intoOptions =
    destination === "catalog"
      ? [{ value: "new", label: "A new template" }, ...catalogTemplates.map((item) => ({ value: item.id, label: `Add ${composition.ratio} to “${item.name}”` }))]
      : [{ value: "new", label: "A new template" }, ...ownTemplates.map((template) => ({ value: template.id, label: template.ratios.includes(composition.ratio) ? `Replace ${composition.ratio} in “${template.name}”` : `Add ${composition.ratio} to “${template.name}”` }))];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Save as template"
      description="Choose what people can change. Everything else (layout, motion, music, transitions) stays as you designed it."
      className="w-[min(720px,calc(100vw-32px))]"
      footer={
        <>
          <span className="mr-auto text-[12px] text-ds-text-3">{picks.length} of {candidates.length} can be changed</span>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving || picks.length === 0 || (destination === "catalog" && into === "new" && !packId)} className="pc-press">
            {saving ? "Saving…" : destination === "catalog" ? (publishNow ? "Publish" : "Save to catalog") : "Save template"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {access?.admin ? (
          <Segmented ariaLabel="Where it goes" className="self-start" value={destination} onChange={setDestination} options={[{ value: "workspace", label: "My workspace" }, { value: "catalog", label: "Crewcut catalog" }]} />
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-ds-text-2">Name</span>
            <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} className="h-9 rounded-ds-sm bg-ds-surface-2 px-3 text-sm text-ds-text shadow-[inset_0_0_0_1px_var(--ds-hairline)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--ds-accent)]" />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-[12px] text-ds-text-2">Category</span>
            <Select label="Category" className="h-9 w-full" value={category} onChange={(value) => setCategory(value as TemplateCategory)} options={TEMPLATE_CATEGORIES.map((id) => ({ value: id, label: TEMPLATE_CATEGORY_LABELS[id] }))} />
          </div>
        </div>
        <FieldRow label="Save as">
          <Select label="Save as" className="w-full" value={into} onChange={setInto} options={intoOptions} />
        </FieldRow>
        {destination === "catalog" ? (
          <div className="flex flex-col gap-2 rounded-ds-md bg-ds-surface-2 p-3 shadow-[inset_0_0_0_1px_var(--ds-hairline)]">
            {into === "new" ? (
              <FieldRow label="Pack">
                <Select label="Pack" className="w-full" value={packId} onChange={setPackId} options={(listing?.packs ?? []).map((pack) => ({ value: pack.id, label: `${pack.name} · ${pack.tier === "pro" ? "Pro" : "Free"}${pack.status === "published" ? "" : " · unpublished"}` }))} />
              </FieldRow>
            ) : null}
            <label className="flex items-center gap-2 text-[13px] text-ds-text">
              <input type="checkbox" checked={publishNow} onChange={(event) => setPublishNow(event.target.checked)} className="size-4 accent-[var(--ds-accent)]" />
              Publish for everyone now
            </label>
            <p className="text-[11px] text-ds-text-3">Unpublished templates wait in the admin area until you publish them. Media is copied with the template, so it works even if this video is deleted.</p>
          </div>
        ) : (
          <p className="-mt-2 text-[11px] text-ds-text-3">Everyone in your workspace will see it under Templates → Yours. Its photos and music are copied with it.</p>
        )}

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <p className="ds-overline flex-1 text-ds-text-3">What people can change</p>
            <button type="button" className="text-[12px] text-ds-text-2 hover:text-ds-text" onClick={() => setChosen(new Set(candidates.map((candidate) => candidate.key)))}>
              All
            </button>
            <button type="button" className="text-[12px] text-ds-text-2 hover:text-ds-text" onClick={() => setChosen(new Set())}>
              None
            </button>
          </div>
          {candidates.length === 0 ? <p className="rounded-ds-md border border-dashed border-ds-border px-4 py-6 text-center text-[13px] text-ds-text-2">This video has no text, photos or videos yet.</p> : null}
          <ul className="flex flex-col gap-1">
            {candidates.map((candidate) => {
              const on = chosen.has(candidate.key);
              const src = candidate.kind !== "text" ? (candidate.preview.startsWith("asset:") ? assetUrls[candidate.preview.slice(6)] : candidate.preview) : null;
              return (
                <li key={candidate.key} className={cn("flex items-center gap-2.5 rounded-ds-sm px-2 py-1.5", on ? "bg-ds-accent-soft" : "hover:bg-ds-surface-2")}>
                  <input type="checkbox" checked={on} onChange={() => toggle(candidate.key)} aria-label={`People can change ${candidate.suggested}`} className="size-4 shrink-0 accent-[var(--ds-accent)]" />
                  <button type="button" onClick={() => show(candidate)} title="Show it in the preview" className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-ds-surface-3 text-ds-text-3">
                    {candidate.kind === "photo" && src ? <img src={src} alt="" className="size-full object-cover" /> : candidate.kind === "photo" ? <IconPhoto className="size-4" /> : candidate.kind === "video" ? <IconVideo className="size-4" /> : <IconTypography className="size-4" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    {on ? (
                      <input
                        value={labels[candidate.key] ?? candidate.suggested}
                        maxLength={60}
                        onChange={(event) => setLabels((current) => ({ ...current, [candidate.key]: event.target.value }))}
                        aria-label="Name people see for this"
                        className="h-7 w-full rounded-[6px] bg-ds-surface px-2 text-[13px] font-medium text-ds-text shadow-[inset_0_0_0_1px_var(--ds-hairline)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--ds-accent)]"
                      />
                    ) : (
                      <p className="truncate text-[13px] text-ds-text-2">{candidate.suggested}</p>
                    )}
                    <p className="mt-0.5 truncate text-[11px] text-ds-text-3">
                      {candidate.kind === "text" ? "Text" : candidate.kind === "photo" ? "Photo" : "Video"} · {formatTimecode(candidate.startMs, { fps: composition.fps }).slice(3, 8)}
                      {candidate.kind === "text" && candidate.preview !== candidate.suggested ? ` · “${candidate.preview.slice(0, 50)}”` : ""}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-ds-text-3">Give the same name to things that should change together, like a brand name repeated in two scenes.</p>
        </div>
      </div>
    </Dialog>
  );
}
