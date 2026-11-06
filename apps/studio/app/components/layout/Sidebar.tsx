import { appPath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import {
  navigateWithAgentChatViewTransition,
  useAgentChatRunningThreads,
  useChatThreads,
} from "@agent-native/toolkit/app/chat/agentkit-chat/rail";
import {
  ownDraftRows,
  OwnershipChatHistoryRail,
  useOwnershipChatHistory,
} from "@agent-native/toolkit/app/chat/ownership-history";
import { openCommandMenu } from "@agent-native/toolkit/app/shared";
import { IconEdit, IconLoader2, IconMoon, IconSearch, IconSun } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import { CrewcutMark } from "@/components/crewcut/primitives";
import { APP_TITLE } from "@/lib/app-config";
import { chatThreadPath, threadIdFromPath } from "@/lib/chat-paths";
import { cn } from "@/lib/utils";

import { PRIMARY_NAV, SECONDARY_NAV, useThemeToggle } from "./nav-items";

const CHAT_STORAGE_KEY = "chat";
const CHAT_ACTIVE_THREAD_KEY = `agent-chat-active-thread:${CHAT_STORAGE_KEY}`;

function ThreadHistoryTitle({
  title,
  running,
}: {
  title: string;
  running: boolean;
}) {
  const t = useT();
  const viewportRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    const measure = () => {
      const overflow = Math.max(0, content.scrollWidth - viewport.clientWidth);
      const overflowing = overflow > 1;
      setIsOverflowing(overflowing);
      content.style.setProperty("--chat-sidebar-title-shift", `${overflow}px`);
      content.style.setProperty(
        "--chat-sidebar-title-duration",
        `${Math.max(1800, overflow * 24)}ms`,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(content);
    measure();
    return () => observer.disconnect();
  }, [title]);

  return (
    <span className="chat-sidebar-thread-title-shell">
      <span
        ref={viewportRef}
        className="chat-sidebar-thread-title"
        data-overflow={isOverflowing ? "true" : "false"}
      >
        <span ref={contentRef} className="chat-sidebar-thread-title__content">
          {title}
        </span>
      </span>
      {running ? (
        <IconLoader2
          className="chat-sidebar-thread-running size-4 shrink-0 motion-safe:animate-spin"
          strokeWidth={1.8}
          role="status"
          aria-label={t(
            // i18n-key-ignore shared framework catalog
            "agentChat.status.working",
          )}
        />
      ) : null}
    </span>
  );
}

function persistedActiveThreadId() {
  try {
    return localStorage.getItem(CHAT_ACTIVE_THREAD_KEY);
  } catch {
    return null;
  }
}

function persistActiveThreadId(threadId: string) {
  try {
    localStorage.setItem(CHAT_ACTIVE_THREAD_KEY, threadId);
  } catch {}
}

function ChatThreadsSection() {
  const navigate = useNavigate();
  const location = useLocation();
  const t = useT();
  const {
    threads,
    activeThreadId,
    createThread,
    switchThread,
    pinThread,
    archiveThread,
    renameThread,
    isNewThread,
  } = useChatThreads(undefined, CHAT_STORAGE_KEY, undefined, {
    autoCreate: false,
    restoreActiveThread: false,
  });
  const { workingThreadIds, observedThreadStarts } =
    useAgentChatRunningThreads();

  const localMineRows = ownDraftRows({
    threads,
    isNewThread,
    observedThreadStarts,
  });
  const history = useOwnershipChatHistory({
    getThreadUrl: (threadId) => appPath(chatThreadPath(threadId)),
    activeId:
      threadIdFromPath(location.pathname) ??
      activeThreadId ??
      persistedActiveThreadId(),
    localMineRows,
    pinned: { label: t("chat.pinned") },
    mutations: {
      pin: pinThread,
      rename: renameThread,
      archive: archiveThread,
    },
    onMutationFailed: (kind) => {
      if (kind === "archive") toast.error(t("chat.archiveFailed"));
      if (kind === "rename") toast.error(t("chat.renameFailed"));
    },
    decorateItem: (item, row) => {
      const title = row.title || row.preview || t("chat.untitledChat");
      return {
        ...item,
        title: (
          <ThreadHistoryTitle
            title={title}
            running={workingThreadIds.has(row.id)}
          />
        ),
      };
    },
  });
  const displayedActiveThreadId =
    threadIdFromPath(location.pathname) ??
    activeThreadId ??
    persistedActiveThreadId();

  function openThread(threadId: string, options?: { isNew?: boolean }) {
    switchThread(threadId);
    persistActiveThreadId(threadId);
    if (options?.isNew) {
      window.dispatchEvent(
        new CustomEvent("agent-chat:open-thread", {
          detail: { threadId, newThread: true },
        }),
      );
    }
    navigateWithAgentChatViewTransition(navigate, chatThreadPath(threadId));
    if (options?.isNew) return;
    window.requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent("agent-chat:open-thread", {
          detail: { threadId, newThread: false },
        }),
      );
    });
  }

  async function handleNewChat() {
    const threadId = await createThread();
    if (threadId) openThread(threadId, { isNew: true });
  }

  const newChatButton = (
    <button
      type="button"
      onClick={() => void handleNewChat()}
      className="pc-press flex h-9 w-full items-center gap-3 rounded-ds-sm px-3 text-sm font-medium text-ds-text outline-none hover:bg-ds-surface-3 focus-visible:ring-2 focus-visible:ring-ds-accent"
    >
      <IconEdit className="size-4 shrink-0" strokeWidth={1.8} />
      <span className="truncate">{t("chat.newChat")}</span>
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-2 pb-3">{newChatButton}</div>
      <OwnershipChatHistoryRail
        {...history}
        onNewChat={() => void handleNewChat()}
        showNewChat={false}
        activeId={displayedActiveThreadId}
        onSelect={openThread}
        onDelete={async (threadId) => {
          const wasActive =
            threadId === activeThreadId ||
            threadId === persistedActiveThreadId();
          const archived = await history.listProps.onDelete?.(threadId);
          if (archived && wasActive) await handleNewChat();
        }}
        renameMaxLength={160}
        labels={{
          options: (item) =>
            t("chat.optionsFor", { title: item.titleText ?? "" }),
          renameInput: (item) =>
            t("chat.renameThread", { title: item.titleText ?? "" }),
          rename: t("chat.renameChat"),
          pin: t("chat.pinChat"),
          unpin: t("chat.unpinChat"),
          delete: t("chat.archiveChat"),
        }}
        railLabels={{
          newChat: t("chat.newChat"),
        }}
        className="chat-sidebar-history min-h-0 flex-1"
        listClassName="pb-4"
      />
    </div>
  );
}

/** Chat history beside the rail on chat routes (desktop/tablet). */
export function ChatHistoryPanel() {
  const t = useT();
  return (
    <aside className="flex h-full w-[264px] shrink-0 flex-col border-e border-ds-border bg-sidebar text-sidebar-foreground" aria-label={t("navigation.navigation")}>
      <div className="flex h-14 shrink-0 items-center gap-2 px-4">
        <span className="ds-heading min-w-0 flex-1 truncate text-ds-text">Chats</span>
        <button
          type="button"
          onClick={openCommandMenu}
          aria-label={t("root.commandSearch")}
          title={t("root.commandSearch")}
          className="pc-press flex size-8 items-center justify-center rounded-ds-sm text-ds-text-2 outline-none hover:bg-ds-surface-3 hover:text-ds-text focus-visible:ring-2 focus-visible:ring-ds-accent"
        >
          <IconSearch className="size-4" strokeWidth={1.8} />
        </button>
      </div>
      <ChatThreadsSection />
    </aside>
  );
}

/** The phone navigation sheet (chat and framework routes): destinations + chat history. */
export function MobileNavigationPanel() {
  const location = useLocation();
  const theme = useThemeToggle();
  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <div className="flex h-14 shrink-0 items-center gap-3 px-4">
        <CrewcutMark motion="intro" hover className="size-7" />
        <span className="ds-heading text-ds-text">{APP_TITLE}</span>
      </div>
      <nav className="grid shrink-0 grid-cols-4 gap-1 px-2 pb-3" aria-label="Main">
        {[...PRIMARY_NAV, ...SECONDARY_NAV].map((item) => {
          const active = item.match(location.pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? "page" : undefined}
              className={cn(
                "pc-press flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-ds-md text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ds-accent [&_svg]:size-5",
                active ? "bg-ds-surface-3 text-ds-text" : "text-ds-text-2",
              )}
            >
              <Icon strokeWidth={1.8} />
              <span className="max-w-full truncate px-1">{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={theme.toggle}
          className="pc-press flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-ds-md text-[11px] font-medium text-ds-text-2 outline-none focus-visible:ring-2 focus-visible:ring-ds-accent [&_svg]:size-5"
        >
          {theme.dark ? <IconSun strokeWidth={1.8} /> : <IconMoon strokeWidth={1.8} />}
          <span>{theme.dark ? "Light" : "Dark"}</span>
        </button>
      </nav>
      <div className="flex min-h-0 flex-1 flex-col border-t border-ds-border pt-3">
        <ChatThreadsSection />
      </div>
    </div>
  );
}
