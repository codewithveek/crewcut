import { OrgSwitcher } from "@agent-native/toolkit/app/org";
import { IconMoon, IconSun } from "@tabler/icons-react";
import { Link, useLocation } from "react-router";

import { CrewcutMark } from "@/components/crewcut/primitives";
import { HOME_PATH } from "@/lib/chat-paths";
import { cn } from "@/lib/utils";

import { useCatalogAccess } from "@/components/crewcut/catalog/use-catalog-access";

import { ADMIN_NAV, type NavItem, PRIMARY_NAV, SECONDARY_NAV, useThemeToggle } from "./nav-items";

/** Shorter windows (laptops at 768px and below) get a tighter rail, so nothing scrolls or overlaps. */
const ITEM = cn(
  "pc-press flex w-[62px] flex-col items-center gap-1 rounded-ds-md px-1 py-2 text-[10.5px] font-medium leading-none outline-none focus-visible:ring-2 focus-visible:ring-ds-accent [&_svg]:size-5",
  "[@media(max-height:820px)]:gap-[3px] [@media(max-height:820px)]:py-1.5 [@media(max-height:820px)]:text-[10px] [@media(max-height:820px)]:[&_svg]:size-[18px]",
);

function RailLink({ item }: { item: NavItem }) {
  const { pathname } = useLocation();
  const active = item.match(pathname);
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      title={item.title}
      className={cn(ITEM, active ? "bg-ds-surface-3 text-ds-text" : "text-ds-text-2 hover:bg-ds-surface-2 hover:text-ds-text")}
    >
      <Icon strokeWidth={active ? 2 : 1.7} />
      <span className="max-w-full truncate">{item.label}</span>
    </Link>
  );
}

/**
 * The app's left rail (image 2): icon-above-label destinations, settings and
 * the account at the bottom. 76px wide on every page that has it.
 */
export function AppRail() {
  const theme = useThemeToggle();
  const access = useCatalogAccess();
  return (
    <aside className={cn("flex h-full w-[76px] shrink-0 flex-col items-center border-e border-ds-border bg-sidebar py-3", "[@media(max-height:820px)]:py-2")} aria-label="App navigation">
      <Link to={HOME_PATH} aria-label="Crewcut home" className={cn("group pc-press mb-3 flex size-10 shrink-0 items-center justify-center rounded-ds-md outline-none focus-visible:ring-2 focus-visible:ring-ds-accent", "[@media(max-height:820px)]:mb-1.5 [@media(max-height:820px)]:size-9")}>
        <CrewcutMark motion="intro" hover className={cn("size-8", "[@media(max-height:820px)]:size-7")} />
      </Link>
      <nav className={cn("flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto ds-no-scrollbar", "[@media(max-height:820px)]:gap-0.5")} aria-label="Main">
        {PRIMARY_NAV.map((item) => (
          <RailLink key={item.to} item={item} />
        ))}
        {access?.admin ? <RailLink item={ADMIN_NAV} /> : null}
      </nav>
      <div className={cn("flex shrink-0 flex-col items-center gap-1 pt-2", "[@media(max-height:820px)]:gap-0.5 [@media(max-height:820px)]:pt-1")}>
        <button
          type="button"
          onClick={theme.toggle}
          aria-label={theme.dark ? "Switch to light mode" : "Switch to dark mode"}
          title={theme.dark ? "Switch to light mode" : "Switch to dark mode"}
          className={cn(ITEM, "text-ds-text-2 hover:bg-ds-surface-2 hover:text-ds-text")}
        >
          {theme.dark ? <IconSun strokeWidth={1.7} /> : <IconMoon strokeWidth={1.7} />}
          <span>{theme.mounted ? (theme.dark ? "Light" : "Dark") : "Theme"}</span>
        </button>
        {SECONDARY_NAV.map((item) => (
          <RailLink key={item.to} item={item} />
        ))}
        {/* Credits meter + account: sized by its content (it stacks two controls), never squeezed over Settings. */}
        <div className="mt-1 flex min-h-10 w-full items-center justify-center">
          <OrgSwitcher reserveSpace compact currentAppId="crewcut" className="size-9 rounded-full bg-transparent p-0 hover:bg-ds-surface-3" />
        </div>
      </div>
    </aside>
  );
}
