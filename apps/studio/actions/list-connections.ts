import { defineAction } from "@agent-native/core/action";
import { hasCredential } from "@agent-native/core/credentials";
import { PLATFORM_SPECS } from "@crewcut/contracts";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { gatewayConfig } from "../server/lib/ai/gateway.js";
import { availableModels } from "../server/lib/ai/models.js";
import { accessContext, identity } from "../server/lib/identity.js";
import { voiceOperatorKey } from "../server/lib/voice-billing.js";

/** Providers people can bring their own key for. Their key goes straight to the provider and costs no credits. */
const OWN_KEY_PROVIDERS = [
  { id: "anthropic", kind: "model", name: "Anthropic (Claude)", key: "ANTHROPIC_API_KEY", note: "Claude models for the crew." },
  { id: "openai", kind: "model", name: "OpenAI", key: "OPENAI_API_KEY", note: "GPT models for the crew." },
  { id: "google", kind: "model", name: "Google (Gemini)", key: "GOOGLE_GENERATIVE_AI_API_KEY", note: "Gemini models for the crew." },
  { id: "openrouter", kind: "model", name: "OpenRouter", key: "OPENROUTER_API_KEY", note: "Hundreds of models through one key." },
  { id: "groq", kind: "model", name: "Groq", key: "GROQ_API_KEY", note: "Fast open models." },
  { id: "mistral", kind: "model", name: "Mistral", key: "MISTRAL_API_KEY", note: "Mistral models for the crew." },
  { id: "cohere", kind: "model", name: "Cohere", key: "COHERE_API_KEY", note: "Command models for the crew." },
  { id: "elevenlabs", kind: "voice", name: "ElevenLabs voice", key: "ELEVENLABS_API_KEY", note: "Realistic AI voice-overs." },
] as const;

export default defineAction({
  description:
    "List connected accounts (health, scopes, last use; never secrets), each AI provider with whether the person saved their own key, whether Crewcut AI (Crewcut's own models and voice, paid with credits) is available, and each platform's audit and quota notes.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => {
    const who = identity(ctx);
    const rows = await getDb().select().from(schema.connections).where(eq(schema.connections.ownerEmail, who.email));
    const credentialCtx = accessContext(who);
    // Only keys the person (or their organisation) saved count: Crewcut's own server keys are Crewcut AI, not theirs.
    const own = await Promise.all(OWN_KEY_PROVIDERS.map((provider) => hasCredential(provider.key, credentialCtx).catch(() => false)));
    const crewcutModels = gatewayConfig() ? availableModels() : [];
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
      providers: OWN_KEY_PROVIDERS.map((provider, index) => ({ ...provider, ownKey: own[index] ?? false })),
      crewcutAi: { models: crewcutModels.length > 0, voice: Boolean(voiceOperatorKey()) },
    };
  },
});
