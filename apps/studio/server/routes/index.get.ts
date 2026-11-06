import { createH3SSRHandler } from "@agent-native/core/server/ssr-handler";

// "/" itself: the catch-all [...page] route doesn't match the bare root, and
// with rootAuth off the root renders the landing page like any other page.
export default createH3SSRHandler(
  () => import("virtual:react-router/server-build"),
);
