import { defineAction } from "@agent-native/core/action";
import { deleteCredential, saveCredential } from "@agent-native/core/credentials";
import { z } from "zod";

import { UserError } from "../server/lib/errors.js";
import { requireHuman } from "../server/lib/identity.js";

/**
 * A person's own key for a service that isn't one of the model providers
 * (those are saved through the model settings): today, ElevenLabs for
 * voice-overs. The key is checked with the service before it's stored, saved
 * encrypted for that person only, and never returned.
 */
const SERVICES = {
  elevenlabs: {
    key: "ELEVENLABS_API_KEY",
    name: "ElevenLabs",
    check: async (value: string): Promise<boolean | null> => {
      try {
        const response = await fetch("https://api.elevenlabs.io/v1/voices?page_size=1", { headers: { "xi-api-key": value, accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
        if (response.status === 401 || response.status === 403) return false;
        return response.ok ? true : null;
      } catch {
        return null; // couldn't reach the service: not the key's fault
      }
    },
  },
} as const;

export default defineAction({
  description: "Save or remove the person's own key for a voice service (people only). Leave value out to remove the saved key.",
  schema: z.object({
    service: z.enum(["elevenlabs"]),
    value: z.string().trim().min(8).max(400).optional(),
  }),
  uiOnly: true,
  agentTool: false,
  toolCallable: false,
  run: async ({ service, value }, ctx) => {
    const who = requireHuman(ctx, "Saving a key");
    const entry = SERVICES[service];
    const scope = { userEmail: who.email, ...(who.orgId ? { orgId: who.orgId } : {}), scope: "user" as const };
    if (!value) {
      await deleteCredential(entry.key, scope);
      return { service, saved: false };
    }
    const valid = await entry.check(value);
    if (valid === false) throw new UserError(`${entry.name} didn't accept that key. Copy it again from your ${entry.name} account and try once more.`);
    if (valid === null) throw new UserError(`Couldn't reach ${entry.name} to check the key. Try again in a minute.`);
    await saveCredential(entry.key, value, scope);
    return { service, saved: true };
  },
});
