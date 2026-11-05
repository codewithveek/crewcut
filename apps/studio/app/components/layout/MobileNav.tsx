import { IconChevronLeft, IconChevronRight, IconDots, IconFlask2, IconFolder, IconHome, IconPhoto, IconPlus, IconSparkles } from "@tabler/icons-react";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { BottomSheet, Switch } from "@/components/ds";
import { CreateProjectForm } from "@/components/crewcut/dashboard/create-project";
import { useLoadDemo } from "@/components/crewcut/dashboard/use-videos";
import { HOME_PATH } from "@/lib/chat-paths";
import { cn } from "@/lib/utils";

import { PRIMARY_NAV, SECONDARY_NAV, useThemeToggle } from "./nav-items";

function NavButton({ to, label, icon: Icon, active }: { to: string; label: string; icon: typeof IconHome; active: boolean }) {
  return (
    <Link
      to={to}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "pc-press flex size-12 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ds-accent [&_svg]:size-[22px]",
        active ? "bg-ds-surface-3 text-ds-text" : "text-ds-text-2",
      )}
    >
      <Icon strokeWidth={active ? 2.1 : 1.8} />
    </Link>
  );
}

function SheetRow({ icon, title, hint, onClick, to }: { icon: React.ReactNode; title: string; hint?: string; onClick?: () => void; to?: string }) {
  const body = (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-ds-md bg-ds-surface-2 text-ds-text shadow-[inset_0_0_0_1px_var(--ds-hairline)] [&_svg]:size-5">{icon}</span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[15px] font-medium text-ds-text">{title}</span>
        {hint ? <span className="block truncate text-xs text-ds-text-2">{hint}</span> : null}
      </span>
      <IconChevronRight className="size-4 shrink-0 text-ds-text-3" />
    </>
  );
  const className = "pc-press flex min-h-[60px] w-full items-center gap-3 rounded-ds-md px-2 outline-none hover:bg-ds-surface-2 focus-visible:ring-2 focus-visible:ring-ds-accent";
  return to ? (
    <Link to={to} onClick={onClick} className={className}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  );
}

/**
 * Phones: a floating pill (image 3) with Home, Projects, a raised Create
 * button, Assets and More. Shown on Crewcut pages only (never the editor).
 */
export function MobileNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [blank, setBlank] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const theme = useThemeToggle();
  const demo = useLoadDemo();
  const [home, projects, assets] = PRIMARY_NAV;
  const moreItems = [...PRIMARY_NAV.slice(3), ...SECONDARY_NAV];
  const moreActive = moreItems.some((item) => item.match(pathname));

  return (
    <>
      <nav aria-label="Main" className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(12px,env(safe-area-inset-bottom))] md:hidden">
        <div className="pc-glass pointer-events-auto flex items-center gap-1 rounded-full p-1.5">
          {home ? <NavButton to={home.to} label="Home" icon={IconHome} active={home.match(pathname)} /> : null}
          {projects ? <NavButton to={projects.to} label="Projects" icon={IconFolder} active={projects.match(pathname)} /> : null}
          <button
            type="button"
            aria-label="Create"
            onClick={() => {
              setBlank(false);
              setCreateOpen(true);
            }}
            className="pc-press mx-1 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[var(--ds-shadow-md)] outline-none focus-visible:ring-2 focus-visible:ring-ds-accent focus-visible:ring-offset-2"
          >
            <IconPlus className="size-6" strokeWidth={2.2} />
          </button>
          {assets ? <NavButton to={assets.to} label="Assets" icon={IconPhoto} active={assets.match(pathname)} /> : null}
          <button
            type="button"
            aria-label="More"
            onClick={() => setMoreOpen(true)}
            className={cn(
              "pc-press flex size-12 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ds-accent [&_svg]:size-[22px]",
              moreActive ? "bg-ds-surface-3 text-ds-text" : "text-ds-text-2",
            )}
          >
            <IconDots strokeWidth={1.8} />
          </button>
        </div>
      </nav>

      <BottomSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={blank ? "New blank project" : "Create"}
        actions={
          blank ? (
            <button type="button" onClick={() => setBlank(false)} aria-label="Back" className="pc-press flex size-8 items-center justify-center rounded-full bg-ds-surface-2 text-ds-text-2">
              <IconChevronLeft className="size-4" />
            </button>
          ) : null
        }
      >
        {blank ? (
          <CreateProjectForm autoFocus={false} onDone={() => setCreateOpen(false)} />
        ) : (
          <div className="flex flex-col gap-1">
            <SheetRow icon={<IconPlus />} title="Blank project" hint="Pick a format and edit by hand" onClick={() => setBlank(true)} />
            <SheetRow
              icon={<IconSparkles />}
              title="Make it with the agents"
              hint="Research, script, fact-check, animate"
              onClick={() => {
                setCreateOpen(false);
                navigate(`${HOME_PATH}?focus=prompt`);
              }}
            />
            <SheetRow
              icon={<IconFlask2 />}
              title={demo.pending ? "Loading demo…" : "Load demo workspace"}
              hint="A fact-checked script and a finished video"
              onClick={async () => {
                await demo.load();
                setCreateOpen(false);
              }}
            />
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={moreOpen} onOpenChange={setMoreOpen} title="More">
        <div className="flex flex-col gap-1">
          {moreItems.map((item) => {
            const Icon = item.icon;
            return <SheetRow key={item.to} icon={<Icon />} title={item.title} to={item.to} onClick={() => setMoreOpen(false)} />;
          })}
          <div className="flex min-h-[60px] items-center gap-3 px-2">
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium text-ds-text">Dark mode</span>
              <span className="block text-xs text-ds-text-2">Applies to the whole app in this browser</span>
            </span>
            <Switch checked={theme.dark} onCheckedChange={(checked) => theme.setTheme(checked ? "dark" : "light")} label="Dark mode" />
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
