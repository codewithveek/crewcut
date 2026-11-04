import { defineAction } from "@agent-native/core/action";
import { saveCredential } from "@agent-native/core/credentials";
import { buildAuthorizeUrl, pkcePair, randomToken, signState } from "@proofcut/distribute";
import { z } from "zod";

import { requireHuman } from "../server/lib/identity.js";
import { appOrigin, oauthStateSecret, youtubeOAuthClient } from "../server/lib/vault.js";

/** Origins allowed for the OAuth redirect: the configured app URL, or loopback in development. */
function allowedOrigin(origin: string | undefined): string {
  const configured = appOrigin();
  if (!origin) return configured;
  const url = new URL(origin);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (origin === configured || (loopback && process.env.NODE_ENV !== "production")) return url.origin;
  throw new Error("That origin isn't allowed for OAuth redirects.");
}

export default defineAction({
  description: "Start connecting a publishing account (people only). Returns the provider's consent URL; the browser goes there and comes back to Settings → Connections.",
  schema: z.object({
    provider: z.enum(["youtube"]),
    origin: z.string().url().optional(),
    returnTo: z.string().regex(/^\/(?!\/)/).default("/connections"),
  }),
  agentTool: false,
  uiOnly: true,
  toolCallable: false,
  run: async ({ origin, returnTo }, ctx) => {
    const who = requireHuman(ctx, "Connecting an account");
    const client = youtubeOAuthClient(allowedOrigin(origin));
    if (!client) {
      return { configured: false, message: "Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET (a Google Cloud OAuth client with the YouTube Data and Analytics APIs) to enable YouTube." };
    }
    const { verifier, challenge } = await pkcePair();
    const nonce = randomToken(16);
    // The PKCE verifier never leaves the server: it waits in the encrypted vault for the callback.
    await saveCredential(`proofcut_pkce_${nonce}`, verifier, { userEmail: who.email, ...(who.orgId ? { orgId: who.orgId } : {}), scope: "user" });
    const state = await signState(
      { provider: "youtube", ownerEmail: who.email, orgId: who.orgId, returnTo, nonce, expiresAt: Date.now() + 10 * 60 * 1000 },
      oauthStateSecret(),
    );
    const loginHint = who.email.endsWith("@localhost") ? {} : { loginHint: who.email };
    return { configured: true, url: buildAuthorizeUrl("youtube", client, { state, codeChallenge: challenge, ...loginHint }) };
  },
});
