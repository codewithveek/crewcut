import { defineAction } from "@agent-native/core/action";
import { stockCredit } from "@crewcut/stock";
import { z } from "zod";

import { identity } from "../server/lib/identity.js";
import { searchStockPhotos, stockErrorMessage } from "../server/lib/stock.js";
import { stockEnabled } from "../server/lib/templates.js";
import { UserError } from "../server/lib/errors.js";

export default defineAction({
  description:
    "Search free stock photos (Pexels, free for commercial use). Leave query empty for hand-picked photos. orientation narrows to portrait, landscape or square (pick the video's shape). Each photo has an id, a preview link, its size and the photographer. To use one, call import-stock-photo with its id: that saves it into the video's media with the photographer's credit and returns an asset id for image layers or add-media-clip.",
  schema: z.object({
    query: z.string().max(100).optional().describe("What the photo should show, in a few plain words"),
    orientation: z.enum(["portrait", "landscape", "square"]).optional(),
    page: z.coerce.number().int().min(1).max(100).optional(),
    perPage: z.coerce.number().int().min(1).max(80).optional().describe("Photos per page, default 30"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ query, orientation, page, perPage }, ctx) => {
    identity(ctx);
    if (!stockEnabled()) return { enabled: false as const, photos: [], total: 0, page: 1, hasMore: false };
    try {
      const result = await searchStockPhotos({ ...(query ? { query } : {}), ...(orientation ? { orientation } : {}), ...(page ? { page } : {}), ...(perPage ? { perPage } : {}) });
      return {
        enabled: true as const,
        photos: result.photos.map((photo) => ({
          id: photo.id,
          width: photo.width,
          height: photo.height,
          alt: photo.alt,
          avgColor: photo.avgColor,
          thumbUrl: photo.thumbUrl ?? photo.previewUrl,
          previewUrl: photo.previewUrl,
          photographer: photo.photographer,
          photographerUrl: photo.photographerUrl,
          pageUrl: photo.pageUrl,
          credit: stockCredit(photo),
        })),
        total: result.total,
        page: result.page,
        hasMore: result.page * result.perPage < result.total,
      };
    } catch (error) {
      throw new UserError(stockErrorMessage(error));
    }
  },
});
