import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { identity } from "../server/lib/identity.js";
import { nowIso } from "../server/lib/json.js";
import { youtubeClientFor } from "../server/lib/youtube.js";
import { UserError } from "../server/lib/errors.js";

export default defineAction({
  description: "Check a connection's health by refreshing its token and reading the channel.",
  schema: z.object({ connectionId: z.string() }),
  agentTool: false,
  run: async ({ connectionId }, ctx) => {
    const who = identity(ctx);
    const db = getDb();
    const [row] = await db
      .select()
      .from(schema.connections)
      .where(and(eq(schema.connections.id, connectionId), eq(schema.connections.ownerEmail, who.email)))
      .limit(1);
    if (!row) throw new UserError("No such connection.");
    try {
      const channel = await youtubeClientFor(row).channel();
      await db.update(schema.connections).set({ status: "healthy", statusDetail: channel.handle ?? "", accountName: channel.title, lastUsedAt: nowIso() }).where(eq(schema.connections.id, connectionId));
      return { status: "healthy", accountName: channel.title };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.update(schema.connections).set({ status: "failed", statusDetail: message.slice(0, 300) }).where(eq(schema.connections.id, connectionId));
      return { status: "failed", detail: message };
    }
  },
});
