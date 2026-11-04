import { defineAgentNativeConfig } from "@agent-native/core/config";

export default defineAgentNativeConfig({
  changelog: { enabled: false },
  // The hosted tools-only harness needs node-pty; Proofcut's agent runs through
  // the app's own actions, so it stays off.
  harness: false,
});
