import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { isEditorPath } from "./nav-items";

/**
 * Loading shells shaped like Crewcut's real pages, shown before the app
 * hydrates. Server-rendered, so plain markup only: design tokens and Tailwind
 * classes, no hooks, no data. Each one mirrors its page's grid so nothing
 * jumps when the page arrives.
 */

function B({ className }: { className?: string }) {
  return <div className={cn("pc-skeleton", className)} />;
}

function Rail({ className }: { className?: string }) {
  return (
    <aside className={cn("h-full w-[76px] shrink-0 flex-col items-center gap-3 border-e border-ds-border bg-sidebar py-3", className)}>
      <B className="mb-1 size-10 rounded-ds-md" />
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex flex-col items-center gap-1.5 py-1">
          <B className="size-5 rounded-md" />
          <B className="h-2 w-10 rounded-full" />
        </div>
      ))}
      <div className="mt-auto flex flex-col items-center gap-3">
        <B className="size-5 rounded-md" />
        <B className="size-5 rounded-md" />
        <B className="size-8 rounded-full" />
      </div>
    </aside>
  );
}

function Shell({ children, rail = "hidden md:flex" }: { children: ReactNode; rail?: string }) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-ds-bg" aria-busy="true" aria-label="Loading">
      <Rail className={rail} />
      <div className="min-w-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

function CardGrid({ count = 6, aspect = "aspect-[16/10]", cols = "grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" }: { count?: number; aspect?: string; cols?: string }) {
  return (
    <div className={cn("grid gap-x-5 gap-y-7", cols)}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex flex-col gap-2.5">
          <B className={cn(aspect, "w-full rounded-ds-lg")} />
          <B className="h-3.5 w-3/5 rounded-full" />
          <B className="h-3 w-2/5 rounded-full" />
        </div>
      ))}
    </div>
  );
}

function HomeSkeleton() {
  return (
    <Shell>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-7 px-4 pb-10 pt-5 sm:gap-9 sm:px-8 sm:pt-9">
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col gap-2.5">
            <B className="h-3 w-28 rounded-full" />
            <B className="h-6 w-64 rounded-full" />
          </div>
          <B className="hidden h-11 w-72 rounded-full sm:block" />
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <B className="h-[180px] rounded-ds-lg lg:h-[250px]" />
          <B className="h-[220px] rounded-ds-lg lg:h-[250px]" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <B key={index} className="h-[62px] rounded-ds-md" />
          ))}
        </div>
        <div className="flex flex-col gap-4">
          <B className="h-4 w-36 rounded-full" />
          <CardGrid count={3} cols="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" />
        </div>
      </div>
    </Shell>
  );
}

function ListPageSkeleton({ assets }: { assets: boolean }) {
  return (
    <Shell>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-10 pt-5 sm:px-8 sm:pt-9">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-2.5">
            <B className="h-6 w-36 rounded-full" />
            <B className="h-3 w-64 max-w-[60vw] rounded-full" />
          </div>
          <B className="h-9 w-32 rounded-ds-sm" />
        </div>
        <div className="flex gap-2">
          <B className="h-9 min-w-0 flex-1 rounded-ds-sm" />
          <B className="h-9 w-40 rounded-ds-sm" />
        </div>
        {assets ? (
          <CardGrid count={10} aspect="aspect-[4/3]" cols="grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" />
        ) : (
          <CardGrid count={8} />
        )}
      </div>
    </Shell>
  );
}

function BoardSkeleton() {
  return (
    <Shell>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-2.5">
            <B className="h-6 w-72 max-w-[60vw] rounded-full" />
            <B className="h-3 w-40 rounded-full" />
          </div>
          <div className="flex gap-2">
            <B className="h-9 w-28 rounded-ds-sm" />
            <B className="h-9 w-28 rounded-ds-sm" />
          </div>
        </div>
        <div className="flex gap-2 overflow-hidden sm:grid sm:grid-cols-4 xl:grid-cols-8">
          {Array.from({ length: 8 }, (_, index) => (
            <B key={index} className="h-[58px] min-w-[120px] rounded-ds-md" />
          ))}
        </div>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <B className="h-[420px] rounded-ds-lg" />
          <B className="hidden h-[420px] rounded-ds-lg xl:block" />
        </div>
      </div>
    </Shell>
  );
}

function EditorSkeleton() {
  return (
    <Shell rail="hidden xl:flex">
      {/* Desktop and tablet: top bar, three panels, timeline. */}
      <div className="hidden h-full min-h-0 flex-col md:flex">
        <div className="flex h-14 shrink-0 items-center gap-3 px-3 [@media(max-height:820px)]:h-12">
          <B className="size-8 rounded-full" />
          <B className="h-4 w-40 rounded-full" />
          <div className="ml-auto flex gap-2">
            <B className="h-9 w-24 rounded-ds-sm" />
            <B className="h-9 w-20 rounded-ds-sm" />
            <B className="h-9 w-24 rounded-ds-sm" />
          </div>
        </div>
        <div className="flex min-h-0 flex-1 gap-2 px-2">
          <div className="ds-panel flex h-full">
            <div className="flex w-[60px] flex-col items-center gap-4 py-3">
              {Array.from({ length: 8 }, (_, index) => (
                <B key={index} className="size-6 rounded-md" />
              ))}
            </div>
            <div className="hidden w-[260px] flex-col gap-3 p-3 lg:flex">
              <B className="h-5 w-24 rounded-full" />
              <B className="h-9 rounded-ds-sm" />
              <div className="grid grid-cols-2 gap-2">
                <B className="aspect-[4/3] rounded-ds-md" />
                <B className="aspect-[4/3] rounded-ds-md" />
              </div>
            </div>
          </div>
          <div className="ds-panel flex min-w-0 flex-1 flex-col gap-2 p-2">
            <div className="flex min-h-0 flex-1 items-center justify-center">
              <B className="aspect-video max-h-full w-[min(100%,640px)] rounded-ds-md" />
            </div>
            <div className="flex h-10 shrink-0 items-center justify-between gap-3 px-1">
              <B className="h-6 w-40 rounded-full" />
              <B className="size-9 rounded-full" />
              <B className="h-6 w-24 rounded-full" />
            </div>
          </div>
          <div className="ds-panel hidden w-[clamp(280px,24vw,340px)] shrink-0 flex-col gap-3 p-3 lg:flex">
            <B className="h-9 rounded-ds-sm" />
            <B className="h-10 rounded-ds-sm" />
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="flex items-center gap-3">
                <B className="h-3 w-16 rounded-full" />
                <B className="h-9 flex-1 rounded-ds-sm" />
              </div>
            ))}
          </div>
        </div>
        <div className="h-2 shrink-0" />
        <div className="ds-panel mx-2 mb-2 flex h-[clamp(180px,34vh,320px)] shrink-0 flex-col gap-2 p-2 [@media(max-height:820px)]:h-[clamp(160px,30vh,260px)]">
          <div className="flex h-8 items-center gap-2">
            {Array.from({ length: 6 }, (_, index) => (
              <B key={index} className="size-6 rounded-md" />
            ))}
            <B className="ml-auto h-4 w-32 rounded-full" />
          </div>
          {/* Lanes: captions, main, voice, music (same heights as the timeline). */}
          {["h-7 w-[30%]", "h-[50px] w-[45%]", "h-9 w-[38%]", "h-8 w-[52%]"].map((lane, index) => (
            <div key={index} className="flex min-h-0 items-center gap-2">
              <B className="h-3.5 w-[150px] shrink-0 rounded-full" />
              <B className={cn("rounded-ds-sm", lane)} />
            </div>
          ))}
        </div>
      </div>
      {/* Phones: bar, preview, tool strip. */}
      <div className="flex h-full flex-col gap-3 p-3 md:hidden">
        <div className="flex h-10 items-center gap-3">
          <B className="size-8 rounded-full" />
          <B className="h-4 w-32 rounded-full" />
          <B className="ml-auto h-8 w-20 rounded-full" />
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <B className="aspect-[9/16] max-h-full w-[min(100%,300px)] rounded-ds-md" />
        </div>
        <B className="h-[120px] rounded-ds-md" />
        <div className="flex justify-between">
          {Array.from({ length: 5 }, (_, index) => (
            <B key={index} className="size-10 rounded-ds-md" />
          ))}
        </div>
      </div>
    </Shell>
  );
}

function PageSkeletonGeneric() {
  return (
    <Shell>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-10 pt-5 sm:px-8 sm:pt-9">
        <B className="h-6 w-44 rounded-full" />
        <B className="h-3 w-80 max-w-[70vw] rounded-full" />
        {Array.from({ length: 4 }, (_, index) => (
          <B key={index} className="h-[72px] rounded-ds-lg" />
        ))}
      </div>
    </Shell>
  );
}

/** Settings: the page list beside the open page, as the real one is laid out (components/crewcut/settings). */
function SettingsSkeleton() {
  return (
    <Shell>
      <div className="mx-auto flex w-full max-w-6xl">
        <div className="hidden w-60 shrink-0 flex-col gap-2 border-e border-ds-border px-3 pt-8 md:flex">
          <B className="mb-3 h-5 w-24 rounded-full" />
          {Array.from({ length: 9 }, (_, index) => (
            <B key={index} className="h-9 rounded-ds-md" />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4 px-4 pt-5 md:px-8 md:pt-8">
          <B className="h-7 w-48 rounded-full" />
          {Array.from({ length: 3 }, (_, index) => (
            <B key={index} className="h-[120px] rounded-ds-lg" />
          ))}
        </div>
      </div>
    </Shell>
  );
}

/**
 * The loading shell for a path, or null to keep the framework's own (chat and
 * other framework pages already get a matching one).
 */
export function pageSkeletonForPath(pathname: string): ReactNode | null {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (isEditorPath(path)) return <EditorSkeleton />;
  if (path === "/" || path === "/home") return <HomeSkeleton />;
  if (path === "/projects") return <ListPageSkeleton assets={false} />;
  if (path === "/assets") return <ListPageSkeleton assets />;
  if (path === "/templates") return <ListPageSkeleton assets />;
  if (/^\/videos\/[^/]+$/.test(path)) return <BoardSkeleton />;
  if (/^\/videos\/[^/]+\/proof/.test(path)) return <PageSkeletonGeneric />;
  if (path === "/settings" || path.startsWith("/settings/") || path === "/connections" || path === "/billing" || path === "/team") return <SettingsSkeleton />;
  return null;
}
