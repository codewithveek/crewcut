import { describe, expect, it } from "vitest";

import { imageSize } from "./image-size";

const bytes = (...parts: Array<number[] | string>) => Uint8Array.from(parts.flatMap((part) => (typeof part === "string" ? [...part].map((char) => char.charCodeAt(0)) : part)));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n: number) => [(n >>> 8) & 255, n & 255];

describe("imageSize", () => {
  it("reads PNG and GIF headers", () => {
    expect(imageSize(bytes([0x89], "PNG\r\n\x1a\n", be32(13), "IHDR", be32(640), be32(200), [8, 6, 0, 0, 0]))).toEqual({ width: 640, height: 200 });
    expect(imageSize(bytes("GIF89a", [0x4d, 0, 0x37, 0], [0, 0, 0]))).toEqual({ width: 77, height: 55 });
  });

  it("reads a JPEG's frame header after other segments, and turns it for EXIF rotation", () => {
    const sof = [0xff, 0xc0, ...be16(17), 8, ...be16(480), ...be16(1280), 3, ...Array(9).fill(0)];
    const app0 = [0xff, 0xe0, ...be16(16), ...Array(14).fill(0)];
    expect(imageSize(bytes([0xff, 0xd8], app0, sof))).toEqual({ width: 1280, height: 480 });
    // EXIF orientation 6 (rotate 90°), little-endian TIFF with one IFD entry.
    const tiff = [..."II".split("").map((c) => c.charCodeAt(0)), 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0];
    const exif = [0xff, 0xe1, ...be16(2 + 6 + tiff.length), ..."Exif\0\0".split("").map((c) => c.charCodeAt(0)), ...tiff];
    expect(imageSize(bytes([0xff, 0xd8], exif, sof))).toEqual({ width: 480, height: 1280 });
  });

  it("returns null for junk and truncated files", () => {
    expect(imageSize(new Uint8Array(0))).toBeNull();
    expect(imageSize(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 1]))).toBeNull();
    expect(imageSize(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8X"))).toBeNull();
    expect(imageSize(Uint8Array.from({ length: 64 }, (_, i) => (i * 31) % 256))).toBeNull();
  });
});
