import type { z } from "zod";

/** Zod at every boundary: JSON stored as text is parsed (and defaulted) on the way out. */
export function parseJson<T extends z.ZodType>(schema: T, text: string | null | undefined, fallback: z.infer<T>): z.infer<T> {
  if (text === null || text === undefined || text === "") return fallback;
  try {
    const result = schema.safeParse(JSON.parse(text));
    return result.success ? result.data : fallback;
  } catch {
    return fallback;
  }
}

export function parseJsonStrict<T extends z.ZodType>(schema: T, text: string, what: string): z.infer<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`Stored ${what} is not valid JSON`);
  }
  return schema.parse(raw);
}

export const toJson = (value: unknown): string => JSON.stringify(value);

export const nowIso = (): string => new Date().toISOString();
