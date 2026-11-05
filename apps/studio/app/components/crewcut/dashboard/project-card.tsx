import { useActionMutation } from "@agent-native/core/client/hooks";
import {
  IconDots,
  IconEdit,
  IconFileCertificate,
  IconLayoutKanban,
  IconMovie,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
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
} from "@/components/ds";
import { errorMessage, formatAgo } from "@/lib/crewcut";
import { cn } from "@/lib/utils";

import { STATUS_TONE_CLASS, type VideoSummary, formatDuration, primaryPath, videoStatus } from "./use-videos";
import { VideoThumb } from "./video-thumb";

type MenuKind = "context" | "dropdown";

/** The same project actions for right-click and the ⋯ button. */
function ProjectMenuItems({ kind, video, onRename, onDelete }: { kind: MenuKind; video: VideoSummary; onRename: () => void; onDelete: () => void }) {
  const navigate = useNavigate();
  const Item = kind === "context" ? ContextMenuItem : DropdownMenuItem;
  const Separator = kind === "context" ? ContextMenuSeparator : DropdownMenuSeparator;
  return (
    <>
      <Item icon={<IconEdit />} disabled={!video.hasComposition} onSelect={() => navigate(`/videos/${video.id}/edit`)}>
        Open editor
      </Item>
      <Item icon={<IconLayoutKanban />} onSelect={() => navigate(`/videos/${video.id}`)}>
        Open pipeline
      </Item>
      <Item icon={<IconFileCertificate />} onSelect={() => navigate(`/videos/${video.id}/proof`)}>
        Proof report
      </Item>
      <Separator />
      <Item icon={<IconPencil />} onSelect={onRename}>
        Rename
      </Item>
      <Item icon={<IconTrash />} danger onSelect={onDelete}>
        Delete
      </Item>
    </>
  );
}

/** Rename + delete dialogs for one project; render once per card. */
function useProjectDialogs(video: VideoSummary) {
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [title, setTitle] = useState(video.title);
  const rename = useActionMutation("rename-video");
  const remove = useActionMutation("delete-video", { uiOnly: true });
  useEffect(() => {
    if (renaming) setTitle(video.title);
  }, [renaming, video.title]);

  const dialogs = (
    <>
      <Dialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename project"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
            <Button type="submit" form={`rename-${video.id}`} disabled={!title.trim() || rename.isPending}>
              {rename.isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <form
          id={`rename-${video.id}`}
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await rename.mutateAsync({ videoId: video.id, title: title.trim() } as never);
              setRenaming(false);
            } catch (error) {
              toast.error(errorMessage(error));
            }
          }}
        >
          <input
            autoFocus
            aria-label="Project name"
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            className="h-10 w-full rounded-ds-sm bg-ds-surface-2 px-3 text-sm text-ds-text shadow-[inset_0_0_0_1px_var(--ds-hairline)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--ds-accent)]"
          />
        </form>
      </Dialog>
      <Dialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete “${video.title}”?`}
        description="This removes every edit, script, report, upload and export of this project. It can't be undone."
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
                  await remove.mutateAsync({ videoId: video.id } as never);
                  toast.success(`Deleted “${video.title}”`);
                  setDeleting(false);
                } catch (error) {
                  toast.error(errorMessage(error));
                }
              }}
            >
              {remove.isPending ? "Deleting…" : "Delete project"}
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ds-text-2">Published posts on connected platforms are not affected.</p>
      </Dialog>
    </>
  );
  return { dialogs, openRename: () => setRenaming(true), openDelete: () => setDeleting(true) };
}

function StatusChip({ video }: { video: VideoSummary }) {
  const status = videoStatus(video);
  return <span className={cn("inline-flex h-5 max-w-full items-center truncate rounded-full px-2 text-[11px] font-medium", STATUS_TONE_CLASS[status.tone])}>{status.label}</span>;
}

function metaLine(video: VideoSummary): string {
  return [video.ratio, formatDuration(video.durationMs), formatAgo(video.updatedAt)].filter(Boolean).join(" · ");
}

function MoreButton({ video, onRename, onDelete, className }: { video: VideoSummary; onRename: () => void; onDelete: () => void; className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={`Options for ${video.title}`} tooltip={false} size="md" className={className}>
          <IconDots />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <ProjectMenuItems kind="dropdown" video={video} onRename={onRename} onDelete={onDelete} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProjectCard({ video, assetUrls }: { video: VideoSummary; assetUrls: Record<string, string> }) {
  const { dialogs, openRename, openDelete } = useProjectDialogs(video);
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <article className="group relative flex min-w-0 flex-col gap-2.5">
            <Link
              to={primaryPath(video)}
              className="pc-press relative block overflow-hidden rounded-ds-lg shadow-[0_0_0_1px_var(--ds-hairline)] outline-none focus-visible:ring-2 focus-visible:ring-ds-accent"
              aria-label={`Open ${video.title}`}
            >
              <VideoThumb composition={video.composition} assetUrls={assetUrls} ratio={video.ratio} className="aspect-[16/10] w-full" />
              {video.durationMs ? (
                <span className="absolute bottom-2 right-2 rounded-[6px] bg-black/70 px-1.5 py-0.5 font-mono text-[10px] tabular text-white">{formatDuration(video.durationMs)}</span>
              ) : null}
              {video.isDemo ? <span className="absolute left-2 top-2 rounded-[6px] bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">Sample</span> : null}
            </Link>
            <div className="flex min-w-0 items-start gap-2">
              <div className="min-w-0 flex-1">
                <Link to={primaryPath(video)} className="block truncate text-[14px] font-medium text-ds-text outline-none hover:underline focus-visible:underline" title={video.title}>
                  {video.title}
                </Link>
                <p className="mt-0.5 truncate text-xs text-ds-text-3 tabular">{metaLine(video)}</p>
                <div className="mt-2">
                  <StatusChip video={video} />
                </div>
              </div>
              <MoreButton video={video} onRename={openRename} onDelete={openDelete} className="-mr-1 -mt-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 sm:data-[state=open]:opacity-100" />
            </div>
          </article>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ProjectMenuItems kind="context" video={video} onRename={openRename} onDelete={openDelete} />
        </ContextMenuContent>
      </ContextMenu>
      {dialogs}
    </>
  );
}

/** Compact list row for phones (image 3 "Recent projects"). */
export function ProjectRow({ video, assetUrls }: { video: VideoSummary; assetUrls: Record<string, string> }) {
  const { dialogs, openRename, openDelete } = useProjectDialogs(video);
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="flex min-w-0 items-center gap-3 py-2">
            <Link to={primaryPath(video)} className="pc-press flex min-w-0 flex-1 items-center gap-3 rounded-ds-md outline-none focus-visible:ring-2 focus-visible:ring-ds-accent">
              <VideoThumb composition={video.composition} assetUrls={assetUrls} ratio={video.ratio} className="h-16 w-[88px] shrink-0 rounded-ds-sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-ds-text">{video.title}</span>
                <span className="mt-0.5 block truncate text-xs text-ds-text-3 tabular">{metaLine(video)}</span>
                <span className="mt-1.5 block">
                  <StatusChip video={video} />
                </span>
              </span>
            </Link>
            <MoreButton video={video} onRename={openRename} onDelete={openDelete} />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ProjectMenuItems kind="context" video={video} onRename={openRename} onDelete={openDelete} />
        </ContextMenuContent>
      </ContextMenu>
      {dialogs}
    </>
  );
}

export function ProjectGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-x-5 gap-y-7 min-[480px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" aria-busy="true" aria-label="Loading projects">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex flex-col gap-2.5">
          <div className="pc-skeleton aspect-[16/10] w-full rounded-ds-lg" />
          <div className="pc-skeleton h-4 w-3/4" />
          <div className="pc-skeleton h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function EmptyProjects({ onCreate, children }: { onCreate: () => void; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-ds-lg border border-dashed border-ds-border px-6 py-12 text-center">
      <IconMovie className="size-7 text-ds-text-3" strokeWidth={1.6} />
      <p className="ds-heading text-ds-text">No projects here yet</p>
      <p className="max-w-sm text-[13px] text-ds-text-2">{children ?? "Start a blank project to edit by hand, or describe an idea and let the agents research and script it."}</p>
      <Button size="sm" onClick={onCreate} className="mt-1">
        New project
      </Button>
    </div>
  );
}
