/** Type sniffing on magic bytes: the declared content type is never trusted. */
export function sniffMedia(bytes: Uint8Array): { ext: string; mime: string; kind: "audio" | "image" | "video" } | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return { ext: "wav", mime: "audio/wav", kind: "audio" };
  if (ascii(0, 3) === "ID3" || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)) return { ext: "mp3", mime: "audio/mpeg", kind: "audio" };
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    return brand.startsWith("M4A") ? { ext: "m4a", mime: "audio/mp4", kind: "audio" } : { ext: "mp4", mime: "video/mp4", kind: "video" };
  }
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return { ext: "webm", mime: "video/webm", kind: "video" };
  if (ascii(0, 4) === "OggS") return { ext: "ogg", mime: "audio/ogg", kind: "audio" };
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return { ext: "png", mime: "image/png", kind: "image" };
  if (ascii(0, 4) === "GIF8") return { ext: "gif", mime: "image/gif", kind: "image" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: "jpg", mime: "image/jpeg", kind: "image" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { ext: "webp", mime: "image/webp", kind: "image" };
  return null;
}
