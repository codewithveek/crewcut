import { defineAction } from "@agent-native/core/action";
import { hasCredential } from "@agent-native/core/credentials";
import { PLATFORM_SPECS } from "@crewcut/contracts";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { accessContext, identity } from "../server/lib/identity.js";

export default defineAction({
  description: "List connected accounts and AI providers with health, scopes and last use (never secrets), plus each platform's audit and quota notes.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => {
    const who = identity(ctx);
    const rows = await getDb().select().from(schema.connections).where(eq(schema.connections.ownerEmail, who.email));
    const credentialCtx = accessContext(who);
    const [elevenLabs, anthropic] = await Promise.all([
      hasCredential("ELEVENLABS_API_KEY", credentialCtx).catch(() => false),
      hasCredential("ANTHROPIC_API_KEY", credentialCtx).catch(() => false),
    ]);
    return {
      accounts: rows.map((row) => ({
        id: row.id,
        provider: row.provider,
        accountName: row.accountName,
        scopes: row.scopes.split(" ").filter(Boolean),
        status: row.status,
        statusDetail: row.statusDetail,
        lastUsedAt: row.lastUsedAt,
        createdAt: row.createdAt,
      })),
      platforms: Object.values(PLATFORM_SPECS).map((spec) => ({ id: spec.id, label: spec.label, supported: spec.supported, auditNote: spec.auditNote, limitNote: spec.limitNote })),
      youtubeConfigured: Boolean(process.env.YOUTUBE_CLIENT_ID),
      providers: {
        voice: { elevenlabs: elevenLabs || Boolean(process.env.ELEVENLABS_API_KEY) },
        model: { anthropic: anthropic || Boolean(process.env.ANTHROPIC_API_KEY) },
      },
    };
  },
});
