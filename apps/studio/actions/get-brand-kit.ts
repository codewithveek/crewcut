import { defineAction } from "@agent-native/core/action";
import { brandKitIsEmpty } from "@crewcut/composition";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { fileUrl } from "../server/lib/blob-store.js";
import { readBrandKit } from "../server/lib/brand.js";
import { workspaceOf } from "../server/lib/catalog.js";
import { identity } from "../server/lib/identity.js";

export default defineAction({
  description:
    "Read the workspace's brand kit: colours (background, surface, ink, muted, accent, accent2), display and body fonts, the logo (with where it sits) and whether it is applied on its own to new template videos and the crew's drafts. Empty when none is set.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => {
    const who = identity(ctx);
    const kit = await readBrandKit(workspaceOf({ email: who.email, orgId: who.orgId }));
    let logo: { url: string; label: string } | null = null;
    if (kit.logo) {
      const [asset] = await getDb().select().from(schema.assets).where(eq(schema.assets.id, kit.logo.assetId)).limit(1);
      if (asset) logo = { url: await fileUrl("assets", asset.fileName), label: asset.label };
    }
    return { kit, empty: brandKitIsEmpty(kit), logo, shared: Boolean(who.orgId) };
  },
});
