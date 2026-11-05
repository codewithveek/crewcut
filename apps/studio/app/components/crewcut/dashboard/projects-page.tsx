import { IconPlus, IconSearch, IconX } from "@tabler/icons-react";
import { useMemo, useState } from "react";

import { Button, Select, Tabs, TabsList, TabsTrigger } from "@/components/ds";

import { CreateProjectDialog } from "./create-project";
import { EmptyProjects, ProjectCard, ProjectGridSkeleton, ProjectRow } from "./project-card";
import { type VideoFilter, matchesFilter, useVideos } from "./use-videos";

const FILTERS: Array<{ value: VideoFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "pipeline", label: "In pipeline" },
  { value: "drafts", label: "Drafts" },
  { value: "published", label: "Published" },
];

type Sort = "recent" | "title" | "created";

export function ProjectsPage() {
  const { videos, assetUrls, loading } = useVideos();
  const [filter, setFilter] = useState<VideoFilter>("all");
  const [sort, setSort] = useState<Sort>("recent");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((entry) => [entry.value, videos.filter((video) => matchesFilter(video, entry.value)).length])) as Record<VideoFilter, number>, [videos]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = videos.filter((video) => matchesFilter(video, filter) && (!needle || video.title.toLowerCase().includes(needle)));
    return [...list].sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "created") return b.createdAt.localeCompare(a.createdAt);
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [videos, filter, sort, search]);

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-5 px-4 pb-10 pt-5 sm:px-8 sm:pt-9">
      <header className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="ds-title text-ds-text sm:text-2xl">Projects</h1>
          <p className="mt-0.5 text-[13px] text-ds-text-2">{loading ? "Loading…" : `${videos.length} project${videos.length === 1 ? "" : "s"}`}</p>
        </div>
        <Button onClick={() => setCreating(true)} className="pc-press shrink-0">
          <IconPlus className="size-4" />
          <span className="hidden min-[400px]:inline">New project</span>
          <span className="min-[400px]:hidden">New</span>
        </Button>
      </header>

      <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center">
        <Tabs value={filter} onValueChange={(value) => setFilter(value as VideoFilter)} className="min-w-0">
          <TabsList className="ds-no-scrollbar overflow-x-auto px-0">
            {FILTERS.map((entry) => (
              <TabsTrigger key={entry.value} value={entry.value}>
                {entry.label}
                <span className="rounded-full bg-ds-surface-3 px-1.5 text-[10px] tabular text-ds-text-2">{counts[entry.value] ?? 0}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex min-w-0 items-center gap-2 md:ml-auto">
          <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-ds-sm bg-ds-surface px-3 shadow-[0_0_0_1px_var(--ds-hairline)] focus-within:shadow-[0_0_0_1.5px_var(--ds-accent)] md:w-64 md:flex-none">
            <IconSearch className="size-4 shrink-0 text-ds-text-3" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" aria-label="Search projects" className="min-w-0 flex-1 bg-transparent text-sm text-ds-text outline-none placeholder:text-ds-text-3" />
            {search ? (
              <button type="button" aria-label="Clear search" onClick={() => setSearch("")} className="text-ds-text-3 hover:text-ds-text">
                <IconX className="size-4" />
              </button>
            ) : null}
          </label>
          <Select
            label="Sort projects"
            value={sort}
            onChange={(value) => setSort(value as Sort)}
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
      ) : shown.length === 0 ? (
        videos.length === 0 ? (
          <EmptyProjects onCreate={() => setCreating(true)} />
        ) : (
          <p className="rounded-ds-lg border border-dashed border-ds-border px-6 py-12 text-center text-[13px] text-ds-text-2">Nothing in “{FILTERS.find((entry) => entry.value === filter)?.label}”{search.trim() ? ` matches “${search.trim()}”` : ""}.</p>
        )
      ) : (
        <>
          <div className="hidden grid-cols-2 gap-x-5 gap-y-7 sm:grid lg:grid-cols-3 2xl:grid-cols-4">
            {shown.map((video) => (
              <ProjectCard key={video.id} video={video} assetUrls={assetUrls} />
            ))}
          </div>
          <div className="flex flex-col divide-y divide-ds-border sm:hidden">
            {shown.map((video) => (
              <ProjectRow key={video.id} video={video} assetUrls={assetUrls} />
            ))}
          </div>
        </>
      )}
      <CreateProjectDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
