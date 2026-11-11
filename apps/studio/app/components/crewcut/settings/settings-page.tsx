import { useFeatureFlags } from "@agent-native/core/client/feature-flags/use-feature-flag";
import { useT } from "@agent-native/core/client/i18n";
import { useLabStates } from "@agent-native/core/client/labs/use-lab";
import { useOrg } from "@agent-native/core/client/org";
import {
  CORE_SETTINGS_PAGES,
  DEFAULT_SETTINGS_PAGE_ID,
  type SettingsBridgeInput,
  type SettingsPageContext,
  type SettingsPageDefinition,
  type SettingsPageHeader,
  SettingsSkeleton,
  createSettingsBridge,
  getSettingsPages,
  isSettingsPageVisible,
  resolveSettingsRoute,
  settingsPagePath,
  sortSettingsPages,
  subscribeSettingsPages,
} from "@agent-native/toolkit/app/settings";
import { deriveBridgedAppPages } from "@agent-native/toolkit/app/settings/shell/bridge";
import { SettingsShellProvider } from "@agent-native/toolkit/app/settings/shell/context";
import { BridgedTabSettingsPage } from "@agent-native/toolkit/app/settings/shell/core-pages";
import { IconChevronLeft, IconChevronRight, IconCreditCard, IconPlugConnected } from "@tabler/icons-react";
import { type ComponentType, Suspense, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { BillingPage } from "@/components/crewcut/billing/billing-page";
import { ConnectionsPage } from "@/components/crewcut/connections-page";
import { cn } from "@/lib/utils";

/**
 * Crewcut's own Settings: our navigation, grouping and layout, inside the app
 * like every other page. The pages themselves come from two places:
 *
 * - Crewcut's own (Plan & credits, Connections), and
 * - Agent-Native's settings pages (profile, security, model, members, …),
 *   which are rendered here as components. They still read and save through
 *   the framework, so nothing about how settings are stored changes; they
 *   are just arranged our way and no longer take over the whole screen.
 *
 * The framework pages expect a little context (who is looking, which page
 * and sub-page is open, a place to put their header button), which this
 * shell provides the same way the framework's own shell does.
 */

interface OwnPage {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  component: ComponentType;
}

const OWN_PAGES: readonly OwnPage[] = [
  { id: "plan", label: "Plan & credits", icon: IconCreditCard, component: BillingPage },
  { id: "connections", label: "Connections", icon: IconPlugConnected, component: ConnectionsPage },
];

/** Our grouping, in plain words. Pages not named here (operator pages, anything new in the framework) land in "Advanced". */
const GROUPS: ReadonlyArray<{ id: string; label: string; pages: readonly string[] }> = [
  { id: "you", label: "You", pages: ["profile", "preferences", "security", "notifications"] },
  { id: "plan", label: "Plan", pages: ["plan", "usage"] },
  { id: "connections", label: "Connections & AI", pages: ["connections", "model"] },
  { id: "crew", label: "The crew", pages: ["instructions", "personalization", "learnings", "automations", "creative-context"] },
  { id: "workspace", label: "Workspace", pages: ["org", "members", "invite-members", "member-roles", "groups"] },
];
/** Plainer names where the framework has two pages called "General". */
const LABELS: Readonly<Record<string, string>> = { org: "Workspace", app: "App", model: "AI model" };
const LAST_GROUP = { id: "about", label: "About", pages: ["whats-new"] as readonly string[] };

interface NavEntry {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export interface CrewcutSettingsProps extends Pick<SettingsBridgeInput, "extraTabs" | "account" | "whatsNewMarkdown"> {}

export function CrewcutSettings({ extraTabs, account, whatsNewMarkdown }: CrewcutSettingsProps) {
  const t = useT();
  const location = useLocation();
  const routerNavigate = useNavigate();
  const { data: org } = useOrg();
  const labStates = useLabStates();
  const labs = useMemo(() => Object.fromEntries(Object.entries(labStates).flatMap(([key, state]) => ("error" in state ? [] : [[key, state.enabled]]))), [labStates]);
  const flags = useFeatureFlags();

  const context = useMemo<SettingsPageContext>(() => {
    const role = org?.role ?? null;
    return {
      role,
      isOwner: role === "owner",
      isAdmin: role === "owner" || role === "admin",
      hasOrganization: org ? Boolean(org.orgId) : null,
      soloDeploymentAdmin: (org as { soloDeploymentAdmin?: boolean } | undefined)?.soloDeploymentAdmin === true,
      appId: "crewcut",
      labs,
      labStates,
      flags,
    };
  }, [flags, labStates, labs, org]);

  const registered = useSyncExternalStore(subscribeSettingsPages, getSettingsPages, getSettingsPages);
  const { pages, bridge } = useMemo(() => {
    const byId = new Map<string, SettingsPageDefinition>(CORE_SETTINGS_PAGES.map((page) => [page.id, page]));
    for (const page of registered) byId.set(page.id, page);
    const declared = [...byId.values()];
    const derived = deriveBridgedAppPages(extraTabs ?? [], declared, BridgedTabSettingsPage);
    return {
      pages: sortSettingsPages([...declared, ...derived.pages]),
      bridge: createSettingsBridge({ extraTabs, account, whatsNewMarkdown, appName: "Crewcut" }, derived.pageTabs),
    };
  }, [account, extraTabs, registered, whatsNewMarkdown]);
  const visiblePages = useMemo(() => pages.filter((page) => isSettingsPageVisible(page, context, bridge)), [bridge, context, pages]);

  // ── Which page is open ────────────────────────────────────────────────────
  const segments = location.pathname.replace(/^\/settings\/?/, "").split("/").filter(Boolean);
  const ownPage = OWN_PAGES.find((page) => page.id === segments[0]) ?? null;
  const templateTabPageIds = useMemo(
    () =>
      new Map(
        visiblePages.flatMap((page) => {
          const tab = bridge.tabForPage(page.id);
          return tab ? [[tab.id, page.id] as const] : [];
        }),
      ),
    [bridge, visiblePages],
  );
  const resolved = useMemo(
    () => resolveSettingsRoute({ pathname: location.pathname, hash: location.hash, search: location.search }, pages, { templateTabPageIds }),
    [location.hash, location.pathname, location.search, pages, templateTabPageIds],
  );
  /** Bare /settings: phones show the list of pages, wider screens open the first page next to it. */
  const atIndex = segments.length === 0 && !resolved.legacy;
  const frameworkPage = ownPage
    ? null
    : (visiblePages.find((page) => page.id === resolved.page) ?? visiblePages.find((page) => page.id === DEFAULT_SETTINGS_PAGE_ID) ?? visiblePages[0] ?? null);
  const activeId = ownPage?.id ?? frameworkPage?.id ?? null;
  const routeSub = ownPage ? null : resolved.sub;

  const navigate = useCallback(
    (page: string, sub?: string | null, options?: { replace?: boolean; anchor?: string | null }) => {
      void routerNavigate(`${settingsPagePath(page, sub)}${options?.anchor ? `#${options.anchor}` : ""}`, { replace: options?.replace });
    },
    [routerNavigate],
  );

  // Pages put their title and header button here (the framework's contract).
  const [header, setHeader] = useState<SettingsPageHeader | null>(null);
  useEffect(() => setHeader(null), [activeId, routeSub]);
  const shellContext = useMemo(() => ({ route: { page: activeId, sub: routeSub }, navigate, setHeader }), [activeId, navigate, routeSub]);

  // A link to a section inside a page (#anchor) scrolls there once the page has drawn.
  useEffect(() => {
    const anchor = location.hash.slice(1);
    if (!anchor) return;
    const timer = window.setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ block: "start" }), 250);
    return () => window.clearTimeout(timer);
  }, [location.hash, activeId]);

  // ── Navigation, in our groups ─────────────────────────────────────────────
  const labelOf = useCallback((page: SettingsPageDefinition) => LABELS[page.id] ?? (page.labelKey ? t(page.labelKey) : (page.label ?? page.id)), [t]);
  const groups = useMemo(() => {
    const entries = new Map<string, NavEntry>();
    for (const page of OWN_PAGES) entries.set(page.id, { id: page.id, label: page.label, icon: page.icon });
    for (const page of visiblePages) if (!entries.has(page.id)) entries.set(page.id, { id: page.id, label: labelOf(page), icon: page.icon });
    const placed = new Set<string>();
    const build = (group: { id: string; label: string; pages: readonly string[] }) => ({
      id: group.id,
      label: group.label,
      items: group.pages.flatMap((id) => {
        const entry = entries.get(id);
        if (!entry) return [];
        placed.add(id);
        return [entry];
      }),
    });
    const main = GROUPS.map(build);
    const last = build(LAST_GROUP);
    const advanced = { id: "advanced", label: "Advanced", items: [...entries.values()].filter((entry) => !placed.has(entry.id)) };
    return [...main, advanced, last].filter((group) => group.items.length > 0);
  }, [labelOf, visiblePages]);

  const activeLabel = ownPage?.label ?? (frameworkPage ? labelOf(frameworkPage) : "Settings");
  const subpage = routeSub && frameworkPage ? frameworkPage.subpages?.find((entry) => entry.id === routeSub) : undefined;
  const title = header?.title ?? (subpage ? (subpage.labelKey ? t(subpage.labelKey) : subpage.label) : activeLabel);
  const Page = frameworkPage?.component;
  const PrimaryAction = frameworkPage?.primaryAction;
  const pageProps = frameworkPage ? { pageId: frameworkPage.id, sub: routeSub, context, bridge } : null;
  const Own = ownPage?.component;

  const nav = (
    <nav aria-label="Settings" className="flex flex-col gap-5">
      {groups.map((group) => (
        <section key={group.id} aria-label={group.label} className="flex flex-col gap-0.5">
          <h2 className="ds-overline px-2.5 pb-1 text-ds-text-3">{group.label}</h2>
          {group.items.map((item) => {
            const active = !atIndex && item.id === activeId;
            return (
              <Link
                key={item.id}
                to={settingsPagePath(item.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "pc-press flex min-h-11 items-center gap-2.5 rounded-ds-md px-2.5 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ds-accent md:min-h-9 md:text-[13px]",
                  active ? "bg-ds-surface-2 font-medium text-ds-text" : "text-ds-text-2 hover:bg-ds-surface-2 hover:text-ds-text",
                  // On wider screens the first page is open beside a bare /settings, so it reads as selected.
                  atIndex && item.id === activeId && "md:bg-ds-surface-2 md:font-medium md:text-ds-text",
                )}
              >
                <item.icon className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <IconChevronRight className="size-4 shrink-0 text-ds-text-3 md:hidden" aria-hidden />
              </Link>
            );
          })}
        </section>
      ))}
    </nav>
  );

  return (
    <SettingsShellProvider value={shellContext}>
      <div data-settings-shell="" className="mx-auto flex min-h-full w-full max-w-6xl">
        <aside className={cn("w-full shrink-0 flex-col px-4 pb-10 pt-5 md:sticky md:top-0 md:flex md:max-h-dvh md:w-60 md:overflow-y-auto md:border-e md:border-ds-border md:px-3 md:pt-8", atIndex ? "flex" : "hidden")}>
          <h1 className="ds-title px-2.5 pb-4 text-ds-text sm:text-2xl md:text-lg">Settings</h1>
          {nav}
        </aside>

        <div className={cn("min-w-0 flex-1 md:block", atIndex ? "hidden" : "block")}>
          <Link to="/settings" className="pc-press mx-2 mt-3 inline-flex min-h-11 items-center gap-1 rounded-ds-md px-2 text-[14px] font-medium text-ds-text-2 outline-none hover:text-ds-text focus-visible:ring-2 focus-visible:ring-ds-accent md:hidden">
            <IconChevronLeft className="size-4" aria-hidden /> Settings
          </Link>
          {Own ? (
            <Own />
          ) : (
            <div className="mx-auto w-full max-w-[824px] px-4 pb-28 pt-2 md:px-8 md:pt-8">
              <header className="flex min-h-10 flex-wrap items-center gap-2 pb-4">
                {routeSub && frameworkPage ? (
                  <Link to={settingsPagePath(frameworkPage.id)} className="text-[15px] text-ds-text-2 underline-offset-2 hover:text-ds-text hover:underline">
                    {activeLabel}
                  </Link>
                ) : null}
                {routeSub && frameworkPage ? <IconChevronRight className="size-4 text-ds-text-3" aria-hidden /> : null}
                <h1 className="ds-title min-w-0 truncate text-ds-text sm:text-2xl">{title}</h1>
                {header?.badge ? <span className="flex shrink-0 items-center">{header.badge}</span> : null}
                <div className="ms-auto flex shrink-0 items-center gap-2">{header?.action ?? (PrimaryAction && pageProps ? <PrimaryAction {...pageProps} /> : null)}</div>
              </header>
              {Page && pageProps ? (
                <Suspense fallback={<SettingsSkeleton lines={3} />}>
                  <Page key={frameworkPage?.id} {...pageProps} />
                </Suspense>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </SettingsShellProvider>
  );
}
