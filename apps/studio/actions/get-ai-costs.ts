import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { aiCostReport } from "../server/lib/ai/costs.js";
import { requireAdmin } from "../server/lib/catalog.js";

export default defineAction({
  description:
    "Admins: what Crewcut AI and voice-overs cost over the last N days (default 30): Crewcut AI setup (gateway, providers, models and prices), totals by source (Crewcut AI vs people's own keys), by model, by pipeline stage, per video (with render time), and recent calls. Use it to set credit prices from measured runs.",
  schema: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ days }, ctx) => {
    requireAdmin(ctx);
    return aiCostReport(days);
  },
});
