import { deleteCredential, resolveCredential, saveCredential } from "@agent-native/core/credentials";
import type { OAuthClient, TokenSet, TokenVault } from "@proofcut/distribute";

/**
 * OAuth tokens live in Agent-Native's encrypted credential vault (AES-256-GCM),
 * scoped to the person — never in the connections table, never in logs.
 */
export function credentialVault(context: { userEmail: string; orgId: string | null }): TokenVault {
  const ctx = { userEmail: context.userEmail, ...(context.orgId ? { orgId: context.orgId } : {}) };
  return {
    async get(key) {
      const raw = await resolveCredential(key, ctx);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as TokenSet;
      } catch {
        return null;
      }
    },
    async set(key, tokens) {
      await saveCredential(key, JSON.stringify(tokens), { ...ctx, scope: "user" });
    },
    async delete(key) {
      await deleteCredential(key, { ...ctx, scope: "user" });
    },
  };
}

/** The app's Google OAuth client is deploy-level configuration, not a user secret. */
export function youtubeOAuthClient(origin: string): OAuthClient | null {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  if (!clientId) return null;
  return {
    clientId,
    ...(process.env.YOUTUBE_CLIENT_SECRET ? { clientSecret: process.env.YOUTUBE_CLIENT_SECRET } : {}),
    redirectUri: process.env.YOUTUBE_REDIRECT_URI ?? `${origin.replace(/\/$/, "")}/api/connections/youtube/callback`,
  };
}

export function oauthStateSecret(): string {
  const secret = process.env.OAUTH_STATE_SECRET ?? process.env.BETTER_AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("Set OAUTH_STATE_SECRET to connect accounts.");
  return "proofcut-dev-oauth-state-secret-change-me";
}

export function appOrigin(): string {
  return process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? `http://localhost:${process.env.PORT ?? "8080"}`;
}
