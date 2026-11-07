import { describe, expect, it } from "vitest";

import { StockError, createStockClient, orientationFor, pickDistinct, stockCredit } from "./index";

const pexelsPhoto = (id: number) => ({
  id,
  width: 3000,
  height: 4500,
  url: `https://www.pexels.com/photo/${id}/`,
  photographer: "Ada",
  photographer_url: "https://www.pexels.com/@ada",
  avg_color: null,
  alt: null,
  src: { original: "o", large2x: `l2x-${id}`, large: `l-${id}`, medium: `m-${id}`, portrait: "p", landscape: "ls" },
});

function fakeFetch(handler: (url: string) => { status: number; body?: unknown }) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const { status, body } = handler(url);
    return new Response(JSON.stringify(body ?? {}), { status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("stock client", () => {
  it("maps search results with a small thumbnail and defaults", async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ status: 200, body: { photos: [pexelsPhoto(7)], total_results: 1 } }));
    const client = createStockClient({ apiKey: "k", fetchImpl });
    const result = await client.searchPhotos("sunset", { orientation: "portrait", perPage: 500, page: 0 });
    expect(calls[0]).toContain("/v1/search?");
    expect(calls[0]).toContain("query=sunset");
    expect(calls[0]).toContain("per_page=80");
    expect(calls[0]).toContain("page=1");
    expect(calls[0]).toContain("orientation=portrait");
    expect(result.total).toBe(1);
    expect(result.photos[0]).toMatchObject({ id: 7, thumbUrl: "m-7", previewUrl: "l-7", fullUrl: "l2x-7", alt: "", avgColor: "#808080" });
  });

  it("lists curated photos for an empty search", async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ status: 200, body: { photos: [pexelsPhoto(1), pexelsPhoto(2)], total_results: 2 } }));
    const result = await createStockClient({ apiKey: "k", fetchImpl }).curatedPhotos({ perPage: 2, page: 3 });
    expect(calls[0]).toContain("/v1/curated?");
    expect(calls[0]).toContain("page=3");
    expect(result.photos.map((photo) => photo.id)).toEqual([1, 2]);
  });

  it("turns API failures into StockError with the status", async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 429 }));
    await expect(createStockClient({ apiKey: "k", fetchImpl }).getPhoto(1)).rejects.toMatchObject({ name: "StockError", status: 429 });
    const refused = fakeFetch(() => ({ status: 401 }));
    await expect(createStockClient({ apiKey: "k", fetchImpl: refused.fetchImpl }).curatedPhotos()).rejects.toBeInstanceOf(StockError);
  });

  it("credits, orientation and distinct picks", () => {
    expect(stockCredit({ photographer: "Ada" })).toBe("Photo by Ada on Pexels");
    expect(orientationFor(1080, 1920)).toBe("portrait");
    expect(orientationFor(1920, 1080)).toBe("landscape");
    expect(orientationFor(1080, 1080)).toBe("square");
    const a = { id: 1 } as never;
    const b = { id: 2 } as never;
    expect(pickDistinct([[a, b], [a, b], [a]]).map((photo) => (photo as { id: number } | null)?.id ?? null)).toEqual([1, 2, null]);
  });
});
