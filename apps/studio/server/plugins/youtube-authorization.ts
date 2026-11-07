import { runWithRequestContext } from "@agent-native/core/server";
import { OAuthError, getAccessToken } from "@crewcut/distribute";
import { eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { nowIso } from "../lib/json.js";
import { appOrigin, credentialVault, youtubeOAuthClient } from "../lib/vault.js";
import { deleteYoutubeData } from "../lib/youtube.js";

/**
 * YouTube API Services policy (III.D.2, III.E.4): confirm at least every 30
 * days that each connected channel still authorises Crewcut, and delete the
 * data stored from it within 30 days of the person revoking access in their
 * Google Account. The Privacy Policy promises both.
 *
 * Runs a few minutes after the server starts (the container sleeps when idle,
 * so every wake-up checks) and then daily. A forced token refresh asks Google
 * directly; only `invalid_grant` (revoked, or the grant expired) counts as
 * lost authorisation. Network or server errors change nothing and are retried
 * on the next run.
 */
const STARTUP_DELAY_MS = 3 * 60 * 1000;
const INTERVAL_MS = 24 * 60 * 60 * 1000;

let started = false;

export default function youtubeAuthorizationPlugin(): void {
  if (started || process.env.NODE_ENV !== "production") return;
  started = true;
  setTimeout(() => {
    void checkAll();
    setInterval(() => void checkAll(), INTERVAL_MS).unref?.();
  }, STARTUP_DELAY_MS).unref?.();
}

async function checkAll(): Promise<void> {
  const client = youtubeOAuthClient(appOrigin());
  if (!client) return;
  let rows: Array<typeof schema.connections.$inferSelect>;
  try {
    rows = await getDb().select().from(schema.connections).where(eq(schema.connections.provider, "youtube"));
  } catch (error) {
    console.error("[youtube-authorization] could not list connections:", error);
    return;
  }
  for (const row of rows) {
    const context = { userEmail: row.ownerEmail, ...(row.orgId ? { orgId: row.orgId } : {}) };
    try {
      await runWithRequestContext(context, async () => {
        const vault = credentialVault({ userEmail: row.ownerEmail, orgId: row.orgId });
        try {
          await getAccessToken(vault, row.vaultKey, "youtube", client, { force: true });
          await getDb().update(schema.connections).set({ status: "healthy", lastUsedAt: nowIso() }).where(eq(schema.connections.id, row.id));
        } catch (error) {
          const revoked = error instanceof OAuthError && (error.code === "not_connected" || /invalid_grant/.test(error.message));
          if (!revoked) throw error;
          // Access is gone: forget the tokens and everything read with them.
          await vault.delete(row.vaultKey).catch(() => undefined);
          await getDb().delete(schema.connections).where(eq(schema.connections.id, row.id));
          const videos = await deleteYoutubeData(row.ownerEmail);
          console.info(`[youtube-authorization] ${row.id}: access revoked; deleted the connection and figures for ${videos} video(s).`);
        }
      });
    } catch (error) {
      console.error(`[youtube-authorization] ${row.id}: check failed, will retry:`, error instanceof Error ? error.message : error);
    }
  }
}
