import { type SQL, type SQLWrapper, sql } from "drizzle-orm";

/** Case-insensitive "contains" that treats %, _ and \ in the person's text literally. */
export function containsText(column: SQLWrapper, text: string): SQL {
  const pattern = `%${text.trim().toLowerCase().replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  return sql`lower(${column}) like ${pattern} escape '\\'`;
}

/** Paging args from GET query strings or real numbers (agent, CLI). */
export function pageArgs(limit: number | undefined, offset: number | undefined, defaults: { limit: number; max: number }): { limit: number; offset: number } {
  const size = Math.min(Math.max(Math.trunc(limit ?? defaults.limit), 1), defaults.max);
  return { limit: size, offset: Math.max(Math.trunc(offset ?? 0), 0) };
}
