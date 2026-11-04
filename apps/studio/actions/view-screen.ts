import { defineAction } from "@agent-native/core/action";
import { readAppState, readAppStateForCurrentTab } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description:
    "Read what the person is looking at: the current view and video, and in the editor the selected clips/layers, the playhead time, the in/out range and the visible tracks. Use it so requests like 'tighten this' need no explanation of where.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async () => {
    const [navigation, editor] = await Promise.all([
      readAppState("navigation"),
      readAppStateForCurrentTab("editor-selection", { fallbackToGlobal: true }),
    ]);
    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;
    if (editor) screen.editor = editor;
    if (Object.keys(screen).length === 0) return "No application state found. Is the app open?";
    return screen;
  },
});
