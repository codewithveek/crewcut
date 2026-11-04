import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/render-worker/src/**/*.test.ts"],
    environment: "node",
  },
});
