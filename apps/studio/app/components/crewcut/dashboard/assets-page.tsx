import { appPath } from "@agent-native/core/client/api-path";
import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { keepPreviousData } from "@tanstack/react-query";
import {
  IconCloudUpload,
  IconDots,
  IconDownload,
  IconLoader2,
  IconMusic,
  IconPencil,
  IconPhoto,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconTrash,
  IconUpload,
  IconVideo,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Pagination,
  SearchField,
  Segmented,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ds";
import { useListParams } from "@/hooks/use-list-params";
import { errorMessage, formatBytes } from "@/lib/crewcut";
import { cn } from "@/lib/utils";

import { formatDuration } from "./use-videos";

export interface AssetItem {
  id: string;
  videoId: string | null;
  kind: string;
  mediaType: "image" | "video" | "audio";
  label: string;
  mime: string;
  bytes: number;
  durationMs: number | null;
  url: string;
  source: string;
  createdAt: string;
}

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/ogg,.mp3,.wav,.m4a,.ogg";

/** Reads a media file's duration in the browser (sent along as metadata). */
function probeDuration(file: File): Promise<number | null> {
  if (!file.type.startsWith("audio/") && !file.type.startsWith("video/") && !/\.(mp3|wav|m4a|ogg|mp4|webm)$/i.test(file.name)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const element = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    element.preload = "metadata";
    element.onloadedmetadata = () => done(Number.isFinite(element.duration) ? Math.round(element.duration * 1000) : null);
    element.onerror = () => done(null);
    window.setTimeout(() => done(null), 8000);
    element.src = url;
  });
}

async function uploadToLibrary(file: File): Promise<void> {
  const durationMs = await probeDuration(file);
  const params = new URLSearchParams({ label: file.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 120) });
  if (durationMs) params.set("durationMs", String(durationMs));
  if (file.type.startsWith("audio/")) params.set("role", "audio");
  const response = await fetch(appPath(`/api/assets?${params.toString()}`), { method: "POST", body: file, credentials: "include" });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Upload failed (${response.status})`);
  }
}

type Tab = "media" | "audio";
type Scope = "all" | "library";

const PAGE_SIZE = 40;

interface AssetPage {
  assets: AssetItem[];
  total: number;
  counts: { image: number; video: number; audio: number };
}

export function AssetsPage() {
  // Tab, search, scope and page live in the URL (?filter=audio&sort=library&q=…&page=2).
  const list = useListParams<Tab, Scope>({ filter: "media", sort: "all" });
  const tab = list.filter;
  const setTab = list.setFilter;
  const scope = list.sort;
  const setScope = list.setSort;
  const [uploading, setUploading] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const query = useActionQuery(
    "list-assets",
    { scope, mediaType: tab === "media" ? "visual" : "audio", ...(list.query ? { query: list.query } : {}), limit: PAGE_SIZE, offset: (list.page - 1) * PAGE_SIZE } as never,
    { placeholderData: keepPreviousData } as never,
  );
  const data = query.data as AssetPage | undefined;
  const shown = data?.assets ?? [];
  const counts = data?.counts ?? { image: 0, video: 0, audio: 0 };
  const total = data?.total ?? 0;
  const refreshing = query.isFetching && query.isPlaceholderData;
  const searching = Boolean(list.query);
  useEffect(() => {
    if (!query.isLoading && !refreshing) list.clampPage(total, PAGE_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.isLoading, refreshing, total, list.page]);

  async function handleFiles(files: FileList | File[]) {
    const list = [...files];
    if (list.length === 0) return;
    setUploading((current) => [...current, ...list.map((file) => file.name)]);
    let ok = 0;
    for (const file of list) {
      try {
        await uploadToLibrary(file);
        ok += 1;
        if (file.type.startsWith("audio/")) setTab("audio");
      } catch (error) {
        toast.error(`${file.name}: ${errorMessage(error)}`);
      } finally {
        setUploading((current) => {
          const index = current.indexOf(file.name);
          return index === -1 ? current : [...current.slice(0, index), ...current.slice(index + 1)];
        });
      }
    }
    if (ok > 0) {
      toast.success(`Uploaded ${ok} file${ok === 1 ? "" : "s"} to your library`);
      void query.refetch();
    }
  }

  return (
    <div
      className="relative mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-5 px-4 pb-10 pt-5 sm:px-8 sm:pt-9"
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        void handleFiles(event.dataTransfer.files);
      }}
    >
      <header className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="ds-title text-ds-text sm:text-2xl">Assets</h1>
          <p className="mt-0.5 text-[13px] text-ds-text-2">Images, video and audio you can drop into any project.</p>
        </div>
        <Button onClick={() => inputRef.current?.click()} className="pc-press shrink-0">
          <IconUpload className="size-4" />
          Upload
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            if (event.target.files) void handleFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </header>

      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="min-w-0">
          <TabsList className="px-0">
            <TabsTrigger value="media">
              <IconPhoto /> Media <span className="rounded-full bg-ds-surface-3 px-1.5 text-[10px] tabular text-ds-text-2">{counts.image + counts.video}</span>
            </TabsTrigger>
            <TabsTrigger value="audio">
              <IconMusic /> Audio <span className="rounded-full bg-ds-surface-3 px-1.5 text-[10px] tabular text-ds-text-2">{counts.audio}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <SearchField value={list.text} onChange={list.setText} label="Search assets" placeholder={tab === "media" ? "Search images and videos" : "Search audio"} className="w-full sm:ml-auto sm:w-60" />
        <Segmented
          ariaLabel="Which assets"
          value={scope}
          onChange={setScope}
          options={[
            { value: "all", label: "Everything" },
            { value: "library", label: "My library" },
          ]}
        />
      </div>

      {uploading.length > 0 ? (
        <div className="ds-card flex items-center gap-3 px-4 py-3 text-[13px] text-ds-text-2" role="status">
          <IconLoader2 className="size-4 shrink-0 text-ds-accent motion-safe:animate-spin" />
          <span className="min-w-0 truncate">
            Uploading {uploading.length} file{uploading.length === 1 ? "" : "s"}: {uploading.join(", ")}
          </span>
        </div>
      ) : null}

      {query.isLoading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" aria-busy="true" aria-label="Loading assets">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="pc-skeleton aspect-[4/3] rounded-ds-md" />
          ))}
        </div>
      ) : shown.length === 0 && searching ? (
        <p className="rounded-ds-lg border border-dashed border-ds-border px-6 py-12 text-center text-[13px] text-ds-text-2">No {tab === "media" ? "images or videos" : "audio"} match “{list.query}”.</p>
      ) : shown.length === 0 ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="pc-press flex flex-col items-center gap-3 rounded-ds-lg border border-dashed border-ds-border px-6 py-14 text-center outline-none hover:bg-ds-surface focus-visible:ring-2 focus-visible:ring-ds-accent"
        >
          <IconCloudUpload className="size-8 text-ds-text-3" strokeWidth={1.5} />
          <span className="ds-heading text-ds-text">{tab === "media" ? "No images or videos yet" : "No audio yet"}</span>
          <span className="max-w-sm text-[13px] text-ds-text-2">
            Drop files anywhere on this page or click to choose. {tab === "media" ? "PNG, JPEG, WebP, GIF, MP4 or WebM" : "MP3, WAV, M4A or OGG"} up to 100 MB. Only upload media you have the rights to use.
          </span>
        </button>
      ) : tab === "media" ? (
        <div className={cn("grid grid-cols-2 gap-4 transition-opacity sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5", refreshing && "opacity-60")}>
          {shown.map((asset) => (
            <AssetActions key={asset.id} asset={asset} onChanged={() => void query.refetch()}>
              {(menu) => <MediaTile asset={asset} menu={menu} />}
            </AssetActions>
          ))}
        </div>
      ) : (
        <div className={cn("transition-opacity", refreshing && "opacity-60")}>
          <AudioList assets={shown} onChanged={() => void query.refetch()} />
        </div>
      )}
      {!query.isLoading && shown.length > 0 ? <Pagination page={list.page} pageSize={PAGE_SIZE} total={total} onPageChange={list.setPage} noun={tab === "media" ? "images and videos" : "audio files"} /> : null}

      {dragging ? (
        <div className="pointer-events-none fixed inset-0 z-[120] flex items-center justify-center bg-[var(--ds-scrim)] p-6" aria-hidden>
          <div className="flex flex-col items-center gap-3 rounded-ds-xl border-2 border-dashed border-white/70 px-10 py-12 text-white">
            <IconCloudUpload className="size-10" strokeWidth={1.5} />
            <p className="ds-title">Drop to upload to your library</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function assetMeta(asset: AssetItem): string {
  return [asset.mime.split("/")[1]?.toUpperCase(), formatDuration(asset.durationMs ?? undefined), formatBytes(asset.bytes)].filter(Boolean).join(" · ");
}

function MediaTile({ asset, menu }: { asset: AssetItem; menu: React.ReactNode }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  return (
    <figure className="group flex min-w-0 flex-col gap-2">
      <div
        className="ds-checker relative aspect-[4/3] overflow-hidden rounded-ds-md shadow-[0_0_0_1px_var(--ds-hairline)]"
        onPointerEnter={() => void videoRef.current?.play().catch(() => undefined)}
        onPointerLeave={() => {
          const video = videoRef.current;
          if (!video) return;
          video.pause();
          video.currentTime = 0;
        }}
      >
        {asset.mediaType === "image" ? (
          <img src={asset.url} alt={asset.label} loading="lazy" className="size-full object-cover" draggable={false} />
        ) : (
          <video ref={videoRef} src={`${asset.url}#t=0.1`} muted playsInline loop preload="metadata" className="size-full object-cover" />
        )}
        <span className="absolute left-2 top-2 flex size-6 items-center justify-center rounded-[6px] bg-black/60 text-white [&_svg]:size-3.5">{asset.mediaType === "image" ? <IconPhoto /> : <IconVideo />}</span>
        {asset.durationMs ? <span className="absolute bottom-2 right-2 rounded-[6px] bg-black/70 px-1.5 py-0.5 font-mono text-[10px] tabular text-white">{formatDuration(asset.durationMs)}</span> : null}
      </div>
      <figcaption className="flex min-w-0 items-start gap-1">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ds-text" title={asset.label}>
            {asset.label}
          </span>
          <span className="block truncate text-[11px] text-ds-text-3 tabular">
            {assetMeta(asset)} · {asset.videoId ? "In a project" : "Library"}
          </span>
        </span>
        {menu}
      </figcaption>
    </figure>
  );
}

function AudioList({ assets, onChanged }: { assets: AssetItem[]; onChanged: () => void }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => () => audioRef.current?.pause(), []);
  const toggle = (asset: AssetItem) => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.onended = () => setPlaying(null);
    }
    const element = audioRef.current;
    if (playing === asset.id) {
      element.pause();
      setPlaying(null);
      return;
    }
    element.src = asset.url;
    void element.play().then(
      () => setPlaying(asset.id),
      () => toast.error("This file can't play in the browser."),
    );
  };
  return (
    <div role="list" className="ds-card flex flex-col divide-y divide-ds-border overflow-hidden">
      {assets.map((asset) => (
        <AssetActions key={asset.id} asset={asset} onChanged={onChanged}>
          {(menu) => (
            <div role="listitem" className="flex min-w-0 items-center gap-3 px-3 py-2.5 sm:px-4">
              <button
                type="button"
                onClick={() => toggle(asset)}
                aria-label={playing === asset.id ? `Pause ${asset.label}` : `Play ${asset.label}`}
                className={cn(
                  "pc-press pc-touch-target flex size-10 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ds-accent [&_svg]:size-4",
                  playing === asset.id ? "bg-ds-accent text-ds-on-accent" : "bg-ds-surface-2 text-ds-text shadow-[inset_0_0_0_1px_var(--ds-hairline)] hover:bg-ds-surface-3",
                )}
              >
                {playing === asset.id ? <IconPlayerPauseFilled /> : <IconPlayerPlayFilled />}
              </button>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ds-text">{asset.label}</span>
                <span className="block truncate text-[11px] text-ds-text-3 tabular">
                  {assetMeta(asset)} · {asset.kind === "audio" ? "Audio" : asset.kind} · {asset.videoId ? "In a project" : "Library"}
                </span>
              </span>
              {menu}
            </div>
          )}
        </AssetActions>
      ))}
    </div>
  );
}

/** Rename / download / delete for one asset, as a ⋯ menu and a right-click menu. */
function AssetActions({ asset, onChanged, children }: { asset: AssetItem; onChanged: () => void; children: (menu: React.ReactNode) => React.ReactNode }) {
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [label, setLabel] = useState(asset.label);
  const rename = useActionMutation("rename-asset");
  const remove = useActionMutation("delete-asset");
  useEffect(() => {
    if (renaming) setLabel(asset.label);
  }, [renaming, asset.label]);

  const items = useMemo(
    () =>
      (kind: "context" | "dropdown") => {
        const Item = kind === "context" ? ContextMenuItem : DropdownMenuItem;
        const Separator = kind === "context" ? ContextMenuSeparator : DropdownMenuSeparator;
        return (
          <>
            <Item icon={<IconPencil />} onSelect={() => setRenaming(true)}>
              Rename
            </Item>
            <Item icon={<IconDownload />} onSelect={() => window.open(asset.url, "_blank", "noopener")}>
              Open original
            </Item>
            <Separator />
            <Item icon={<IconTrash />} danger onSelect={() => setDeleting(true)}>
              Delete
            </Item>
          </>
        );
      },
    [asset.url],
  );

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={`Options for ${asset.label}`} tooltip={false} size="sm">
          <IconDots />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{items("dropdown")}</DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="min-w-0">{children(menu)}</div>
        </ContextMenuTrigger>
        <ContextMenuContent>{items("context")}</ContextMenuContent>
      </ContextMenu>
      <Dialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename asset"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
            <Button type="submit" form={`rename-asset-${asset.id}`} disabled={!label.trim() || rename.isPending}>
              Save
            </Button>
          </>
        }
      >
        <form
          id={`rename-asset-${asset.id}`}
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await rename.mutateAsync({ assetId: asset.id, label: label.trim() } as never);
              setRenaming(false);
              onChanged();
            } catch (error) {
              toast.error(errorMessage(error));
            }
          }}
        >
          <input
            autoFocus
            aria-label="Asset name"
            value={label}
            maxLength={120}
            onChange={(event) => setLabel(event.target.value)}
            className="h-10 w-full rounded-ds-sm bg-ds-surface-2 px-3 text-sm text-ds-text shadow-[inset_0_0_0_1px_var(--ds-hairline)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--ds-accent)]"
          />
        </form>
      </Dialog>
      <Dialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete “${asset.label}”?`}
        description="The file is removed from storage. Projects that still use it must drop it from their timeline first."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={async () => {
                try {
                  await remove.mutateAsync({ assetId: asset.id } as never);
                  setDeleting(false);
                  onChanged();
                  toast.success(`Deleted “${asset.label}”`);
                } catch (error) {
                  setDeleting(false);
                  toast.error(errorMessage(error));
                }
              }}
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ds-text-2">{assetMeta(asset)}</p>
      </Dialog>
    </>
  );
}
