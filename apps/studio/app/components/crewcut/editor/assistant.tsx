import { navigateWithAgentChatViewTransition, sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { AgentPanel } from "@agent-native/toolkit/app/chat";
import { useNavigate } from "react-router";

import { chatThreadPath } from "@/lib/chat-paths";
import { TAB_ID } from "@/lib/tab-id";
import { cn } from "@/lib/utils";

import { selectionContext } from "./commands";
import { useEditor } from "./editor-store";

/**
 * The editor's Assistant tab hosts the app's real agent chat (Agent-Native's
 * AgentPanel, same "chat" thread history as the sidebar elsewhere). The
 * floating sidebar is switched off on the editor route, so exactly one chat
 * listens for prompts and replies, tool calls and approvals stay next to
 * the video.
 */

export const EDITOR_SUGGESTIONS = [
  "Tighten the selected clip",
  "Make the hook punchier",
  "Add captions from the narration",
  "Pick music that fits and lower it under the voice",
  "Try a different transition at the playhead",
  "Give this a warmer colour grade",
];

let ready = false;
const waiters: Array<() => void> = [];

function markReady(value: boolean): void {
  ready = value;
  if (value) waiters.splice(0).forEach((resolve) => resolve());
}

function whenReady(timeoutMs = 8000): Promise<void> {
  if (ready) return Promise.resolve();
  return new Promise((resolve) => {
    waiters.push(resolve);
    window.setTimeout(resolve, timeoutMs);
  });
}

/** Opens the Assistant (tab on desktop, sheet on phones) and sends the prompt with the editor selection attached. */
export async function askEditorAgent(message: string, context: Record<string, unknown> = selectionContext()): Promise<void> {
  const state = useEditor.getState();
  state.setRightTab("assistant");
  if (window.innerWidth < 1024) state.setAssistantOpen(true);
  await whenReady();
  sendToAgentChat({
    message,
    context: JSON.stringify(context),
    submit: true,
    openSidebar: false,
  } as Parameters<typeof sendToAgentChat>[0]);
}

export function EditorAssistant({ className }: { className?: string }) {
  const navigate = useNavigate();
  return (
    <div className={cn("pc-assistant flex min-h-0 flex-1 flex-col overflow-hidden", className)}>
      <AgentPanel
        storageKey="chat"
        browserTabId={TAB_ID}
        chatOnly
        showTabBar={false}
        emptyStateText="Ask for an edit. The agent sees your selection and the playhead, and every change is one step you can undo."
        composerPlaceholder="Describe a change, e.g. “slow the title in and add a whoosh on the cut”"
        suggestions={EDITOR_SUGGESTIONS}
        // Generic model-written starters ("summarize this recording") don't fit an editor.
        dynamicSuggestions={false}
        agentPageHref="/settings/agent"
        onReadyChange={markReady}
        onFullViewRequest={(threadId) => navigateWithAgentChatViewTransition(navigate, chatThreadPath(threadId))}
        className="min-h-0 flex-1"
      />
    </div>
  );
}
