import { useActionMutation } from "@agent-native/core/client/hooks";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { StageStatus } from "@crewcut/contracts";
import {
  IconArrowRight,
  IconBell,
  IconFlask2,
  IconPlus,
  IconSearch,
  IconSparkles,
  IconUpload,
  IconWand,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import { Button, IconButton, Segmented, Switch, useDebouncedValue } from "@/components/ds";
import { STAGE_LABELS, STAGE_PROMPTS, askAgent, errorMessage } from "@/lib/crewcut";
import { cn } from "@/lib/utils";

import { AUTOPILOT_HINT, launchAutopilot, useAutopilotList } from "./autopilot/autopilot";
import { openUpgrade, showActionError, usePlan } from "./billing/upgrade";
import { CreateProjectDialog } from "./dashboard/create-project";
import { EmptyProjects, ProjectCard, ProjectGridSkeleton, ProjectRow } from "./dashboard/project-card";
import { useLoadDemo, useVideoList } from "./dashboard/use-videos";

type Ratio = "16:9" | "9:16" | "1:1" | "4:5";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** The bell: every video whose pipeline is waiting on a person's click. */
function WaitingBell() {
  // Its own small query: the bell must count every waiting video, not just the recent ones.
  const { videos: waiting, total: waitingTotal } = useVideoList({ filter: "waiting", pageSize: 20, withCompositions: false });
  const autopilot = useAutopilotList().filter((video) => video.phase === "ready" || video.phase === "needs_you" || video.phase === "paused");
  const total = waitingTotal + autopilot.length;
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={total ? `${total} video${total === 1 ? "" : "s"} waiting on you` : "Nothing waiting on you"}
          className="pc-press pc-touch-target relative flex size-10 items-center justify-center rounded-full bg-ds-surface text-ds-text shadow-[0_0_0_1px_var(--ds-hairline)] outline-none hover:bg-ds-surface-3 focus-visible:ring-2 focus-visible:ring-ds-accent"
        >
          <IconBell className="size-[18px]" />
          {total ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-ds-danger px-1 text-[10px] font-semibold text-white tabular">{total > 99 ? "99+" : total}</span>
          ) : null}
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content align="end" sideOffset={8} collisionPadding={12} className="ds-popover ds-menu-enter z-[200] w-[min(340px,calc(100vw-24px))] p-1.5">
          {autopilot.length ? (
            <>
              <p className="px-2.5 pb-1.5 pt-2 ds-overline text-ds-text-3">Autopilot</p>
              <ul className="flex flex-col">
                {autopilot.map((video) => (
                  <li key={video.id}>
                    <PopoverPrimitive.Close asChild>
                      <Link to={`/videos/${video.id}`} className="flex flex-col gap-0.5 rounded-[8px] px-2.5 py-2 outline-none hover:bg-ds-surface-3 focus-visible:bg-ds-surface-3">
                        <span className="truncate text-[13px] font-medium text-ds-text">{video.title}</span>
                        <span className={cn("truncate text-xs", video.phase === "ready" ? "text-supported" : "text-ds-warning")}>{video.phase === "ready" ? "Ready to review" : video.phase === "paused" ? "Stopped working: resume it" : "Needs you"}</span>
                      </Link>
                    </PopoverPrimitive.Close>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <p className="px-2.5 pb-1.5 pt-2 ds-overline text-ds-text-3">Waiting on you</p>
          {waiting.length === 0 ? (
            <p className="px-2.5 pb-3 text-[13px] text-ds-text-2">Nothing needs your OK right now.</p>
          ) : (
            <ul className="flex flex-col">
              {waiting.map((video) => (
                <li key={video.id}>
                  <PopoverPrimitive.Close asChild>
                    <Link to={`/videos/${video.id}`} className="flex flex-col gap-0.5 rounded-[8px] px-2.5 py-2 outline-none hover:bg-ds-surface-3 focus-visible:bg-ds-surface-3">
                      <span className="truncate text-[13px] font-medium text-ds-text">{video.title}</span>
                      <span className="truncate text-xs text-ds-warning">Approve: {video.progress.waiting.map((stage) => STAGE_LABELS[stage].agent).join(", ")}</span>
                    </Link>
                  </PopoverPrimitive.Close>
                </li>
              ))}
            </ul>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function QuickAction({ icon, label, hint, onClick, to }: { icon: React.ReactNode; label: string; hint: string; onClick?: () => void; to?: string }) {
  const body = (
    <>
      <span className="flex size-9 items-center justify-center rounded-ds-sm bg-ds-surface-2 text-ds-text shadow-[inset_0_0_0_1px_var(--ds-hairline)] [&_svg]:size-[18px]">{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-ds-text">{label}</span>
        <span className="block truncate text-[11px] text-ds-text-3">{hint}</span>
      </span>
    </>
  );
  const className =
    "ds-card pc-press flex w-[168px] shrink-0 snap-start flex-col items-start gap-3 p-3 text-left outline-none hover:bg-ds-surface-2 focus-visible:ring-2 focus-visible:ring-ds-accent sm:w-auto sm:flex-row sm:items-center";
  if (to) {
    return (
      <Link to={to} className={className}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [brief, setBrief] = useState("");
  const [ratio, setRatio] = useState<Ratio>("16:9");
  const [autopilot, setAutopilot] = useState(false);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const settledSearch = useDebouncedValue(search.trim(), 250);
  const { videos: recent, assetUrls, total: matches, loading, refreshing } = useVideoList({ query: settledSearch, pageSize: settledSearch ? 12 : 8 });
  const start = useActionMutation("start-pipeline");
  // Autopilot is a paid feature: the switch offers the plans instead of failing after "Make the video".
  const { plan, data: credits } = usePlan();
  const demo = useLoadDemo();

  // "Make it with agents" from the mobile nav lands here with ?focus=prompt.
  useEffect(() => {
    if (params.get("focus") !== "prompt") return;
    const element = promptRef.current;
    element?.scrollIntoView({ block: "center" });
    element?.focus();
    const next = new URLSearchParams(params);
    next.delete("focus");
    setParams(next, { replace: true });
  }, [params, setParams]);

  async function handleStart() {
    if (brief.trim().length < 3) return;
    try {
      const portrait = ratio === "9:16" || ratio === "4:5";
      const result = (await start.mutateAsync({ brief: brief.trim(), ratio, platforms: [portrait ? "youtube_shorts" : "youtube"], autopilot } as never)) as { videoId: string };
      navigate(`/videos/${result.videoId}`);
      if (autopilot) {
        // A background run: the crew carries on even if this page closes.
        if (await launchAutopilot(result.videoId)) toast.success("Autopilot is making your video", { description: "You can close this page. We'll show you when it's ready." });
      } else askAgent(STAGE_PROMPTS.trend(result.videoId), { videoId: result.videoId, idea: brief.trim() });
    } catch (error) {
      showActionError(error);
    }
  }

  const searchInput = (
    <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-ds-surface px-3.5 shadow-[0_0_0_1px_var(--ds-hairline)] focus-within:shadow-[0_0_0_1.5px_var(--ds-accent)]">
      <IconSearch className="size-4 shrink-0 text-ds-text-3" />
      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search projects"
        aria-label="Search projects"
        className="min-w-0 flex-1 bg-transparent text-sm text-ds-text outline-none placeholder:text-ds-text-3"
      />
      {search ? (
        <button type="button" aria-label="Clear search" onClick={() => setSearch("")} className="text-ds-text-3 hover:text-ds-text">
          <IconX className="size-4" />
        </button>
      ) : null}
    </label>
  );

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-7 px-4 pb-10 pt-5 sm:gap-9 sm:px-8 sm:pt-9">
      {/* Greeting + search + bell */}
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-ds-text-2">{greeting()}</p>
            <h1 className="ds-title text-balance text-ds-text sm:text-2xl">What are we making today?</h1>
          </div>
          <div className="hidden w-72 sm:flex">{searchInput}</div>
          <IconButton label={searchOpen ? "Close search" : "Search projects"} tooltip={false} size="lg" className="rounded-full bg-ds-surface shadow-[0_0_0_1px_var(--ds-hairline)] sm:hidden" onClick={() => setSearchOpen((open) => !open)}>
            {searchOpen ? <IconX /> : <IconSearch />}
          </IconButton>
          <WaitingBell />
        </div>
        {searchOpen ? <div className="flex sm:hidden">{searchInput}</div> : null}
      </header>

      {/* Create */}
      <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]" aria-label="Create">
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="ds-card pc-press group relative flex min-h-[148px] flex-col items-center justify-center gap-3 overflow-hidden p-6 text-center outline-none hover:bg-ds-surface-2 focus-visible:ring-2 focus-visible:ring-ds-accent lg:min-h-0"
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[var(--ds-shadow-md)] transition-transform duration-200 ease-[var(--ds-ease-out)] group-hover:scale-105">
            <IconPlus className="size-6" />
          </span>
          <span>
            <span className="block text-[15px] font-semibold text-ds-text">Create new project</span>
            <span className="mt-0.5 block text-xs text-ds-text-2">Blank timeline · 8 formats · edit by hand</span>
          </span>
        </button>

        <form
          className="ds-card flex min-w-0 flex-col gap-3 p-4 sm:p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void handleStart();
          }}
        >
          <h2 className="ds-heading text-ds-text">
            Bring an idea to life with <span className="text-ds-accent">the agents</span>
          </h2>
          <label htmlFor="pc-brief" className="sr-only">
            Video idea
          </label>
          <textarea
            id="pc-brief"
            ref={promptRef}
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void handleStart();
            }}
            rows={3}
            placeholder="An idea, a link, or a few notes — e.g. “Why we yawn, and why it's contagious”"
            className="w-full resize-none rounded-ds-md bg-ds-surface-2 px-3 py-2.5 text-[14px] leading-relaxed text-ds-text shadow-[inset_0_0_0_1px_var(--ds-hairline)] outline-none placeholder:text-ds-text-3 focus:shadow-[inset_0_0_0_1.5px_var(--ds-accent)]"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented
              ariaLabel="Aspect ratio"
              value={ratio}
              onChange={setRatio}
              options={(["16:9", "9:16", "1:1", "4:5"] as const).map((value) => ({ value, label: value }))}
            />
            <div className="flex items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-ds-text" title={AUTOPILOT_HINT}>
                <Switch label="Autopilot" checked={autopilot} onCheckedChange={(on) => (on && plan && !plan.autopilot ? openUpgrade("autopilot") : setAutopilot(on))} />
                Autopilot
              </label>
              <Button type="submit" disabled={brief.trim().length < 3 || start.isPending} className="pc-press">
                <IconSparkles className="size-4" />
                {start.isPending ? "Starting…" : autopilot ? "Make the video" : "Generate"}
              </Button>
            </div>
          </div>
          <p className="ds-caption text-ds-text-3" aria-live="polite">
            {autopilot ? (
              <>
                <span className="font-medium text-ds-text-2">Autopilot:</span> {AUTOPILOT_HINT}
              </>
            ) : (
              "Ideas → research → script → fact-check → animation → voice → publish → results. You approve each key step, and every claim links to its source."
            )}
          </p>
          {/* What it will cost, before starting: the usual credits for a draft next to what's left. */}
          {credits?.typicalDraftCredits ? (
            <p className="ds-caption text-ds-text-3">
              A draft usually takes about {credits.typicalDraftCredits} AI credits; you have {Math.max(0, credits.balance.available).toLocaleString()}. Your own AI key costs none.
            </p>
          ) : null}
        </form>
      </section>

      {/* Quick actions */}
      <section aria-label="Quick actions" className="-mx-4 min-w-0 sm:mx-0">
        <div className="ds-no-scrollbar flex snap-x gap-3 overflow-x-auto px-4 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0">
          <QuickAction icon={<IconPlus />} label="Blank project" hint="Pick a format" onClick={() => setCreating(true)} />
          <QuickAction
            icon={<IconWand />}
            label="Agent video"
            hint="Research → publish"
            onClick={() => {
              promptRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
              promptRef.current?.focus();
            }}
          />
          <QuickAction icon={<IconUpload />} label="Upload media" hint="Library for every project" to="/assets" />
          <QuickAction icon={<IconFlask2 />} label={demo.pending ? "Loading…" : "Load demo"} hint="Fact-checked script + video" onClick={() => void demo.load()} />
        </div>
      </section>

      {/* Recent */}
      <section className="flex min-w-0 flex-col gap-4" aria-labelledby="recent-heading">
        <div className="flex items-center justify-between gap-3">
          <h2 id="recent-heading" className="ds-heading text-ds-text">
            {search.trim() ? `Results for “${search.trim()}”` : "Recent projects"}
          </h2>
          <Link to={settledSearch ? `/projects?q=${encodeURIComponent(settledSearch)}` : "/projects"} className="inline-flex items-center gap-1 text-[13px] font-medium text-ds-text-2 hover:text-ds-text">
            {settledSearch && matches > recent.length ? `See all ${matches}` : "See all"} <IconArrowRight className="size-3.5" />
          </Link>
        </div>
        {loading ? (
          <ProjectGridSkeleton count={4} />
        ) : recent.length === 0 ? (
          search.trim() ? (
            <p className="rounded-ds-lg border border-dashed border-ds-border px-6 py-10 text-center text-[13px] text-ds-text-2">No projects match “{search.trim()}”.</p>
          ) : (
            <EmptyProjects onCreate={() => setCreating(true)} />
          )
        ) : (
          <>
            <div className={cn("hidden grid-cols-2 gap-x-5 gap-y-7 transition-opacity sm:grid lg:grid-cols-3 2xl:grid-cols-4", refreshing && "opacity-60")}>
              {recent.map((video) => (
                <ProjectCard key={video.id} video={video} assetUrls={assetUrls} />
              ))}
            </div>
            <div className={cn("flex flex-col divide-y divide-ds-border sm:hidden")}>
              {recent.slice(0, 6).map((video) => (
                <ProjectRow key={video.id} video={video} assetUrls={assetUrls} />
              ))}
            </div>
          </>
        )}
      </section>

      <CreateProjectDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

export type { Ratio, StageStatus };
