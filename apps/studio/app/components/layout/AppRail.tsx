import { OrgSwitcher } from "@agent-native/toolkit/app/org";
import { IconMoon, IconSun } from "@tabler/icons-react";
import { Link, useLocation } from "react-router";

import { CrewcutMark } from "@/components/crewcut/primitives";
import { HOME_PATH } from "@/lib/chat-paths";
import { cn } from "@/lib/utils";

import { type NavItem, PRIMARY_NAV, SECONDARY_NAV, useThemeToggle } from "./nav-items";

const ITEM =
  "pc-press flex w-[62px] flex-col items-center gap-1 rounded-ds-md px-1 py-2 text-[10.5px] font-medium leading-none outline-none focus-visible:ring-2 focus-visible:ring-ds-accent [&_svg]:size-5";

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
  return (
    <aside className="flex h-full w-[76px] shrink-0 flex-col items-center border-e border-ds-border bg-sidebar py-3" aria-label="App navigation">
      <Link to={HOME_PATH} aria-label="Crewcut home" className="pc-press mb-3 flex size-10 items-center justify-center rounded-ds-md outline-none focus-visible:ring-2 focus-visible:ring-ds-accent">
        <CrewcutMark className="size-8" />
      </Link>
      <nav className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto ds-no-scrollbar" aria-label="Main">
        {PRIMARY_NAV.map((item) => (
          <RailLink key={item.to} item={item} />
        ))}
      </nav>
      <div className="flex shrink-0 flex-col items-center gap-1 pt-2">
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
        <div className="mt-1 flex size-10 items-center justify-center">
          <OrgSwitcher reserveSpace compact currentAppId="crewcut" className="size-9 rounded-full bg-transparent p-0 hover:bg-ds-surface-3" />
        </div>
      </div>
    </aside>
  );
}
