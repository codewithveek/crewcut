import { open, stat } from "node:fs/promises";

import { type VideoSource, YouTubeClient, getAccessToken } from "@crewcut/distribute";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { runWithRequestContext } from "@agent-native/core/server";

import { getDb, schema } from "../db/index.js";
import { appOrigin, credentialVault, youtubeOAuthClient } from "./vault.js";

export type ConnectionRow = typeof schema.connections.$inferSelect;

/**
 * Whether uploads can be unlisted or public. Google keeps every upload from an
 * API project that hasn't passed its YouTube API Services audit private, so
 * until the operator sets CREWCUT_YOUTUBE_PUBLIC_UPLOADS (after the audit),
 * Crewcut uploads as private and says so instead of offering a choice that
 * YouTube would ignore.
 */
export function youtubePublicUploads(): boolean {
  return /^(1|true)$/i.test(process.env.CREWCUT_YOUTUBE_PUBLIC_UPLOADS?.trim() ?? "");
}

export async function youtubeConnectionFor(ownerEmail: string): Promise<ConnectionRow | null> {
  const [row] = await getDb()
    .select()
    .from(schema.connections)
    .where(and(eq(schema.connections.ownerEmail, ownerEmail), eq(schema.connections.provider, "youtube"), ne(schema.connections.status, "revoked")))
    // A working channel first, then the one connected most recently: never an
    // older attempt that found no channel while a good connection exists.
    .orderBy(sql`case when ${schema.connections.status} = 'healthy' and ${schema.connections.accountId} <> '' then 0 else 1 end`, desc(schema.connections.createdAt))
    .limit(1);
  return row ?? null;
}

/** Posts this server process is uploading right now (an upload outlives the request that started it). */
export const uploadsInFlight = new Set<string>();

/**
 * Marks uploads that can never finish as failed, so the post can be published
 * again: the upload runs inside the web server, and a restart mid-upload left
 * the post saying "uploading" for good. Returns how many were closed.
 */
export async function failStaleUploads(): Promise<number> {
  const P = schema.publishJobs;
  const rows = await getDb()
    .select({ id: P.id, ownerEmail: P.ownerEmail, orgId: P.orgId })
    .from(P)
    .where(and(eq(P.status, "uploading"), sql`coalesce((${P.approvedAt})::timestamptz, (${P.createdAt})::timestamptz) < now() - interval '60 minutes'`))
    .limit(200);
  let closed = 0;
  for (const row of rows) {
    if (uploadsInFlight.has(row.id)) continue;
    await runWithRequestContext({ userEmail: row.ownerEmail, ...(row.orgId ? { orgId: row.orgId } : {}) }, () =>
      getDb()
        .update(P)
        .set({ status: "failed", error: "The upload was interrupted before it finished. Check your channel in case it arrived, then publish again." })
        .where(and(eq(P.id, row.id), eq(P.status, "uploading"))),
    );
    closed += 1;
  }
  return closed;
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

/**
 * Deletes what Crewcut stored from a person's YouTube Analytics authorisation:
 * the metric snapshots, the crew's summaries (insights) of those videos and
 * the learnings saved from them (a learning's evidence is its insight's
 * headline). YouTube API policy requires this when access is revoked, and
 * the Privacy Policy promises it. Publish records (the video's YouTube link)
 * stay with the video. Returns how many videos had figures.
 */
export async function deleteYoutubeData(ownerEmail: string): Promise<number> {
  const db = getDb();
  const youtubeSnapshots = and(eq(schema.metricSnapshots.ownerEmail, ownerEmail), eq(schema.metricSnapshots.source, "youtube"));
  const measured = await db.selectDistinct({ videoId: schema.metricSnapshots.videoId }).from(schema.metricSnapshots).where(youtubeSnapshots);
  if (measured.length === 0) return 0;
  const derived = and(
    eq(schema.insights.ownerEmail, ownerEmail),
    inArray(
      schema.insights.videoId,
      measured.map((entry) => entry.videoId),
    ),
  );
  const insightRows = await db.select({ body: schema.insights.body }).from(schema.insights).where(derived);
  const headlines = new Set<string>();
  for (const row of insightRows) {
    try {
      const headline = (JSON.parse(row.body) as { headline?: unknown }).headline;
      if (typeof headline === "string" && headline) headlines.add(headline);
    } catch {
      // An unreadable insight has no headline to match; it is deleted below all the same.
    }
  }
  if (headlines.size > 0) {
    await db.delete(schema.learnings).where(and(eq(schema.learnings.ownerEmail, ownerEmail), inArray(schema.learnings.evidence, [...headlines])));
  }
  await db.delete(schema.insights).where(derived);
  await db.delete(schema.metricSnapshots).where(youtubeSnapshots);
  return measured.length;
}
