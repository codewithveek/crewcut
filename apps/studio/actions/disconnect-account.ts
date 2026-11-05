import { defineAction } from "@agent-native/core/action";
import { revokeTokens } from "@crewcut/distribute";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireHuman } from "../server/lib/identity.js";
import { credentialVault } from "../server/lib/vault.js";

export default defineAction({
  description: "Disconnect an account (people only): revokes the token at the provider and deletes it from the vault.",
  schema: z.object({ connectionId: z.string() }),
  agentTool: false,
  uiOnly: true,
  toolCallable: false,
  needsApproval: true,
  run: async ({ connectionId }, ctx) => {
    const who = requireHuman(ctx, "Disconnecting an account");
    const db = getDb();
    const [row] = await db
      .select()
      .from(schema.connections)
      .where(and(eq(schema.connections.id, connectionId), eq(schema.connections.ownerEmail, who.email)))
      .limit(1);
    if (!row) throw new Error("No such connection.");
    const result = await revokeTokens(credentialVault({ userEmail: who.email, orgId: who.orgId }), row.vaultKey, "youtube");
    await db.delete(schema.connections).where(eq(schema.connections.id, connectionId));
    return { disconnected: row.accountName, revokedAtProvider: result.revokedRemotely };
  },
});
