import {
  IconApps,
  IconFolder,
  IconHome,
  IconMessageCircle,
  IconPhoto,
  IconPlugConnected,
  IconSettings,
  IconShieldCheck,
  IconTemplate,
} from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { HOME_PATH, NEW_CHAT_PATH, isChatPathname } from "@/lib/chat-paths";

export interface NavItem {
  to: string;
  label: string;
  /** Longer name for the phone "More" sheet and screen readers. */
  title: string;
  icon: typeof IconHome;
  match: (pathname: string) => boolean;
}

export const PRIMARY_NAV: readonly NavItem[] = [
  { to: HOME_PATH, label: "Home", title: "Home", icon: IconHome, match: (path) => path === HOME_PATH || path === "/" },
  { to: "/projects", label: "Projects", title: "Projects", icon: IconFolder, match: (path) => path.startsWith("/projects") || path.startsWith("/videos/") },
  { to: "/templates", label: "Templates", title: "Templates", icon: IconTemplate, match: (path) => path.startsWith("/templates") },
  { to: "/assets", label: "Assets", title: "Assets", icon: IconPhoto, match: (path) => path.startsWith("/assets") },
  { to: NEW_CHAT_PATH, label: "Chats", title: "Chats with the agent", icon: IconMessageCircle, match: isChatPathname },
  { to: "/connections", label: "Connect", title: "Connections", icon: IconPlugConnected, match: (path) => path.startsWith("/connections") },
  { to: "/extensions", label: "Mini-apps", title: "Mini-apps", icon: IconApps, match: (path) => path.startsWith("/extensions") },
];

export const SECONDARY_NAV: readonly NavItem[] = [
  { to: "/settings", label: "Settings", title: "Settings", icon: IconSettings, match: (path) => path.startsWith("/settings") || path.startsWith("/team") },
];

/** Shown only to catalog admins (see useCatalogAccess). */
export const ADMIN_NAV: NavItem = { to: "/admin", label: "Admin", title: "Catalog admin", icon: IconShieldCheck, match: (path) => path.startsWith("/admin") };

export function isEditorPath(pathname: string): boolean {
  return /^\/videos\/[^/]+\/edit/.test(pathname);
}

/** Crewcut's own pages: they draw their own headers and get the phone bottom nav. */
export function isCrewcutPage(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === HOME_PATH ||
    pathname.startsWith("/projects") ||
    pathname.startsWith("/assets") ||
    pathname.startsWith("/templates") ||
    pathname.startsWith("/design") ||
    pathname.startsWith("/connections") ||
    pathname.startsWith("/admin") ||
    (pathname.startsWith("/videos/") && !isEditorPath(pathname))
  );
}

/** Light/dark toggle that renders nothing theme-dependent until mounted (no hydration mismatch). */
export function useThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  return { mounted, dark, toggle: () => setTheme(dark ? "light" : "dark"), setTheme };
}
