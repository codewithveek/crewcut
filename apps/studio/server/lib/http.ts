/**
 * Reading bodies with a hard size limit. `arrayBuffer()` and `text()` keep
 * reading whatever the other side sends, so a missing or wrong Content-Length
 * (chunked uploads, a slow endless page) could fill the server's memory before
 * any size check ran. These stop at the limit.
 */

export class BodyTooLargeError extends Error {
  override readonly name = "BodyTooLargeError";
  readonly statusCode = 413;
}

/** The whole body, or BodyTooLargeError as soon as it passes `maxBytes`. */
export async function readBodyCapped(source: { body: ReadableStream<Uint8Array> | null }, maxBytes: number): Promise<Uint8Array> {
  if (!source.body) return new Uint8Array(0);
  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) throw new BodyTooLargeError(`Body is larger than ${maxBytes} bytes`);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Up to `maxBytes` of a body as text; the rest is dropped, never downloaded. */
export async function readTextCapped(source: { body: ReadableStream<Uint8Array> | null }, maxBytes: number): Promise<string> {
  if (!source.body) return "";
  const reader = source.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const room = maxBytes - total;
      const piece = value.byteLength > room ? value.subarray(0, room) : value;
      total += piece.byteLength;
      text += decoder.decode(piece, { stream: true });
    }
    text += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text;
}

/**
 * The byte range a Range header asks for, for a file of `size` bytes:
 * "bytes=0-99", "bytes=100-" and the suffix form "bytes=-500" (the last 500
 * bytes). null = no usable range (serve the whole file); "unsatisfiable" = 416.
 */
export function parseRange(header: string | null | undefined, size: number): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;
  if (size <= 0) return "unsatisfiable";
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (suffix <= 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}
