import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import type { ActionRunContext } from "@agent-native/core/action";
import {
  type AspectRatio,
  type Composition,
  type DataTemplateSlot,
  type SlotPick,
  ASPECT_RATIOS,
  TEMPLATES,
  TEMPLATE_CATEGORIES,
  compositionAssetIds,
  computeDurationMs,
  markTemplateSlots,
  parseComposition,
} from "@crewcut/composition";
import { and, asc, desc, eq, inArray, max, or, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../db/index.js";
import { type Identity, ForbiddenError, identity } from "./identity.js";
import { nowIso, parseJsonLoose, toJson } from "./json.js";
import { isStoredRemotely, localCopy, putFile } from "./blob-store.js";
import { newId, storagePath } from "./storage.js";
import { latestComposition, loadVideo } from "./store.js";
import { UserError } from "./errors.js";

/**
 * The content catalog: templates, music and sounds that admins publish in
 * Free or Pro packs, plus people's own saved templates (scope "workspace").
 *
 * Published content is immutable (catalog_item_versions), and using a
 * template copies what it needs into the person's project, so editing or
 * removing catalog content never changes a video someone already made.
 * Media files shared by templates and the catalog are named `tpl-…` / `cat-…`
 * after their content and are never deleted along with a project.
 */

export type Tier = "free" | "pro";
export type CatalogKind = "template" | "music" | "sound";
export type ItemRow = typeof schema.catalogItems.$inferSelect;
export type PackRow = typeof schema.catalogPacks.$inferSelect;

export const BUILTIN_PACK_ID = "pack_builtin";
/** File-name prefixes of shared files: deleting a project's asset row never deletes these. */
export const SHARED_FILE_PREFIXES = ["lib-", "tpl-", "cat-"] as const;
export const isSharedFile = (fileName: string) => SHARED_FILE_PREFIXES.some((prefix) => fileName.startsWith(prefix));

// ── Who may do what ─────────────────────────────────────────────────────────

function adminEmails(): Set<string> {
  return new Set(
    (process.env.CREWCUT_ADMIN_EMAILS ?? "")
      .split(/[,\s]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Catalog admins: the emails in CREWCUT_ADMIN_EMAILS. On a developer's
 * machine with none listed, only the built-in local accounts (sign-in turned
 * off: local@localhost, dev@local.test) are admins, so the area can be built
 * and tested; other people never are. In production, no list means no admins.
 */
export function isAdmin(who: Pick<Identity, "email">): boolean {
  const admins = adminEmails();
  const email = who.email.toLowerCase();
  if (admins.size > 0) return admins.has(email);
  return process.env.NODE_ENV !== "production" && /@(localhost|local\.test)$/.test(email);
}

export function requireAdmin(ctx: ActionRunContext | undefined): Identity {
  const who = identity(ctx);
  if (!isAdmin(who)) throw new ForbiddenError("Only Crewcut admins can manage the catalog.");
  return who;
}

/** A workspace is an organisation, or the person's own space when they aren't in one. */
export function workspaceOf(owner: { email: string; orgId: string | null }): string {
  return owner.orgId ?? `user:${owner.email.toLowerCase()}`;
}

export async function planOf(workspace: string): Promise<Tier> {
  const [row] = await getDb().select({ plan: schema.workspacePlans.plan }).from(schema.workspacePlans).where(eq(schema.workspacePlans.workspace, workspace)).limit(1);
  return row?.plan === "pro" ? "pro" : "free";
}

// ── Payloads ────────────────────────────────────────────────────────────────

export const mediaEntrySchema = z.object({
  fileName: z.string().regex(/^[A-Za-z0-9._-]+$/),
  mime: z.string().max(100),
  kind: z.string().max(40),
  label: z.string().max(200),
  bytes: z.number().int().min(0).default(0),
  durationMs: z.number().nullable().default(null),
  licence: z.record(z.string(), z.unknown()).default({}),
  provenance: z.record(z.string(), z.unknown()).default({}),
});
export type MediaEntry = z.infer<typeof mediaEntrySchema>;

const slotSchema = z.object({
  id: z.string().max(40),
  kind: z.enum(["photo", "video", "text"]),
  label: z.string().max(80),
  default: z.string().max(2000),
  maxLength: z.number().int().positive().optional(),
});

export const builtinTemplatePayloadSchema = z.object({ type: z.literal("builtin"), templateId: z.string() });
export const dataTemplatePayloadSchema = z.object({
  type: z.literal("data"),
  /** One composition per format; compositions are parsed when used. */
  variants: z.record(z.string(), z.unknown()),
  slots: z.array(slotSchema),
  /** The template's own media, by the asset id its compositions use. */
  media: z.record(z.string(), mediaEntrySchema).default({}),
  durationMs: z.number().min(0),
  bpm: z.number().positive().nullable().default(null),
});
export const audioPayloadSchema = z.object({
  type: z.literal("audio"),
  media: mediaEntrySchema,
  bpm: z.number().positive().max(300).nullable().default(null),
  mood: z.string().max(60).default(""),
});
export const itemPayloadSchema = z.discriminatedUnion("type", [builtinTemplatePayloadSchema, dataTemplatePayloadSchema, audioPayloadSchema]);
export type ItemPayload = z.infer<typeof itemPayloadSchema>;
export type DataTemplatePayload = z.infer<typeof dataTemplatePayloadSchema>;
export type AudioPayload = z.infer<typeof audioPayloadSchema>;

export function parsePayload(text: string | null | undefined): ItemPayload | null {
  if (!text) return null;
  try {
    const result = itemPayloadSchema.safeParse(JSON.parse(text));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** The formats a data template comes in, in the app's order. */
export function variantRatios(payload: DataTemplatePayload): AspectRatio[] {
  return ASPECT_RATIOS.filter((ratio) => payload.variants[ratio] !== undefined);
}

export function variantOf(payload: DataTemplatePayload, ratio: AspectRatio): Composition | null {
  const raw = payload.variants[ratio];
  if (!raw) return null;
  try {
    return parseComposition(raw);
  } catch {
    return null;
  }
}

// ── Built-in pack ───────────────────────────────────────────────────────────

let seeding: Promise<void> | null = null;

/**
 * The six designed templates as the free "Built-in" pack. Idempotent (fixed
 * ids, insert-if-missing), so every server can call it; admins can then rename,
 * reorder, unpublish or move them like any other item.
 */
export function ensureBuiltinCatalog(): Promise<void> {
  seeding ??= (async () => {
    const db = getDb();
    await db
      .insert(schema.catalogPacks)
      .values({ id: BUILTIN_PACK_ID, name: "Built-in", description: "Crewcut's own designs, free for everyone.", tier: "free", status: "published", sort: 0, createdBy: "crewcut", ownerEmail: "crewcut@system", visibility: "public" })
      .onConflictDoNothing();
    // One multi-row insert per table (was two round trips per template on every boot).
    const items = TEMPLATES.map((template, index) => ({ template, index, id: `cat_builtin_${template.id}` }));
    await db
      .insert(schema.catalogItems)
      .values(items.map(({ template, index, id }) => ({ id, scope: "catalog", packId: BUILTIN_PACK_ID, kind: "template", name: template.name, description: template.description, category: template.category, tags: toJson(template.tags), status: "published", sort: index, currentVersion: 1, createdBy: "crewcut", ownerEmail: "crewcut@system", visibility: "public" as const })))
      .onConflictDoNothing();
    await db
      .insert(schema.catalogItemVersions)
      .values(items.map(({ template, id }) => ({ id: `${id}_v1`, itemId: id, version: 1, payload: toJson({ type: "builtin", templateId: template.id }), publishedBy: "crewcut" })))
      .onConflictDoNothing();
  })().catch((error: unknown) => {
    seeding = null;
    throw error;
  });
  return seeding;
}

// ── Reading the catalog ─────────────────────────────────────────────────────

export interface ResolvedItem {
  item: ItemRow;
  pack: PackRow | null;
  tier: Tier;
  version: number;
  payload: ItemPayload;
}

/** Published catalog items in published packs, plus the person's workspace templates, with their current payloads. */
export async function visibleItems(who: { email: string; orgId: string | null } | null, kinds: readonly CatalogKind[], onlyItemId?: string): Promise<ResolvedItem[]> {
  await ensureBuiltinCatalog();
  const db = getDb();
  const own = who ? (who.orgId ? eq(schema.catalogItems.orgId, who.orgId) : and(eq(schema.catalogItems.ownerEmail, who.email), sql`${schema.catalogItems.orgId} is null`)) : sql`false`;
  const rows = await db
    .select({ item: schema.catalogItems, pack: schema.catalogPacks, payload: schema.catalogItemVersions.payload })
    .from(schema.catalogItems)
    .leftJoin(schema.catalogPacks, eq(schema.catalogPacks.id, schema.catalogItems.packId))
    .innerJoin(schema.catalogItemVersions, and(eq(schema.catalogItemVersions.itemId, schema.catalogItems.id), eq(schema.catalogItemVersions.version, schema.catalogItems.currentVersion)))
    .where(
      and(
        inArray(schema.catalogItems.kind, [...kinds]),
        onlyItemId ? eq(schema.catalogItems.id, onlyItemId) : undefined,
        eq(schema.catalogItems.status, "published"),
        or(and(eq(schema.catalogItems.scope, "catalog"), eq(schema.catalogPacks.status, "published")), and(eq(schema.catalogItems.scope, "workspace"), own)),
      ),
    )
    .orderBy(asc(schema.catalogPacks.sort), asc(schema.catalogItems.sort), desc(schema.catalogItems.createdAt));
  const resolved: ResolvedItem[] = [];
  for (const row of rows) {
    const payload = parsePayload(row.payload);
    if (!payload) continue;
    resolved.push({ item: row.item, pack: row.pack, tier: row.item.scope === "catalog" && row.pack?.tier === "pro" ? "pro" : "free", version: row.item.currentVersion, payload });
  }
  return resolved;
}

/** One item a person may use (published catalog item or their workspace's template). */
export async function usableItem(who: { email: string; orgId: string | null }, itemId: string): Promise<ResolvedItem | null> {
  // Same visibility rules as the full list, for just this one item (not every template's payload).
  const [entry] = await visibleItems(who, ["template", "music", "sound"], itemId);
  return entry ?? null;
}

/** Catalog id of a built-in template, for links that still use the code id ("golden-hour"). */
export async function catalogIdForTemplate(templateId: string): Promise<string> {
  return /^(cat|tpl)_/.test(templateId) ? templateId : `cat_builtin_${templateId}`;
}

// ── Media shared by templates and the catalog ───────────────────────────────

function extensionOf(fileName: string, mime: string): string {
  const fromName = /\.([A-Za-z0-9]{2,5})$/.exec(fileName)?.[1];
  if (fromName) return fromName.toLowerCase();
  return mime.split("/")[1]?.replace("mpeg", "mp3").replace("jpeg", "jpg") ?? "bin";
}

async function fileExists(fileName: string): Promise<boolean> {
  return existsSync(storagePath("assets", fileName)) || (await isStoredRemotely("assets", fileName));
}

/**
 * Stores bytes as a shared, content-named file (`<prefix><sha>.<ext>`): the
 * same content is stored once, and a name never points at different bytes.
 */
export async function storeSharedFile(prefix: "tpl-" | "cat-", bytes: Uint8Array, mime: string, ext: string): Promise<string> {
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
  const fileName = `${prefix}${hash}.${ext.replace(/[^A-Za-z0-9]/g, "").slice(0, 5) || "bin"}`;
  if (!(await fileExists(fileName))) await putFile("assets", fileName, bytes, mime, { keepLocal: true });
  return fileName;
}

const MAX_TEMPLATE_FILE_BYTES = 300 * 1024 * 1024;

/** A shared copy of an asset's file (shared files are already safe to point at). */
async function shareAssetFile(row: typeof schema.assets.$inferSelect): Promise<string> {
  if (isSharedFile(row.fileName)) return row.fileName;
  const local = await localCopy("assets", row.fileName);
  const bytes = new Uint8Array(await readFile(local));
  if (bytes.byteLength > MAX_TEMPLATE_FILE_BYTES) throw new UserError(`“${row.label}” is too large to keep in a template (300 MB at most).`);
  return storeSharedFile("tpl-", bytes, row.mime, extensionOf(row.fileName, row.mime));
}

// ── Templates from videos ───────────────────────────────────────────────────

export interface TemplateDraftInput {
  videoId: string;
  slots: readonly SlotPick[];
}

export interface TemplateVariant {
  ratio: AspectRatio;
  composition: Composition;
  slots: DataTemplateSlot[];
  media: Record<string, MediaEntry>;
  durationMs: number;
  skipped: string[];
}

/**
 * A video's latest edit as one format of a template: the chosen layers become
 * slots, and every file it uses is copied into shared template storage, so
 * the template keeps working if the video or its uploads are deleted.
 */
export async function variantFromVideo(ctx: ActionRunContext | undefined, input: TemplateDraftInput): Promise<TemplateVariant> {
  const video = await loadVideo(input.videoId, ctx, "editor");
  const latest = await latestComposition(video.row.id);
  if (!latest) throw new UserError("This video has nothing in it yet. Add some clips first.");
  const { composition, slots } = markTemplateSlots(latest.composition, input.slots);
  if (slots.length === 0) throw new UserError("Choose at least one text, photo or video that people can change.");
  const ids = compositionAssetIds(composition);
  // Only this video's files and its owner's library: an asset id typed into a
  // composition must never copy someone else's file into a template.
  const A = schema.assets;
  const rows = ids.length
    ? await getDb()
        .select()
        .from(A)
        .where(and(inArray(A.id, ids), or(eq(A.videoId, video.row.id), eq(A.ownerEmail, video.row.ownerEmail))))
    : [];
  const media: Record<string, MediaEntry> = {};
  const shared = await Promise.all(rows.map((row) => shareAssetFile(row)));
  for (const [index, row] of rows.entries()) {
    media[row.id] = {
      fileName: shared[index] as string,
      mime: row.mime,
      kind: row.kind,
      label: row.label,
      bytes: row.bytes,
      durationMs: row.durationMs,
      licence: parseJsonLoose<Record<string, unknown>>(row.licence, {}),
      provenance: parseJsonLoose<Record<string, unknown>>(row.provenance, {}),
    };
  }
  const skipped = ids.filter((id) => !media[id]);
  return { ratio: composition.ratio, composition: { ...composition, id: "template" }, slots, media, durationMs: computeDurationMs(composition), skipped };
}

/** Adds (or replaces) one format in a data template; slots from every format are merged by id. */
export function withVariant(existing: DataTemplatePayload | null, variant: TemplateVariant): DataTemplatePayload {
  const slots = new Map((existing?.slots ?? []).map((slot) => [slot.id, slot]));
  for (const slot of variant.slots) slots.set(slot.id, slot);
  return {
    type: "data",
    variants: { ...(existing?.variants ?? {}), [variant.ratio]: variant.composition },
    slots: [...slots.values()],
    media: { ...(existing?.media ?? {}), ...variant.media },
    durationMs: Math.max(existing?.durationMs ?? 0, variant.durationMs),
    bpm: existing?.bpm ?? null,
  };
}

export const categorySchema = z.enum(TEMPLATE_CATEGORIES);

// ── Publishing ──────────────────────────────────────────────────────────────

/** Publishes a payload as the item's next version (immutable) and makes it current. */
export async function publishVersion(item: ItemRow, payload: ItemPayload, publishedBy: string): Promise<number> {
  const db = getDb();
  const [last] = await db.select({ version: max(schema.catalogItemVersions.version) }).from(schema.catalogItemVersions).where(eq(schema.catalogItemVersions.itemId, item.id));
  const version = (last?.version ?? 0) + 1;
  await db.insert(schema.catalogItemVersions).values({ id: `${item.id}_v${version}`, itemId: item.id, version, payload: toJson(payload), publishedBy });
  await db.update(schema.catalogItems).set({ currentVersion: version, status: "published", draft: "{}", updatedAt: nowIso() }).where(eq(schema.catalogItems.id, item.id));
  return version;
}

export async function loadItem(itemId: string): Promise<ItemRow> {
  const [item] = await getDb().select().from(schema.catalogItems).where(eq(schema.catalogItems.id, itemId)).limit(1);
  if (!item) throw new UserError("That catalog item doesn't exist.");
  return item;
}

export async function currentPayload(item: ItemRow): Promise<ItemPayload | null> {
  if (item.currentVersion <= 0) return null;
  const [row] = await getDb()
    .select({ payload: schema.catalogItemVersions.payload })
    .from(schema.catalogItemVersions)
    .where(and(eq(schema.catalogItemVersions.itemId, item.id), eq(schema.catalogItemVersions.version, item.currentVersion)))
    .limit(1);
  return parsePayload(row?.payload);
}

/** True when this person may change or delete a workspace template. */
export function canManageWorkspaceItem(who: Identity, item: ItemRow): boolean {
  if (item.scope !== "workspace") return false;
  if (isAdmin(who)) return true;
  return item.ownerEmail.toLowerCase() === who.email.toLowerCase();
}

// ── Pro content ─────────────────────────────────────────────────────────────

/**
 * Pro content a composition uses: media that came from Pro catalog items
 * (their tier is written into the asset's provenance when added, so it stays
 * what it was), and the template it started from (the brief's `basedOn`) if
 * that template is in a Pro pack now.
 */
export async function proContentIn(composition: Composition): Promise<string[]> {
  const found = new Set<string>();
  const ids = compositionAssetIds(composition);
  if (ids.length) {
    const rows = await getDb().select({ label: schema.assets.label, provenance: schema.assets.provenance }).from(schema.assets).where(inArray(schema.assets.id, ids));
    for (const row of rows) {
      const provenance = parseJsonLoose<{ catalogTier?: string; catalogName?: string; fromTemplate?: string }>(row.provenance, {});
      if (provenance.catalogTier !== "pro") continue;
      // A Pro template's photos and music count as the template itself, named once.
      found.add(provenance.fromTemplate ? `${provenance.catalogName ?? row.label} template` : (provenance.catalogName ?? row.label));
    }
  }
  const basedOn = composition.brief.basedOn ?? "";
  if (basedOn.startsWith("template:")) {
    const id = await catalogIdForTemplate(basedOn.slice("template:".length));
    const [row] = await getDb()
      .select({ name: schema.catalogItems.name, scope: schema.catalogItems.scope, tier: schema.catalogPacks.tier })
      .from(schema.catalogItems)
      .leftJoin(schema.catalogPacks, eq(schema.catalogPacks.id, schema.catalogItems.packId))
      .where(eq(schema.catalogItems.id, id))
      .limit(1);
    if (row && row.scope === "catalog" && row.tier === "pro") found.add(`${row.name} template`);
  }
  return [...found];
}
