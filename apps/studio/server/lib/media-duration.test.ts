import { encodeWav } from "@crewcut/voice";
import { describe, expect, it } from "vitest";

import { mediaDurationMs } from "./media-duration";

const text = (value: string) => Uint8Array.from(value, (char) => char.charCodeAt(0));
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
const u32 = (value: number) => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
};
const box = (type: string, ...body: Uint8Array[]) => {
  const content = concat(...body);
  return concat(u32(8 + content.length), text(type), content);
};

describe("mediaDurationMs: WAV", () => {
  it("divides the data size by the byte rate", () => {
    const mono = encodeWav({ channels: [new Float32Array(24_000 * 1.5)], sampleRate: 24_000 });
    expect(mediaDurationMs(mono, "wav")).toBe(1500);
    const stereo = encodeWav({ channels: [new Float32Array(48_000 * 2), new Float32Array(48_000 * 2)], sampleRate: 48_000 });
    expect(mediaDurationMs(stereo, "wav")).toBe(2000);
  });
});

describe("mediaDurationMs: MP4", () => {
  const mvhd0 = (timescale: number, duration: number) => {
    const body = new Uint8Array(100);
    const data = new DataView(body.buffer);
    data.setUint32(12, timescale);
    data.setUint32(16, duration);
    return box("mvhd", body);
  };

  it("reads mvhd inside moov, wherever moov sits", () => {
    const ftyp = box("ftyp", text("isom"), u32(0));
    expect(mediaDurationMs(concat(ftyp, box("moov", mvhd0(1000, 2500))), "mp4")).toBe(2500);
    // moov after a big mdat (files that weren't made "fast start").
    expect(mediaDurationMs(concat(ftyp, box("mdat", new Uint8Array(5000)), box("moov", box("trak"), mvhd0(44_100, 44_100 * 3))), "m4a")).toBe(3000);
  });

  it("reads 64-bit mvhd (version 1)", () => {
    const body = new Uint8Array(112);
    const data = new DataView(body.buffer);
    data.setUint8(0, 1);
    data.setUint32(20, 600);
    data.setBigUint64(24, 600n * 90n);
    expect(mediaDurationMs(box("moov", box("mvhd", body)), "mp4")).toBe(90_000);
  });

  it("returns null for unknown durations, missing moov and broken boxes", () => {
    expect(mediaDurationMs(box("moov", mvhd0(1000, 0xffffffff)), "mp4")).toBeNull();
    expect(mediaDurationMs(box("moov", mvhd0(0, 5)), "mp4")).toBeNull();
    expect(mediaDurationMs(box("ftyp", text("isom")), "mp4")).toBeNull();
    // A box claiming to be bigger than the file.
    expect(mediaDurationMs(concat(u32(999_999), text("moov"), mvhd0(1000, 2000)), "mp4")).toBeNull();
    // A zero-size box at the start would loop forever if it didn't mean "to the end".
    expect(mediaDurationMs(concat(u32(0), text("free"), new Uint8Array(20)), "mp4")).toBeNull();
  });
});

describe("mediaDurationMs: WebM", () => {
  const element = (id: number[], body: Uint8Array) => concat(Uint8Array.from(id), Uint8Array.from([0x80 | body.length]), body);
  const float64 = (value: number) => {
    const out = new Uint8Array(8);
    new DataView(out.buffer).setFloat64(0, value);
    return out;
  };
  const ebmlHeader = element([0x1a, 0x45, 0xdf, 0xa3], element([0x42, 0x82], text("webm")));

  it("reads Duration in TimecodeScale units, also in a segment of unknown size", () => {
    const info = element([0x15, 0x49, 0xa9, 0x66], concat(element([0x2a, 0xd7, 0xb1], Uint8Array.from([0x0f, 0x42, 0x40])), element([0x44, 0x89], float64(4200))));
    // Segment with "unknown" size (0x01FFFFFFFFFFFFFF), as live encoders write.
    const segment = concat(Uint8Array.from([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), info);
    expect(mediaDurationMs(concat(ebmlHeader, segment), "webm")).toBe(4200);
  });

  it("returns null when Duration is left out (browser recordings)", () => {
    const info = element([0x15, 0x49, 0xa9, 0x66], element([0x2a, 0xd7, 0xb1], Uint8Array.from([0x0f, 0x42, 0x40])));
    const segment = concat(Uint8Array.from([0x18, 0x53, 0x80, 0x67, 0x80 | info.length]), info);
    expect(mediaDurationMs(concat(ebmlHeader, segment), "webm")).toBeNull();
  });
});

describe("mediaDurationMs: MP3", () => {
  // MPEG-1 Layer III, 128 kbps, 44.1 kHz, no padding, stereo: 417 bytes a frame, 1152 samples.
  const frame = () => {
    const out = new Uint8Array(417);
    out.set([0xff, 0xfb, 0x90, 0x00]);
    return out;
  };

  it("estimates constant-bitrate files from their size", () => {
    const frames = 100;
    const audio = concat(...Array.from({ length: frames }, frame));
    const ms = mediaDurationMs(audio, "mp3")!;
    expect(Math.abs(ms - (frames * 1152 * 1000) / 44_100)).toBeLessThan(20);
  });

  it("uses the Xing frame count, after an ID3 tag", () => {
    const id3 = concat(text("ID3"), Uint8Array.from([4, 0, 0, 0, 0, 0, 20]), new Uint8Array(20));
    const xing = frame();
    xing.set(text("Xing"), 4 + 32);
    new DataView(xing.buffer).setUint32(4 + 32 + 4, 1);
    new DataView(xing.buffer).setUint32(4 + 32 + 8, 5000);
    const file = concat(id3, xing, frame(), frame());
    expect(mediaDurationMs(file, "mp3")).toBe(Math.round((5000 * 1152 * 1000) / 44_100));
  });

  it("returns null without a frame", () => {
    expect(mediaDurationMs(concat(text("ID3"), Uint8Array.from([4, 0, 0, 0, 0, 0, 2]), new Uint8Array(400)), "mp3")).toBeNull();
  });
});

describe("mediaDurationMs: Ogg", () => {
  const page = (serial: number, granule: bigint, packet: Uint8Array) => {
    const header = new Uint8Array(27);
    header.set(text("OggS"));
    const data = new DataView(header.buffer);
    data.setBigInt64(6, granule, true);
    data.setUint32(14, serial, true);
    header[26] = 1;
    return concat(header, Uint8Array.from([packet.length]), packet);
  };

  it("reads Opus from the last granule, minus pre-skip, at 48 kHz", () => {
    const head = concat(text("OpusHead"), Uint8Array.from([1, 2, 0x38, 0x01]), new Uint8Array(8));
    const file = concat(page(7, 0n, head), page(7, 48_000n, new Uint8Array(10)), page(7, 48_000n * 3n + 312n, new Uint8Array(10)), page(7, -1n, new Uint8Array(5)));
    expect(mediaDurationMs(file, "ogg")).toBe(3000);
  });

  it("reads Vorbis at its own sample rate and ignores other streams", () => {
    const ident = concat(Uint8Array.from([1]), text("vorbis"), new Uint8Array([0, 0, 0, 0, 2]), Uint8Array.from([0x44, 0xac, 0, 0]), new Uint8Array(16));
    const file = concat(page(1, 0n, ident), page(1, 44_100n * 2n, new Uint8Array(10)), page(9, 999_999_999n, new Uint8Array(10)));
    expect(mediaDurationMs(file, "ogg")).toBe(2000);
  });
});

describe("mediaDurationMs: anything else", () => {
  it("never throws on junk or truncated files", () => {
    for (const ext of ["mp4", "m4a", "wav", "webm", "mp3", "ogg", "png"]) {
      expect(mediaDurationMs(new Uint8Array(0), ext)).toBeNull();
      expect(mediaDurationMs(Uint8Array.from({ length: 64 }, (_, i) => (i * 37) % 256), ext)).toBeNull();
    }
    expect(mediaDurationMs(text("RIFF\0\0\0\0WAVEfmt "), "wav")).toBeNull();
  });
});
