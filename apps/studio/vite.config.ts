import { agentNative } from "@agent-native/core/vite";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

const reactRouterPlugins = reactRouter as unknown as () => any[];
const agentNativePlugins = agentNative as unknown as (
  options?: Parameters<typeof agentNative>[0],
) => any[];
/**
 * Browser scripts get hash-only file names (assets/3fA9xQ2b.js). Ad and
 * cookie-banner blockers (Brave Shields, uBlock) block files named like
 * "analytics-*.js" or "builder-link-tracking-*.js", and the app's root bundle
 * imports both, so one blocked file stopped every page from starting.
 * Development serves source files by their real names and can't be fixed
 * this way: test with Shields off there.
 */
const blockerSafeFileNames = {
  name: "crewcut:blocker-safe-file-names",
  configEnvironment(name: string) {
    if (name !== "client") return;
    return { build: { rolldownOptions: { output: { entryFileNames: "assets/[hash].js", chunkFileNames: "assets/[hash].js" } } } };
  },
};

export default defineConfig({
  // The design checker rewrites its cache on every edit; don't reload open pages for it.
  server: { watch: { ignored: ["**/.impeccable/**", "**/storage/**", "**/data/**"] } },
  optimizeDeps: {
    entries: [
      "app/entry.client.tsx",
      "app/root.tsx",
      "app/components/layout/{Layout,Sidebar}.tsx",
      "app/components/chat/ChatRouteContent.tsx",
      "app/routes/{home,chat.$threadId}.tsx",
    ],
  },
  plugins: [
    blockerSafeFileNames,
    ...reactRouterPlugins(),
    ...agentNativePlugins({
      ssrStubs: ["shiki"],
      // Agent-Native loads undici with a computed import (its SSRF-safe fetch,
      // used for every bucket upload and link import), which the server
      // build can't see. It is resolved at runtime, so undici is also a direct
      // dependency in package.json: pnpm only links it into this app's
      // node_modules that way. Without it every upload fails in production
      // with "SSRF protection is unavailable". traceDeps keeps it if the build
      // ever copies its dependencies into .output.
      nitro: { traceDeps: ["undici"] },
    }),
  ],
});
