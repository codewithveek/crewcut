import { and, eq, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

/** Media each owner may keep in total (CREWCUT_STORAGE_QUOTA_MB, default 5 GB), so one account can't fill the storage. */
export const QUOTA_BYTES = Math.max(1, Number(process.env.CREWCUT_STORAGE_QUOTA_MB ?? 5120)) * 1024 * 1024;

export const QUOTA_MESSAGE = `Uploads are limited to ${Math.round(QUOTA_BYTES / 1024 ** 3)} GB per account. Delete media you no longer use to make room.`;

/** Bytes of media an owner has stored (built-in library, template and catalog files don't count). */
export async function ownerMediaBytes(ownerEmail: string): Promise<number> {
  const [usage] = await getDb()
    .select({ bytes: sql<number>`coalesce(sum(${schema.assets.bytes}), 0)` })
    .from(schema.assets)
    .where(and(eq(schema.assets.ownerEmail, ownerEmail), sql`${schema.assets.fileName} not like 'lib-%' and ${schema.assets.fileName} not like 'tpl-%' and ${schema.assets.fileName} not like 'cat-%'`));
  return Number(usage?.bytes ?? 0);
}
