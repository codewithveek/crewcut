/**
 * Stock photos from Pexels (free for commercial use, no attribution required
 * by the licence; the API terms ask apps to credit Pexels and the
 * photographer, which the Proof report and the asset's provenance do).
 * https://www.pexels.com/api/documentation/
 */

export type StockOrientation = "portrait" | "landscape" | "square";

export interface StockPhoto {
  provider: "pexels";
  id: number;
  width: number;
  height: number;
  /** Page on pexels.com (for the credit link). */
  pageUrl: string;
  photographer: string;
  photographerUrl: string;
  alt: string;
  avgColor: string;
  /** Small preview for galleries (~350–940 px). */
  previewUrl: string;
  /** Large file for projects and renders (~1880 px). */
  fullUrl: string;
}

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  photographer_url: string;
  avg_color: string | null;
  alt: string | null;
  src: { original: string; large2x: string; large: string; medium: string; portrait: string; landscape: string };
}

export class StockError extends Error {
  override readonly name = "StockError";
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface StockClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
}

/** Credit line the Pexels API terms ask for. */
export function stockCredit(photo: Pick<StockPhoto, "photographer">): string {
  return `Photo by ${photo.photographer} on Pexels`;
}

export function createStockClient(options: StockClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  async function call<T>(path: string): Promise<T> {
    const response = await fetchImpl(`https://api.pexels.com${path}`, { headers: { Authorization: options.apiKey } });
    if (response.status === 401 || response.status === 403) throw new StockError("The Pexels API key was refused. Check PEXELS_API_KEY.", response.status);
    if (response.status === 429) throw new StockError("Pexels rate limit reached; try again later.", 429);
    if (!response.ok) throw new StockError(`Pexels request failed (${response.status})`, response.status);
    return (await response.json()) as T;
  }
  return {
    /** Photo search, best matches first. */
    async searchPhotos(query: string, search: { orientation?: StockOrientation; perPage?: number; page?: number } = {}): Promise<{ photos: StockPhoto[]; total: number }> {
      const params = new URLSearchParams({ query, per_page: String(Math.min(Math.max(search.perPage ?? 15, 1), 80)), page: String(Math.max(search.page ?? 1, 1)) });
      if (search.orientation) params.set("orientation", search.orientation);
      const data = await call<{ photos: PexelsPhoto[]; total_results: number }>(`/v1/search?${params}`);
      return { photos: data.photos.map(toStockPhoto), total: data.total_results };
    },
    async getPhoto(id: number): Promise<StockPhoto> {
      return toStockPhoto(await call<PexelsPhoto>(`/v1/photos/${id}`));
    },
  };
}

export type StockClient = ReturnType<typeof createStockClient>;

function toStockPhoto(photo: PexelsPhoto): StockPhoto {
  return {
    provider: "pexels",
    id: photo.id,
    width: photo.width,
    height: photo.height,
    pageUrl: photo.url,
    photographer: photo.photographer,
    photographerUrl: photo.photographer_url,
    alt: photo.alt ?? "",
    avgColor: photo.avg_color ?? "#808080",
    previewUrl: photo.src.large,
    fullUrl: photo.src.large2x,
  };
}

/** Pexels orientation that suits a frame (portrait-ish, square-ish, landscape). */
export function orientationFor(width: number, height: number): StockOrientation {
  const aspect = width / height;
  if (aspect < 0.85) return "portrait";
  if (aspect > 1.2) return "landscape";
  return "square";
}

/** Picks one photo per query without repeats (several slots can share a theme). */
export function pickDistinct(results: ReadonlyArray<readonly StockPhoto[]>): Array<StockPhoto | null> {
  const used = new Set<number>();
  return results.map((photos) => {
    const photo = photos.find((candidate) => !used.has(candidate.id)) ?? null;
    if (photo) used.add(photo.id);
    return photo;
  });
}
