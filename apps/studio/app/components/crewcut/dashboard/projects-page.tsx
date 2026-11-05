import { IconPlus } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { Button, Pagination, SearchField, Select, Tabs, TabsList, TabsTrigger } from "@/components/ds";
import { useListParams } from "@/hooks/use-list-params";
import { cn } from "@/lib/utils";

import { CreateProjectDialog } from "./create-project";
import { EmptyProjects, ProjectCard, ProjectGridSkeleton, ProjectRow } from "./project-card";
import { type VideoFilter, type VideoSort, useVideoList } from "./use-videos";

const FILTERS: Array<{ value: VideoFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "waiting", label: "Needs your OK" },
  { value: "pipeline", label: "With agents" },
  { value: "drafts", label: "Drafts" },
  { value: "published", label: "Published" },
];

const PAGE_SIZE = 24;

export function ProjectsPage() {
  const list = useListParams<VideoFilter, VideoSort>({ filter: "all", sort: "recent" });
  const { videos, assetUrls, total, counts, loading, refreshing } = useVideoList({ query: list.query, filter: list.filter, sort: list.sort, page: list.page, pageSize: PAGE_SIZE });
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (!loading && !refreshing) list.clampPage(total, PAGE_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, refreshing, total, list.page]);
  const searching = Boolean(list.query);
  const label = FILTERS.find((entry) => entry.value === list.filter)?.label ?? "All";

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-5 px-4 pb-10 pt-5 sm:px-8 sm:pt-9">
      <header className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="ds-title text-ds-text sm:text-2xl">Projects</h1>
          <p className="mt-0.5 text-[13px] text-ds-text-2">
            {loading ? "Loading…" : searching ? `${counts.all} match${counts.all === 1 ? "" : "es"} for “${list.query}”` : `${counts.all} project${counts.all === 1 ? "" : "s"}`}
          </p>
        </div>
        <Button onClick={() => setCreating(true)} className="pc-press shrink-0">
          <IconPlus className="size-4" />
          <span className="hidden min-[400px]:inline">New project</span>
          <span className="min-[400px]:hidden">New</span>
        </Button>
      </header>

      <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center">
        <Tabs value={list.filter} onValueChange={(value) => list.setFilter(value as VideoFilter)} className="min-w-0">
          <TabsList className="ds-no-scrollbar overflow-x-auto px-0">
            {FILTERS.map((entry) => (
              <TabsTrigger key={entry.value} value={entry.value}>
                {entry.label}
                <span className={cn("rounded-full px-1.5 text-[10px] tabular", entry.value === "waiting" && counts.waiting > 0 ? "bg-ds-warning/15 text-ds-warning" : "bg-ds-surface-3 text-ds-text-2")}>{counts[entry.value] ?? 0}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex min-w-0 items-center gap-2 md:ml-auto">
          <SearchField value={list.text} onChange={list.setText} label="Search projects" placeholder="Search titles and ideas" className="flex-1 md:w-64 md:flex-none" />
          <Select
            label="Sort projects"
            value={list.sort}
            onChange={(value) => list.setSort(value as VideoSort)}
            className="h-9 w-[132px] shrink-0"
            options={[
              { value: "recent", label: "Last edited" },
              { value: "created", label: "Newest" },
              { value: "title", label: "Name A–Z" },
            ]}
          />
        </div>
      </div>

      {loading ? (
        <ProjectGridSkeleton />
      ) : videos.length === 0 ? (
        counts.all === 0 && !searching ? (
          <EmptyProjects onCreate={() => setCreating(true)} />
        ) : (
          <p className="rounded-ds-lg border border-dashed border-ds-border px-6 py-12 text-center text-[13px] text-ds-text-2">
            Nothing in “{label}”{searching ? ` matches “${list.query}”` : ""}.
          </p>
        )
      ) : (
        <div className={cn("flex flex-col gap-8 transition-opacity", refreshing && "opacity-60")} aria-busy={refreshing}>
          <div className="hidden grid-cols-2 gap-x-5 gap-y-7 sm:grid lg:grid-cols-3 2xl:grid-cols-4">
            {videos.map((video) => (
              <ProjectCard key={video.id} video={video} assetUrls={assetUrls} />
            ))}
          </div>
          <div className="flex flex-col divide-y divide-ds-border sm:hidden">
            {videos.map((video) => (
              <ProjectRow key={video.id} video={video} assetUrls={assetUrls} />
            ))}
          </div>
          <Pagination page={list.page} pageSize={PAGE_SIZE} total={total} onPageChange={list.setPage} noun="projects" />
        </div>
      )}
      <CreateProjectDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
