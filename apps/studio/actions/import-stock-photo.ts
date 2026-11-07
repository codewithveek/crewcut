import { defineAction } from "@agent-native/core/action";
import { stockCredit } from "@crewcut/stock";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { toAssetDto } from "../server/lib/assets.js";
import { fileUrl } from "../server/lib/blob-store.js";
import { identity } from "../server/lib/identity.js";
import { importStockPhotoOnce, stockErrorMessage, stockPhotoById } from "../server/lib/stock.js";
import { loadVideo } from "../server/lib/store.js";
import { UserError } from "../server/lib/errors.js";

export default defineAction({
  description:
    "Save a stock photo (an id from search-stock-photos) into a video's media, or the person's library when videoId is left out, with the photographer's credit for the Proof report. Adding the same photo again reuses it. Returns assetId: use `asset:<assetId>` as an image layer's src (or in add-media-clip).",
  schema: z.object({
    photoId: z.coerce.number().int().positive(),
    videoId: z.string().optional(),
  }),
  run: async ({ photoId, videoId }, ctx) => {
    const who = identity(ctx);
    const video = videoId ? await loadVideo(videoId, ctx, "editor") : null;
    let photo;
    try {
      photo = await stockPhotoById(photoId);
    } catch (error) {
      throw new UserError(stockErrorMessage(error));
    }
    const { assetId, reused } = await importStockPhotoOnce(photo, { videoId: videoId ?? null, ownerEmail: video?.row.ownerEmail ?? who.email, orgId: video?.row.orgId ?? who.orgId });
    const [row] = await getDb().select().from(schema.assets).where(eq(schema.assets.id, assetId)).limit(1);
    if (!row) throw new UserError("The photo was saved but couldn't be read back. Try again.");
    const asset = toAssetDto(row, await fileUrl("assets", row.fileName));
    return { assetId, reused, credit: stockCredit(photo), width: photo.width, height: photo.height, asset };
  },
});
