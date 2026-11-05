import { open, stat } from "node:fs/promises";

import { type VideoSource, YouTubeClient, getAccessToken } from "@crewcut/distribute";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { appOrigin, credentialVault, youtubeOAuthClient } from "./vault.js";

export type ConnectionRow = typeof schema.connections.$inferSelect;

export async function youtubeConnectionFor(ownerEmail: string): Promise<ConnectionRow | null> {
  const [row] = await getDb()
    .select()
    .from(schema.connections)
    .where(and(eq(schema.connections.ownerEmail, ownerEmail), eq(schema.connections.provider, "youtube")))
    .limit(1);
  return row && row.status !== "revoked" ? row : null;
}

export function youtubeClientFor(connection: ConnectionRow): YouTubeClient {
  const client = youtubeOAuthClient(appOrigin());
  if (!client) throw new Error("YouTube isn't configured on this deployment (set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET).");
  const vault = credentialVault({ userEmail: connection.ownerEmail, orgId: connection.orgId });
  return new YouTubeClient({
    getToken: async (force) => (await getAccessToken(vault, connection.vaultKey, "youtube", client, { force: Boolean(force) })).accessToken,
  });
}

/** Reads the rendered file in ranges, so large uploads never sit in memory. */
export async function fileVideoSource(filePath: string, extra: Partial<VideoSource> = {}): Promise<VideoSource> {
  const info = await stat(filePath);
  return {
    size: info.size,
    mime: "video/mp4",
    ...extra,
    async read(offset, length) {
      const handle = await open(filePath, "r");
      try {
        const buffer = new Uint8Array(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        return buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    },
  };
}
