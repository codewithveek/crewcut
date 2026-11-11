import { describe, expect, it } from "vitest";

import { htmlToText } from "./content-safety.js";
import { BodyTooLargeError, parseRange, readBodyCapped, readTextCapped } from "./http.js";

/** A body that arrives in chunks and counts how many were pulled. */
function chunked(chunks: number, chunkBytes: number) {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= chunks) return controller.close();
      sent += 1;
      controller.enqueue(new Uint8Array(chunkBytes).fill(97));
    },
  });
  return { body, pulled: () => sent };
}

describe("readBodyCapped", () => {
  it("returns the whole body when it fits", async () => {
    const bytes = await readBodyCapped(chunked(3, 10), 30);
    expect(bytes.byteLength).toBe(30);
    expect(bytes[29]).toBe(97);
  });

  it("stops reading as soon as the limit is passed", async () => {
    const source = chunked(1000, 1024);
    await expect(readBodyCapped(source, 4096)).rejects.toBeInstanceOf(BodyTooLargeError);
    // A handful of chunks, never the whole megabyte.
    expect(source.pulled()).toBeLessThan(10);
  });

  it("treats a missing body as empty", async () => {
    expect((await readBodyCapped({ body: null }, 10)).byteLength).toBe(0);
  });
});

describe("readTextCapped", () => {
  it("keeps only the first bytes of an endless page", async () => {
    const source = chunked(1000, 1024);
    const text = await readTextCapped(source, 2500);
    expect(text.length).toBe(2500);
    expect(source.pulled()).toBeLessThan(10);
  });
});

describe("parseRange", () => {
  it("reads the three range forms", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=100-", 1000)).toEqual({ start: 100, end: 999 });
    // A suffix range is the LAST n bytes (players ask for an MP4's index this way).
    expect(parseRange("bytes=-500", 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
  });

  it("clamps the end and refuses ranges outside the file", () => {
    expect(parseRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=5-2", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 1000)).toBe("unsatisfiable");
  });

  it("serves the whole file for a missing or unreadable header", () => {
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange("bytes=-", 1000)).toBeNull();
    expect(parseRange("items=0-5", 1000)).toBeNull();
  });
});

describe("htmlToText", () => {
  it("survives numeric entities that aren't characters", () => {
    const { text } = htmlToText("<p>a&#99999999;b &#xD800; c&#65;&#x42;</p>");
    expect(text).toContain("cAB");
    expect(text.startsWith("a")).toBe(true);
  });
});
