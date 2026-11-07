import { IconDownload, IconExternalLink, IconLoader2, IconPhoto, IconPhotoSearch, IconPlus } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, EmptyState, InfiniteSentinel, SearchField, Segmented, useDebouncedValue } from "@/components/ds";
import { errorMessage } from "@/lib/crewcut";
import { cn } from "@/lib/utils";

import { addStockAt, importStockPhoto } from "./commands";
import { type StockOrientation, type StockPhotoDto, endDrag, startDrag, useStockPhotos } from "./media";

/**
 * Free stock photos (Pexels) inside the editor. In the media panel a photo is
 * dragged or added like any other photo; in the Replace dialog a click picks
 * it. Either way it is saved into the video's media with the photographer's
 * credit, which the Proof report lists.
 */

type ShapeFilter = "any" | StockOrientation;

const SHAPES: ReadonlyArray<{ value: ShapeFilter; label: string }> = [
  { value: "any", label: "Any" },
  { value: "portrait", label: "Tall" },
  { value: "landscape", label: "Wide" },
  { value: "square", label: "Square" },
];

export function PexelsCredit({ className }: { className?: string }) {
  return (
    <p className={cn("text-[11px] text-ds-text-3", className)}>
      Free photos from{" "}
      <a href="https://www.pexels.com" target="_blank" rel="noreferrer" className="font-medium text-ds-text-2 underline-offset-2 hover:text-ds-text hover:underline">
        Pexels
      </a>
      , credited to each photographer in the Proof report.
    </p>
  );
}

function StockTile({ photo, mode, busy, onPick, onOverlay, onImport }: { photo: StockPhotoDto; mode: "panel" | "picker"; busy: boolean; onPick: (photo: StockPhotoDto) => void; onOverlay: (photo: StockPhotoDto) => void; onImport: (photo: StockPhotoDto) => void }) {
  const label = photo.alt || `Photo by ${photo.photographer}`;
  const tile = (
    <div
      className="group flex min-w-0 flex-col gap-1 [contain-intrinsic-size:auto_120px] [content-visibility:auto]"
      {...(mode === "panel"
        ? {
            draggable: !busy,
            onDragStart: (event: React.DragEvent) => startDrag(event, { type: "stock", photo, label }),
            onDragEnd: () => endDrag(),
          }
        : {})}
    >
      <div
        role="button"
        tabIndex={0}
        aria-busy={busy}
        aria-label={mode === "panel" ? `${label}, by ${photo.photographer}. Drag to the timeline, double-click or press + to add.` : `Use ${label}, by ${photo.photographer}`}
        title={`${label} · ${photo.photographer}`}
        onClick={mode === "picker" ? () => !busy && onPick(photo) : undefined}
        onDoubleClick={mode === "panel" ? () => !busy && onPick(photo) : undefined}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && !busy) {
            event.preventDefault();
            onPick(photo);
          }
        }}
        className={cn(
          "relative w-full overflow-hidden rounded-ds-sm outline-none focus-visible:ring-2 focus-visible:ring-ds-accent",
          mode === "panel" ? "aspect-[4/3] cursor-grab" : "pc-press aspect-square cursor-pointer shadow-[0_0_0_1px_var(--ds-hairline)] hover:shadow-[0_0_0_2px_var(--ds-accent)]",
        )}
        style={{ backgroundColor: photo.avgColor }}
      >
        <img src={photo.thumbUrl} alt="" loading="lazy" draggable={false} className="size-full object-cover" />
        <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-4 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100">
          {photo.photographer}
        </span>
        {busy ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white">
            <IconLoader2 className="size-5 animate-spin" aria-hidden />
          </span>
        ) : mode === "panel" ? (
          <button
            type="button"
            aria-label={`Add ${label} at the playhead`}
            title="Add at the playhead"
            onClick={(event) => {
              event.stopPropagation();
              onPick(photo);
            }}
            className="pc-press absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-full bg-ds-accent text-ds-on-accent opacity-0 shadow-md transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100"
          >
            <IconPlus className="size-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
  if (mode === "picker") return tile;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{tile}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem icon={<IconPlus />} disabled={busy} onSelect={() => onPick(photo)}>
          Add at playhead
        </ContextMenuItem>
        <ContextMenuItem icon={<IconPhoto />} disabled={busy} onSelect={() => onOverlay(photo)}>
          Add as overlay
        </ContextMenuItem>
        <ContextMenuItem icon={<IconDownload />} disabled={busy} onSelect={() => onImport(photo)}>
          Save to this video's media
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem icon={<IconExternalLink />} onSelect={() => window.open(photo.pageUrl, "_blank", "noopener,noreferrer")}>
          View on Pexels
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * Search box, shape filter and results. `panel` adds photos to the timeline;
 * `picker` hands the chosen photo (already saved to the video's media) to onPicked.
 */
export function StockBrowser({
  mode,
  onPicked,
  className,
  bodyClassName,
  initialShape = "any",
}: {
  mode: "panel" | "picker";
  onPicked?: (asset: Awaited<ReturnType<typeof importStockPhoto>>) => void | Promise<void>;
  className?: string;
  /** Classes for the results area (the panel makes it the scrolling part, so the search box stays put). */
  bodyClassName?: string;
  initialShape?: ShapeFilter;
}) {
  const [search, setSearch] = useState("");
  const [shape, setShape] = useState<ShapeFilter>(initialShape);
  const query = useDebouncedValue(search, 400).trim();
  const stock = useStockPhotos({ query, orientation: shape === "any" ? undefined : shape });
  const [busy, setBusy] = useState<ReadonlySet<number>>(new Set());
  // A new search starts at the top (otherwise the list stays scrolled down and loads pages nobody asked for).
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (body.current) body.current.scrollTop = 0;
  }, [stock.listKey]);
  const queryClient = useQueryClient();

  const track = async (photo: StockPhotoDto, work: () => Promise<unknown>) => {
    setBusy((current) => new Set(current).add(photo.id));
    try {
      await work();
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(photo.id);
        return next;
      });
      // The photo is now in the video's media: refresh the media lists.
      void queryClient.invalidateQueries({ queryKey: ["action", "list-assets"] });
    }
  };

  const pick = (photo: StockPhotoDto) =>
    void track(photo, async () => {
      if (mode === "panel") {
        await addStockAt(photo);
        return;
      }
      try {
        const asset = await importStockPhoto(photo);
        await onPicked?.(asset);
      } catch (error) {
        toast.error(errorMessage(error));
      }
    });

  const overlay = (photo: StockPhotoDto) => void track(photo, () => addStockAt(photo, undefined, { mode: "overlay" }));

  const saveOnly = (photo: StockPhotoDto) =>
    void track(photo, async () => {
      try {
        const asset = await importStockPhoto(photo);
        toast.success(`Saved “${asset.label}” to this video's media`);
      } catch (error) {
        toast.error(errorMessage(error));
      }
    });

  const errorText = stock.error ? errorMessage(stock.error) : null;

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className={cn("flex shrink-0 flex-col gap-2 pb-2", mode === "panel" && "px-3")}>
        <SearchField size="sm" value={search} onChange={setSearch} label="Search free stock photos" placeholder="Search free photos, e.g. sunset, coffee" />
        {query ? <Segmented size="sm" ariaLabel="Photo shape" className="w-full" value={shape} onChange={setShape} options={SHAPES} /> : null}
      </div>
      <div ref={body} className={cn("flex flex-col", bodyClassName)}>
      {!stock.enabled ? (
        <EmptyState icon={<IconPhotoSearch className="size-6" />} title="Stock photos aren't available">
          They haven't been switched on for this Crewcut server yet. You can still upload your own photos.
        </EmptyState>
      ) : errorText && stock.photos.length === 0 ? (
        <EmptyState icon={<IconPhotoSearch className="size-6" />} title="Couldn't load photos">
          {errorText}
        </EmptyState>
      ) : stock.loading ? (
        <div className={cn("grid gap-2", mode === "panel" ? "grid-cols-2" : "grid-cols-3 sm:grid-cols-4")}>
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className={cn("pc-skeleton rounded-ds-sm", mode === "panel" ? "aspect-[4/3]" : "aspect-square")} />
          ))}
        </div>
      ) : stock.photos.length === 0 ? (
        <p className="rounded-ds-md border border-dashed border-ds-border px-4 py-8 text-center text-[13px] text-ds-text-2">No photos match “{query}”. Try fewer or simpler words.</p>
      ) : (
        <>
          <h3 className="ds-overline pb-1.5 text-ds-text-3">{query ? `${stock.total.toLocaleString()} photos` : "Popular right now"}</h3>
          <div className={cn("grid gap-x-2 gap-y-2 transition-opacity", mode === "panel" ? "grid-cols-2" : "grid-cols-3 sm:grid-cols-4", stock.searching && "opacity-60")}>
            {stock.photos.map((photo) => (
              <StockTile key={photo.id} photo={photo} mode={mode} busy={busy.has(photo.id)} onPick={pick} onOverlay={overlay} onImport={saveOnly} />
            ))}
          </div>
          <InfiniteSentinel hasMore={stock.hasMore} loading={stock.loadingMore} onLoadMore={stock.loadMore} count={stock.photos.length} error={stock.error} resetKey={stock.listKey} className="mt-2" />
          {errorText ? <p className="mt-1 text-center text-[11px] text-ds-danger">{errorText}</p> : null}
        </>
      )}
      <PexelsCredit className="pt-3" />
      </div>
    </div>
  );
}
