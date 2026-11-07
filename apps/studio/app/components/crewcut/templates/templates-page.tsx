import type { AspectRatio, TemplateCategory } from "@crewcut/composition";
import { callAction } from "@agent-native/core/client/hooks";
import { IconMusic, IconSparkles, IconTemplate, IconTrash, IconVolume, IconVolumeOff } from "@tabler/icons-react";
import type { PlayerRef } from "@remotion/player";
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import { Button, CrewcutMark, Dialog, SearchField, Segmented, useDebouncedValue } from "@/components/ds";
import { askAgent, errorMessage } from "@/lib/crewcut";
import { cn } from "@/lib/utils";

import { ProBadge } from "../catalog/pro-badge";
import { formatDuration } from "../dashboard/use-videos";
import { VideoThumb } from "../dashboard/video-thumb";
import { type TemplateSummary, useStartFromTemplate, useTemplatePreview, useTemplates } from "./use-templates";

const TemplatePlayer = lazy(() => import("./template-player"));

const RATIO_FILTERS: ReadonlyArray<{ value: "all" | AspectRatio; label: string }> = [
  { value: "all", label: "All" },
  { value: "9:16", label: "9:16" },
  { value: "4:5", label: "4:5" },
  { value: "1:1", label: "1:1" },
  { value: "16:9", label: "16:9" },
];

const RATIO_HINT: Partial<Record<AspectRatio, string>> = { "9:16": "Reels, TikTok, Shorts", "4:5": "Instagram feed", "1:1": "Square posts", "16:9": "YouTube, web" };

/** Gallery state in the URL (?q=…&ratio=9:16&category=promo) so links and back/forward keep it. */
function useGalleryParams() {
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get("q") ?? "");
  const query = useDebouncedValue(text.trim(), 250);
  const ratio = (params.get("ratio") as AspectRatio | null) ?? null;
  const category = (params.get("category") as TemplateCategory | null) ?? null;
  const set = (key: string, value: string | null) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  useEffect(() => {
    if ((params.get("q") ?? "") !== query) set("q", query || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  return {
    text,
    setText,
    query,
    ratio,
    setRatio: (value: AspectRatio | null) => set("ratio", value),
    category,
    setCategory: (value: TemplateCategory | null) => set("category", value),
    /** ?source=yours shows only the workspace's saved templates. */
    source: params.get("source") === "yours" ? ("yours" as const) : ("all" as const),
    setSource: (value: "all" | "yours") => set("source", value === "yours" ? "yours" : null),
    /** ?template=<id> opens that template (links from the landing page, shared links). */
    templateId: params.get("template"),
    clearTemplate: () => set("template", null),
  };
}

export function TemplatesPage() {
  const gallery = useGalleryParams();
  const { templates, categories, yours, loading, refreshing, refetch } = useTemplates({ query: gallery.query, ratio: gallery.ratio, category: gallery.category, source: gallery.source });
  const [open, setOpen] = useState<TemplateSummary | null>(null);
  // Open the template named in the link once the list has it.
  useEffect(() => {
    if (!gallery.templateId || open) return;
    const linked = templates.find((template) => template.id === gallery.templateId);
    if (linked) setOpen(linked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gallery.templateId, templates]);
  const close = () => {
    setOpen(null);
    if (gallery.templateId) gallery.clearTemplate();
  };

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-5 px-4 pb-10 pt-5 sm:px-8 sm:pt-9">
      <header className="flex flex-col gap-1">
        <h1 className="ds-title text-ds-text sm:text-2xl">Templates</h1>
        <p className="text-[13px] text-ds-text-2">Pick one and drop in your photos and words. The motion and music are already done.</p>
      </header>

      <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center">
        <Segmented ariaLabel="Whose templates" className="self-start md:self-auto" value={gallery.source} onChange={gallery.setSource} options={[{ value: "all", label: "All templates" }, { value: "yours", label: yours ? `Yours · ${yours}` : "Yours" }]} />
        <SearchField value={gallery.text} onChange={gallery.setText} label="Search templates" placeholder="Search: launch, travel, quote…" className="md:w-72" />
        <Segmented ariaLabel="Format" className="md:ml-auto" value={gallery.ratio ?? "all"} onChange={(value) => gallery.setRatio(value === "all" ? null : value)} options={RATIO_FILTERS} />
      </div>

      <div className="ds-no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Category">
        <CategoryChip active={!gallery.category} onClick={() => gallery.setCategory(null)} label="All" />
        {categories
          .filter((entry) => entry.count > 0)
          .map((entry) => (
            <CategoryChip key={entry.id} active={gallery.category === entry.id} onClick={() => gallery.setCategory(gallery.category === entry.id ? null : entry.id)} label={entry.label} count={entry.count} />
          ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5" aria-busy="true" aria-label="Loading templates">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="flex flex-col gap-2.5">
              <div className="pc-skeleton aspect-[9/16] w-full rounded-ds-lg" />
              <div className="pc-skeleton h-3.5 w-3/5 rounded-full" />
            </div>
          ))}
        </div>
      ) : templates.length === 0 && gallery.source === "yours" && !gallery.query && !gallery.ratio && !gallery.category ? (
        <p className="rounded-ds-lg border border-dashed border-ds-border px-6 py-12 text-center text-[13px] text-ds-text-2">
          Your workspace hasn't saved any templates yet. In the editor, open the <span className="font-medium text-ds-text">More</span> menu and choose <span className="font-medium text-ds-text">Save as template</span>. Everyone in your workspace can then start from it.
        </p>
      ) : templates.length === 0 ? (
        <p className="rounded-ds-lg border border-dashed border-ds-border px-6 py-12 text-center text-[13px] text-ds-text-2">
          No templates match{gallery.query ? ` “${gallery.query}”` : ""}
          {gallery.ratio ? ` in ${gallery.ratio}` : ""}. Try another word or format.
        </p>
      ) : (
        <div className={cn("grid gap-x-4 gap-y-6 transition-opacity", gallery.ratio === "16:9" ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : gallery.ratio === "1:1" || gallery.ratio === "4:5" ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5", refreshing && "opacity-60")}>
          {templates.map((template) => (
            <TemplateCard key={template.id} template={template} ratio={gallery.ratio && template.ratios.includes(gallery.ratio) ? gallery.ratio : template.ratios.includes("9:16") ? "9:16" : (template.ratios[0] ?? "9:16")} onOpen={() => setOpen(template)} />
          ))}
        </div>
      )}

      <TemplateDialog template={open} initialRatio={gallery.ratio} onClose={close} onRemoved={() => (close(), void refetch())} />
    </div>
  );
}

function CategoryChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn("pc-press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ds-accent", active ? "bg-ds-text text-ds-bg" : "bg-ds-surface text-ds-text-2 shadow-[inset_0_0_0_1px_var(--ds-hairline)] hover:text-ds-text")}
    >
      {label}
      {count !== undefined ? <span className={cn("text-[11px] tabular", active ? "opacity-70" : "text-ds-text-3")}>{count}</span> : null}
    </button>
  );
}

function TemplateCard({ template, ratio, onOpen }: { template: TemplateSummary; ratio: AspectRatio; onOpen: () => void }) {
  const composition = useTemplatePreview(template, ratio);
  const [hover, setHover] = useState(false);
  return (
    <button type="button" onClick={onOpen} onPointerEnter={(event) => event.pointerType === "mouse" && setHover(true)} onPointerLeave={() => setHover(false)} className="group flex min-w-0 flex-col gap-2.5 text-left outline-none">
      {/* The card takes the preview's own shape, so nothing is letterboxed. */}
      <div className="pc-press relative w-full overflow-hidden rounded-ds-lg bg-ds-stage shadow-[0_0_0_1px_var(--ds-hairline)] group-focus-visible:ring-2 group-focus-visible:ring-ds-accent" style={{ aspectRatio: ratio.replace(":", " / ") }}>
        {hover && composition ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-full max-w-full" style={{ aspectRatio: `${composition.width} / ${composition.height}` }}>
              <Suspense fallback={null}>
                <TemplatePlayer composition={composition} assetUrls={template.assetUrls} />
              </Suspense>
            </div>
          </div>
        ) : (
          <VideoThumb composition={composition ?? undefined} assetUrls={template.assetUrls ?? {}} ratio={ratio} className="absolute inset-0" />
        )}
        <span className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[11px] tabular text-white backdrop-blur">{formatDuration(template.durationMs)}</span>
        {template.musicUrl ? (
          <span className="pointer-events-none absolute left-2 top-2 flex size-6 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur" title="Comes with music">
            <IconMusic className="size-3.5" />
          </span>
        ) : null}
        {template.tier === "pro" ? <ProBadge className="pointer-events-none absolute right-2 top-2" /> : null}
      </div>
      <div className="min-w-0">
        <p className="truncate text-[14px] font-semibold text-ds-text">{template.name}</p>
        <p className="mt-0.5 truncate text-[12px] text-ds-text-3">
          {template.source === "workspace" ? "Yours · " : ""}
          {template.categoryLabel} · {template.ratios.join(" · ")}
        </p>
      </div>
    </button>
  );
}

function TemplateDialog({ template, initialRatio, onClose, onRemoved }: { template: TemplateSummary | null; initialRatio: AspectRatio | null; onClose: () => void; onRemoved: () => void }) {
  const [removing, setRemoving] = useState(false);
  const [ratio, setRatio] = useState<AspectRatio | null>(null);
  const [text, setText] = useState<Record<string, string>>({});
  const [brief, setBrief] = useState("");
  const [muted, setMuted] = useState(true);
  const playerRef = useRef<PlayerRef>(null);
  const { pending, start } = useStartFromTemplate();
  useEffect(() => {
    if (!template) return;
    setRatio(initialRatio && template.ratios.includes(initialRatio) ? initialRatio : (template.ratios[0] ?? null));
    setText({});
    setBrief("");
    setMuted(true);
  }, [template, initialRatio]);
  const settledText = useDebouncedValue(text, 300);
  const composition = useTemplatePreview(template, ratio, Object.fromEntries(Object.entries(settledText).filter(([, value]) => value.trim())));
  if (!template) return null;
  const textSlots = template.slots.filter((slot) => slot.kind === "text");
  const credits = (ratio ? template.previews[ratio]?.credits : undefined) ?? [];
  const use = () => ratio && void start({ templateId: template.id, ratio, values: Object.fromEntries(Object.entries(text).filter(([, value]) => value.trim())) }).then((ok) => ok && onClose());
  const withAgent = () => {
    if (!ratio || brief.trim().length < 3) return;
    askAgent(
      `Make a video from the "${template.name}" template (${template.id}) in ${ratio}: ${brief.trim()}. Write fresh copy for every text slot that fits its length, keep the template's photos unless I give you mine, start it with use-template, then open it in the editor.`,
      { templateId: template.id, ratio },
    );
    onClose();
  };

  return (
    <Dialog open={Boolean(template)} onOpenChange={(open) => !open && onClose()} title={template.name} description={template.description} className="w-[min(960px,calc(100vw-32px))] max-h-[min(860px,92dvh)]"
      footer={
        <>
          {template.canDelete ? (
            <Button
              variant="ghost"
              className="mr-auto text-ds-danger hover:text-ds-danger"
              disabled={removing}
              onClick={async () => {
                if (!window.confirm(`Remove “${template.name}” from your templates? Videos already made from it keep everything.`)) return;
                setRemoving(true);
                try {
                  await callAction("delete-template" as never, { templateId: template.id } as never);
                  toast.success(`Removed “${template.name}”`);
                  onRemoved();
                } catch (error) {
                  toast.error(errorMessage(error));
                } finally {
                  setRemoving(false);
                }
              }}
            >
              <IconTrash className="size-4" /> {removing ? "Removing…" : "Remove"}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={use} disabled={pending || !ratio} className="pc-press">
            <IconTemplate className="size-4" /> {pending ? "Setting it up…" : "Use template"}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_320px]">
        {/* Side-by-side, the preview stays put while the form scrolls past it. */}
        <div className="relative flex h-[min(56dvh,560px)] items-center justify-center overflow-hidden rounded-ds-lg bg-ds-stage md:sticky md:top-0 md:self-start">
          {composition ? (
            <div className="h-full max-w-full" style={{ aspectRatio: `${composition.width} / ${composition.height}` }}>
              <Suspense fallback={<div className="pc-skeleton h-full w-full" />}>
                <TemplatePlayer key={`${template.id}-${ratio}`} composition={composition} muted={muted} playerRef={playerRef} assetUrls={template.assetUrls} />
              </Suspense>
            </div>
          ) : null}
          {template.musicUrl ? (
            <button
              type="button"
              onClick={(event) => {
                const player = playerRef.current;
                // Browsers only allow sound that starts inside a click, so unmute and (re)start playback right here.
                if (muted) {
                  player?.unmute();
                  player?.pause();
                  player?.play(event);
                } else player?.mute();
                setMuted(!muted);
              }}
              aria-label={muted ? "Play with sound" : "Mute"} className="pc-press absolute bottom-3 right-3 flex h-9 items-center gap-1.5 rounded-full bg-black/60 px-3 text-[12px] font-medium text-white backdrop-blur">
              {muted ? <IconVolumeOff className="size-4" /> : <IconVolume className="size-4" />}
              {muted ? "Sound off" : "Sound on"}
            </button>
          ) : null}
          {pending ? (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-[#0D0D0F]/85 text-white backdrop-blur-sm" role="status">
              <CrewcutMark motion="loop" className="size-14" label="Setting up your video" />
              <p className="text-[13px] font-medium">Setting up your video…</p>
              <p className="-mt-3 text-[12px] text-white/60">Bringing in the photos and music</p>
            </div>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {template.tier === "pro" ? (
            <p className="flex items-start gap-2 rounded-ds-md bg-ds-surface-2 p-3 text-[12px] text-ds-text-2 shadow-[inset_0_0_0_1px_var(--ds-hairline)]">
              <ProBadge className="shrink-0" />
              <span>Free to try and edit. Exporting a video made from it needs Crewcut Pro for your workspace.</span>
            </p>
          ) : null}
          <div className="flex flex-col gap-2">
            <p className="ds-overline text-ds-text-3">Format</p>
            <div className="flex flex-wrap gap-2">
              {template.ratios.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  onClick={() => setRatio(entry)}
                  aria-pressed={ratio === entry}
                  className={cn("pc-press flex flex-col items-start rounded-ds-md px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ds-accent", ratio === entry ? "bg-ds-accent-soft shadow-[inset_0_0_0_1.5px_var(--ds-accent)]" : "bg-ds-surface-2 shadow-[inset_0_0_0_1px_var(--ds-hairline)]")}
                >
                  <span className="font-mono text-[13px] font-medium tabular text-ds-text">{entry}</span>
                  <span className="text-[11px] text-ds-text-3">{RATIO_HINT[entry] ?? ""}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="ds-overline text-ds-text-3">Your words</p>
            {textSlots.map((slot) => (
              <label key={slot.id} className="flex flex-col gap-1">
                <span className="text-[12px] text-ds-text-2">{slot.label}</span>
                <input
                  value={text[slot.id] ?? ""}
                  onChange={(event) => setText((current) => ({ ...current, [slot.id]: event.target.value }))}
                  placeholder={slot.default.replace(/\*/g, "")}
                  maxLength={slot.maxLength}
                  className="h-9 rounded-ds-sm bg-ds-surface-2 px-3 text-sm text-ds-text shadow-[inset_0_0_0_1px_var(--ds-hairline)] outline-none placeholder:text-ds-text-3 focus:shadow-[inset_0_0_0_1.5px_var(--ds-accent)]"
                />
              </label>
            ))}
            {textSlots.length === 0 ? <p className="text-[12px] text-ds-text-3">There are no words to fill in. Swap its photos in the editor.</p> : null}
            <p className="text-[11px] text-ds-text-3">Leave a field empty to keep the sample. Wrap a word in *stars* to colour it. You can swap the photos in the editor.</p>
          </div>

          <div className="flex flex-col gap-2 rounded-ds-md bg-ds-surface-2 p-3 shadow-[inset_0_0_0_1px_var(--ds-hairline)]">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-ds-text">
              <IconSparkles className="size-4 text-ds-accent" /> Or let the agent fill it in
            </p>
            <textarea
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              rows={2}
              placeholder="What's it for? e.g. “Launch of our oat-milk latte, $4.50, this Friday”"
              className="resize-none rounded-ds-sm bg-ds-surface px-3 py-2 text-sm text-ds-text shadow-[inset_0_0_0_1px_var(--ds-hairline)] outline-none placeholder:text-ds-text-3 focus:shadow-[inset_0_0_0_1.5px_var(--ds-accent)]"
            />
            <Button variant="outline" size="sm" className="pc-press self-start" disabled={brief.trim().length < 3} onClick={withAgent}>
              <IconSparkles className="size-4" /> Make it with the agent
            </Button>
          </div>

          {credits.length ? (
            <p className="text-[11px] leading-relaxed text-ds-text-3">
              Photos from{" "}
              <a href="https://www.pexels.com" target="_blank" rel="noreferrer" className="underline">
                Pexels
              </a>
              :{" "}
              {credits.map((credit, index) => (
                <span key={credit.url}>
                  <a href={credit.url} target="_blank" rel="noreferrer" className="hover:underline">
                    {credit.text.replace(/^Photo by | on Pexels$/g, "")}
                  </a>
                  {index < credits.length - 1 ? ", " : ""}
                </span>
              ))}
            </p>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
