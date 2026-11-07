import { IconUpload } from "@tabler/icons-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button, Dialog, InfiniteSentinel, SearchField, Segmented, useDebouncedValue } from "@/components/ds";
import { errorMessage } from "@/lib/crewcut";
import { cn } from "@/lib/utils";

import { replaceLayerMedia } from "./commands";
import { useEditor } from "./editor-store";
import { uploadMedia, useAssets } from "./media";
import { StockBrowser } from "./stock-browser";

/**
 * Pick the photo (or video) that goes into a layer: this video's media and
 * the person's library, searchable, or a fresh upload. Used by the inspector's
 * Replace button; dropping media onto a photo in the preview does the same.
 */
export function ReplaceMediaDialog({ open, onOpenChange, target, kind, slotLabel }: { open: boolean; onOpenChange: (open: boolean) => void; target: { clipId: string; layerId: string }; kind: "image" | "video"; slotLabel?: string | undefined }) {
  const videoId = useEditor((state) => state.videoId);
  const [search, setSearch] = useState("");
  const query = useDebouncedValue(search, 250);
  const { assets, loading, error, hasMore, loadMore, loadingMore, refetch, listKey } = useAssets(videoId, { mediaType: kind, query, pageSize: 30 });
  const [uploading, setUploading] = useState(false);
  // Photos can also come from free stock; videos only from the person's media.
  const [source, setSource] = useState<"yours" | "stock">("yours");
  const showStock = kind === "image" && source === "stock";
  const input = useRef<HTMLInputElement>(null);
  const noun = kind === "image" ? "photo" : "video";

  const choose = async (asset: Parameters<typeof replaceLayerMedia>[1]) => {
    if (await replaceLayerMedia(target, asset)) onOpenChange(false);
  };
  const upload = async (file: File) => {
    setUploading(true);
    try {
      const asset = await uploadMedia(file, { videoId });
      void refetch();
      await choose(asset);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Replace ${noun}`}
      description={slotLabel ? `${slotLabel}: the new ${noun} keeps this spot's size, motion and colour.` : `The new ${noun} keeps this layer's size, motion and colour.`}
      className="w-[min(640px,calc(100vw-32px))]"
      footer={
        <>
          <input ref={input} type="file" accept={kind === "image" ? "image/png,image/jpeg,image/webp,image/gif" : "video/mp4,video/webm,video/quicktime"} className="hidden" onChange={(event) => (event.target.files?.[0] && void upload(event.target.files[0]), (event.target.value = ""))} />
          <Button variant="outline" className="pc-press mr-auto" disabled={uploading} onClick={() => input.current?.click()}>
            <IconUpload className="size-4" /> {uploading ? "Uploading…" : `Upload a ${noun}`}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {kind === "image" ? <Segmented ariaLabel="Photo source" className="self-start" value={source} onChange={setSource} options={[{ value: "yours", label: "Your photos" }, { value: "stock", label: "Free stock photos" }]} /> : null}
        {showStock ? (
          <StockBrowser mode="picker" onPicked={choose} />
        ) : (
        <>
        <SearchField size="sm" value={search} onChange={setSearch} label={`Search ${noun}s`} placeholder={`Search your ${noun}s`} />
        {loading ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="pc-skeleton aspect-square rounded-ds-sm" />
            ))}
          </div>
        ) : assets.length === 0 ? (
          <p className="rounded-ds-md border border-dashed border-ds-border px-4 py-8 text-center text-[13px] text-ds-text-2">{query ? `No ${noun}s match “${query}”.` : `No ${noun}s yet. Upload one, or add some on the Assets page.`}</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {assets.map((asset) => (
              <button key={asset.id} type="button" onClick={() => void choose(asset)} className="pc-press group flex min-w-0 flex-col gap-1 text-left outline-none" title={asset.label}>
                <span className={cn("block aspect-square overflow-hidden rounded-ds-sm bg-ds-surface-2 shadow-[0_0_0_1px_var(--ds-hairline)] group-hover:shadow-[0_0_0_2px_var(--ds-accent)] group-focus-visible:shadow-[0_0_0_2px_var(--ds-accent)]")}>
                  {asset.mediaType === "image" ? <img src={asset.url} alt="" loading="lazy" className="h-full w-full object-cover" /> : <video src={asset.url} muted preload="metadata" className="h-full w-full object-cover" />}
                </span>
                <span className="truncate text-[11px] text-ds-text-2">{asset.label}</span>
              </button>
            ))}
          </div>
        )}
        <InfiniteSentinel hasMore={hasMore} loading={loadingMore} onLoadMore={loadMore} count={assets.length} error={error} resetKey={listKey} />
        </>
        )}
      </div>
    </Dialog>
  );
}
