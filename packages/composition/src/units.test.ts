import { describe, expect, it } from "vitest";

import { ASPECT_RATIOS, EXPORT_RESOLUTIONS, FRAME_SIZE, MAX_EXPORT_SIDE, exportSize } from "./units";

describe("export sizes", () => {
  it("names sizes by the short side, in every format", () => {
    expect(exportSize(1080, 1920, "720p")).toEqual({ width: 720, height: 1280 });
    expect(exportSize(1920, 1080, "480p")).toEqual({ width: 854, height: 480 });
    expect(exportSize(1920, 1080, "1080p")).toEqual({ width: 1920, height: 1080 });
    expect(exportSize(1920, 1080, "2160p")).toEqual({ width: 3840, height: 2160 });
    expect(exportSize(1080, 1350, "1440p")).toEqual({ width: 1440, height: 1800 });
  });

  it("keeps both sides even and the long side within the limit", () => {
    for (const ratio of ASPECT_RATIOS) {
      for (const resolution of EXPORT_RESOLUTIONS) {
        const { width, height } = FRAME_SIZE[ratio];
        const size = exportSize(width, height, resolution.id);
        expect(size.width % 2).toBe(0);
        expect(size.height % 2).toBe(0);
        expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(MAX_EXPORT_SIDE);
        // The shape is kept (to within the even rounding).
        expect(Math.abs(size.width / size.height - width / height)).toBeLessThan(0.01);
      }
    }
    // 21:9 at 4K would be 5040 px wide: capped to 4096.
    expect(exportSize(2520, 1080, "2160p")).toEqual({ width: 4096, height: 1756 });
  });
});
