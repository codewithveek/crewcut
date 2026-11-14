/**
 * A picture's pixel size from its header (PNG, GIF, JPEG, WebP), without
 * decoding it. Null when the file is unreadable. JPEG EXIF rotation is
 * applied, so the size is the one people see.
 */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  try {
    const size = png(bytes) ?? gif(bytes) ?? webp(bytes) ?? jpeg(bytes);
    return size && size.width > 0 && size.height > 0 ? size : null;
  } catch {
    return null;
  }
}

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const ascii = (bytes: Uint8Array, start: number, length: number) => (start + length <= bytes.length ? String.fromCharCode(...bytes.subarray(start, start + length)) : "");

function png(bytes: Uint8Array) {
  if (bytes[0] !== 0x89 || ascii(bytes, 1, 3) !== "PNG" || ascii(bytes, 12, 4) !== "IHDR") return null;
  const data = view(bytes);
  return { width: data.getUint32(16), height: data.getUint32(20) };
}

function gif(bytes: Uint8Array) {
  if (ascii(bytes, 0, 4) !== "GIF8" || bytes.length < 10) return null;
  const data = view(bytes);
  return { width: data.getUint16(6, true), height: data.getUint16(8, true) };
}

function webp(bytes: Uint8Array) {
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return null;
  const data = view(bytes);
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8X" && bytes.length >= 30) {
    const read24 = (at: number) => bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);
    return { width: read24(24) + 1, height: read24(27) + 1 };
  }
  if (chunk === "VP8 " && bytes.length >= 30) return { width: data.getUint16(26, true) & 0x3fff, height: data.getUint16(28, true) & 0x3fff };
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = data.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

/** EXIF orientations 5–8 turn the picture on its side. */
function exifRotates(bytes: Uint8Array, start: number, end: number): boolean {
  if (ascii(bytes, start, 6) !== "Exif\0\0") return false;
  const tiff = start + 6;
  const little = ascii(bytes, tiff, 2) === "II";
  const data = view(bytes);
  const u16 = (at: number) => (at + 2 <= end ? data.getUint16(at, little) : 0);
  const u32 = (at: number) => (at + 4 <= end ? data.getUint32(at, little) : 0);
  const ifd = tiff + u32(tiff + 4);
  const entries = u16(ifd);
  for (let i = 0; i < entries && i < 200; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) break;
    if (u16(entry) === 0x0112) return u16(entry + 8) >= 5 && u16(entry + 8) <= 8;
  }
  return false;
}

function jpeg(bytes: Uint8Array) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const data = view(bytes);
  let rotated = false;
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1]!;
    // Fill bytes and markers without a length.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      at += 2;
      continue;
    }
    const length = data.getUint16(at + 2);
    if (length < 2) return null;
    if (marker === 0xe1) rotated = rotated || exifRotates(bytes, at + 4, Math.min(bytes.length, at + 2 + length));
    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (at + 9 > bytes.length) return null;
      const height = data.getUint16(at + 5);
      const width = data.getUint16(at + 7);
      return rotated ? { width: height, height: width } : { width, height };
    }
    at += 2 + length;
  }
  return null;
}
