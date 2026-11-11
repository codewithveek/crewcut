import { useT } from "@agent-native/core/client/i18n";
import {
  HeaderActionsProvider,
  useHeaderActions,
  useHeaderTitle,
} from "@agent-native/toolkit/app-shell/header-actions";
import {
  isAgentChatHomeHandoffActive,
  useAgentChatHomeHandoff,
  useAgentChatHomeHandoffLinks,
} from "@agent-native/toolkit/app/chat/agentkit-chat/rail";
import {
  RealtimeVoiceModeProvider,
  useRealtimeVoiceModeOptional,
} from "@agent-native/toolkit/app/chat/composer";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { APP_TITLE } from "@/lib/app-config";
import { HOME_PATH, isChatPathname } from "@/lib/chat-paths";
import { TAB_ID } from "@/lib/tab-id";
import { cn } from "@/lib/utils";

// Not lazy() like Header: the inspector wraps the page, so a Suspense fallback
// would mount the page once before its chunk loads and again after.
// AgentSidebar already lazy-loads its own panel.
import { AgentInspector } from "./AgentInspector";
import { AutopilotWatchdog } from "@/components/crewcut/autopilot/autopilot";
import { UpgradeDialogHost } from "@/components/crewcut/billing/upgrade";

import { AppRail } from "./AppRail";
import { MobileAppBar } from "./MobileAppBar";
import { MobileNav } from "./MobileNav";
import { isEditorPath, isCrewcutPage } from "./nav-items";
import { ChatHistoryPanel, MobileNavigationPanel } from "./Sidebar";

const Header = lazy(() =>
  import("./Header").then((module) => ({ default: module.Header })),
);

interface LayoutProps {
  children: React.ReactNode;
}

function routeOwnsToolbar(pathname: string): boolean {
  return (
    pathname === HOME_PATH ||
    isChatPathname(pathname) ||
    pathname === "/database" ||
    pathname.startsWith("/extensions") ||
    // Crewcut pages draw their own headers (the editor owns the whole canvas).
    isCrewcutPage(pathname) ||
    isEditorPath(pathname)
  );
}

/**
 * A voice chat follows the user into a chat thread, so Get started can hand
 * one off. Other pages show no controls for this session, so any other
 * navigation ends it rather than leave the microphone open with nothing to
 * stop it. The agent sidebar owns a separate session and keeps its own
 * controls on screen, so this leaves that one alone.
 */
function EndVoiceChatOutsideChat() {
  const { pathname } = useLocation();
  const end = useRealtimeVoiceModeOptional()?.end;
  const previousPathnameRef = useRef(pathname);

  useEffect(() => {
    if (previousPathnameRef.current === pathname) return;
    previousPathnameRef.current = pathname;
    if (!isChatPathname(pathname)) end?.();
  }, [end, pathname]);

  return null;
}

export function Layout({ children }: LayoutProps) {
  return (
    <RealtimeVoiceModeProvider browserTabId={TAB_ID}>
      <EndVoiceChatOutsideChat />
      {/* Autopilot: resumes stalled runs and says when a video is ready, on any page. */}
      <AutopilotWatchdog />
      {/* One upgrade dialog for the whole app: any paid feature opens it with its own headline. */}
      <UpgradeDialogHost />
      <LayoutShell>{children}</LayoutShell>
    </RealtimeVoiceModeProvider>
  );
}

function LayoutShell({ children }: LayoutProps) {
  const location = useLocation();
  const t = useT();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const isChatRoute = isChatPathname(location.pathname);
  // Settings is a Crewcut page like any other now (components/crewcut/settings):
  // it keeps the app's rail and phone navigation instead of taking the whole screen.
  const settingsOwnsChrome = false;
  const chatHomeHandoffActive = useAgentChatHomeHandoff({
    storageKey: "chat",
    activePath: location.pathname,
    enabled: !isChatRoute,
  });
  const chatHomeHandoffPending = isAgentChatHomeHandoffActive("chat");
  useAgentChatHomeHandoffLinks({
    storageKey: "chat",
    isChatPath: isChatPathname,
    requireActiveHandoff: true,
  });

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const closeMobileSidebar = () => setMobileSidebarOpen(false);
    window.addEventListener("agent-chat:open-thread", closeMobileSidebar);
    return () => {
      window.removeEventListener("agent-chat:open-thread", closeMobileSidebar);
    };
  }, []);

  const pageTitle = useHeaderTitle();
  const pageActions = useHeaderActions();
  // Until the chat route publishes its title and toolbar here, the AgentKit
  // header must stay visible on phones or the thread loses both.
  const chatHeaderInAppBar =
    isChatRoute && (pageTitle != null || pageActions != null);
  const openMobileSidebar = () => setMobileSidebarOpen(true);
  const ownsToolbar = routeOwnsToolbar(location.pathname);
  const editorRoute = isEditorPath(location.pathname);
  // Phones: Crewcut pages get the bottom nav; the editor gets neither bar.
  const showMobileNav = isCrewcutPage(location.pathname);
  const showMobileAppBar = isChatRoute || (ownsToolbar && !showMobileNav && !editorRoute);
  const contentFrame = (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      {isChatRoute ? (
        <MobileAppBar
          className="md:hidden"
          onOpenNavigation={openMobileSidebar}
          title={pageTitle ?? APP_TITLE}
          actions={pageActions}
        />
      ) : ownsToolbar ? (
        showMobileAppBar ? (
          <MobileAppBar
            className="md:hidden"
            onOpenNavigation={openMobileSidebar}
          />
        ) : null
      ) : settingsOwnsChrome ? null : (
        <Suspense fallback={<div className="h-12 shrink-0" />}>
          <Header onOpenMobileSidebar={openMobileSidebar} />
        </Suspense>
      )}
      <main
        className={cn(
          "agent-native-app-main min-w-0 flex-1 overflow-y-auto overscroll-contain",
          showMobileNav &&
            "max-md:pb-[calc(84px+env(safe-area-inset-bottom))]",
        )}
      >
        {children}
      </main>
      {showMobileNav ? <MobileNav /> : null}
    </div>
  );

  return (
    <HeaderActionsProvider>
      <div className="agent-layout-shell chat-layout-shell flex h-screen w-full overflow-hidden bg-background text-foreground">
        {settingsOwnsChrome ? null : (
          // The editor owns the canvas below 1280px (it has its own back button).
          <div
            className={cn(
              "hidden h-full shrink-0 md:flex",
              editorRoute && "md:hidden xl:flex",
            )}
          >
            <AppRail />
            {isChatRoute ? <ChatHistoryPanel /> : null}
          </div>
        )}
        <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
          <SheetContent
            side="left"
            className="w-[var(--chat-sidebar-width)] p-0"
          >
            <SheetTitle className="sr-only">
              {t("navigation.navigation")}
            </SheetTitle>
            <SheetDescription className="sr-only">
              {t("navigation.navigationDescription")}
            </SheetDescription>
            <MobileNavigationPanel />
          </SheetContent>
        </Sheet>
        {isChatRoute ? (
          <div
            data-agent-chat-canvas="true"
            data-chat-header-in-app-bar={
              chatHeaderInAppBar ? "true" : undefined
            }
            className="agent-layout-main-surface flex min-w-0 flex-1 overflow-hidden"
          >
            {contentFrame}
          </div>
        ) : (
          <AgentInspector
            chatHomeHandoffActive={chatHomeHandoffActive}
            chatHomeHandoffPending={chatHomeHandoffPending}
            enabled={!editorRoute}
          >
            {contentFrame}
          </AgentInspector>
        )}
      </div>
    </HeaderActionsProvider>
  );
}
