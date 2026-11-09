import { deleteCredential, resolveCredential } from "@agent-native/core/credentials";
import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { YouTubeClient, exchangeCode, verifyState } from "@crewcut/distribute";
import { and, eq } from "drizzle-orm";
import { defineEventHandler, getQuery } from "h3";

import { getDb, schema } from "../../../../db/index.js";
import { planFor } from "../../../../lib/plan-limits.js";
import { newId } from "../../../../lib/storage.js";
import { appOrigin, credentialVault, oauthStateSecret, youtubeOAuthClient } from "../../../../lib/vault.js";

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

/** Google redirects here after consent. The same signed-in person must finish the flow they started. */
export default defineEventHandler(async (event) => {
  const query = getQuery(event) as { code?: string; state?: string; error?: string };
  if (query.error) return redirect(`/connections?error=${encodeURIComponent(query.error)}`);
  if (!query.code || !query.state) return redirect("/connections?error=missing_code");
  try {
    const payload = await verifyState(query.state, oauthStateSecret());
    const session = await getSession(event);
    const sessionEmail = session?.email ?? (process.env.NODE_ENV === "production" ? null : "local@localhost");
    if (!sessionEmail || sessionEmail !== payload.ownerEmail) throw new Error("This connection was started by a different account.");
    const ctx = { userEmail: payload.ownerEmail, ...(payload.orgId ? { orgId: payload.orgId } : {}) };
    const verifier = await resolveCredential(`crewcut_pkce_${payload.nonce}`, ctx);
    await deleteCredential(`crewcut_pkce_${payload.nonce}`, { ...ctx, scope: "user" }).catch(() => undefined);
    if (!verifier) throw new Error("The connection attempt expired. Start again.");
    const client = youtubeOAuthClient(appOrigin());
    if (!client) throw new Error("YouTube isn't configured.");

    const tokens = await exchangeCode("youtube", client, { code: query.code, codeVerifier: verifier });
    const channel = await new YouTubeClient({ getToken: async () => tokens.accessToken }).channel().catch(() => null);
    // Plans limit how many channels a workspace publishes to; reconnecting one already connected is always fine.
    const existing = await runWithRequestContext(ctx, () =>
      getDb().select({ accountId: schema.connections.accountId }).from(schema.connections).where(and(eq(schema.connections.ownerEmail, payload.ownerEmail), eq(schema.connections.provider, "youtube"))),
    );
    const channels = new Set(existing.map((row) => row.accountId).filter(Boolean));
    const plan = await planFor({ email: payload.ownerEmail, orgId: payload.orgId });
    if (channel?.id && !channels.has(channel.id) && channels.size >= plan.channels) {
      throw new Error(`${plan.name} publishes to ${plan.channels === 1 ? "one YouTube channel" : `${plan.channels} YouTube channels`}. Disconnect one first, or move to Studio for up to 5.`);
    }
    const connectionId = newId("con");
    const vaultKey = `crewcut_youtube_${connectionId}`;
    await credentialVault({ userEmail: payload.ownerEmail, orgId: payload.orgId }).set(vaultKey, tokens);
    await runWithRequestContext(ctx, () =>
      getDb()
      .insert(schema.connections)
      .values({
        id: connectionId,
        provider: "youtube",
        accountName: channel?.title ?? "YouTube channel",
        accountId: channel?.id ?? "",
        scopes: tokens.scope ?? "",
        status: channel ? "healthy" : "failed",
        statusDetail: channel ? (channel.handle ?? "") : "Connected, but no channel was found on this Google account.",
        vaultKey,
        ownerEmail: payload.ownerEmail,
        orgId: payload.orgId,
      }),
    );
    return redirect(`${payload.returnTo}?connected=youtube`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connection failed";
    return redirect(`/connections?error=${encodeURIComponent(message.slice(0, 200))}`);
  }
});
