/**
 * How long an audio or video file plays, read from its own headers: MP4/M4A
 * (mvhd), WAV (data size ÷ byte rate), WebM/Matroska (Segment Info), MP3
 * (Xing/Info or VBRI frame count, else constant bitrate) and Ogg (last
 * granule position). No decoding and no outside tools. Every loop advances
 * or stops, so malformed files return null instead of hanging.
 */

type Ext = string;

export function mediaDurationMs(bytes: Uint8Array, ext: Ext): number | null {
  try {
    const seconds =
      ext === "mp4" || ext === "m4a"
        ? mp4Seconds(bytes)
        : ext === "wav"
          ? wavSeconds(bytes)
          : ext === "webm"
            ? webmSeconds(bytes)
            : ext === "mp3"
              ? mp3Seconds(bytes)
              : ext === "ogg"
                ? oggSeconds(bytes)
                : null;
    if (seconds === null || !Number.isFinite(seconds) || seconds <= 0 || seconds > 24 * 60 * 60) return null;
    return Math.round(seconds * 1000);
  } catch {
    return null;
  }
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  if (start < 0 || start + length > bytes.length) return "";
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

// ── MP4 / M4A ───────────────────────────────────────────────────────────────

/** Children of a box range: [type, dataStart, end]. */
function* boxes(bytes: Uint8Array, start: number, end: number): Generator<[string, number, number]> {
  const data = view(bytes);
  let at = start;
  while (at + 8 <= end) {
    let size = data.getUint32(at);
    const type = ascii(bytes, at + 4, 4);
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) return;
      const big = data.getBigUint64(at + 8);
      if (big > BigInt(end - at)) return;
      size = Number(big);
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) return;
    yield [type, at + header, at + size];
    at += size;
  }
}

function mp4Seconds(bytes: Uint8Array): number | null {
  const data = view(bytes);
  for (const [type, start, end] of boxes(bytes, 0, bytes.length)) {
    if (type !== "moov") continue;
    for (const [inner, from, to] of boxes(bytes, start, end)) {
      if (inner !== "mvhd") continue;
      const version = bytes[from];
      if (version === 1) {
        if (from + 32 > to) return null;
        const timescale = data.getUint32(from + 20);
        const duration = Number(data.getBigUint64(from + 24));
        return timescale ? duration / timescale : null;
      }
      if (from + 20 > to) return null;
      const timescale = data.getUint32(from + 12);
      const duration = data.getUint32(from + 16);
      // All ones means "unknown" (fragmented files).
      return timescale && duration !== 0xffffffff ? duration / timescale : null;
    }
  }
  return null;
}

// ── WAV ─────────────────────────────────────────────────────────────────────

function wavSeconds(bytes: Uint8Array): number | null {
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") return null;
  const data = view(bytes);
  let byteRate = 0;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = ascii(bytes, at, 4);
    const size = data.getUint32(at + 4, true);
    if (id === "fmt " && at + 16 <= bytes.length) byteRate = data.getUint32(at + 16, true);
    if (id === "data") {
      // Streamed WAVs write 0 or 0xFFFFFFFF here: use what is actually there.
      const available = bytes.length - (at + 8);
      const length = size === 0 || size === 0xffffffff || size > available ? available : size;
      return byteRate ? length / byteRate : null;
    }
    at += 8 + size + (size % 2);
  }
  return null;
}

// ── WebM / Matroska ─────────────────────────────────────────────────────────

/** An EBML variable-length number: its length and value (id keeps the marker bit, sizes drop it). */
function vint(bytes: Uint8Array, at: number, keepMarker: boolean): { length: number; value: number; unknown: boolean } | null {
  const first = bytes[at];
  if (first === undefined || first === 0) return null;
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length += 1;
  if (length > 8 || at + length > bytes.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i += 1) {
    const byte = bytes[at + i] as number;
    value = value * 256 + byte;
    if (byte !== 0xff) allOnes = false;
  }
  return { length, value, unknown: !keepMarker && allOnes };
}

function* elements(bytes: Uint8Array, start: number, end: number): Generator<{ id: number; dataStart: number; dataEnd: number }> {
  let at = start;
  while (at < end) {
    const id = vint(bytes, at, true);
    if (!id) return;
    const size = vint(bytes, at + id.length, false);
    if (!size) return;
    const dataStart = at + id.length + size.length;
    const dataEnd = size.unknown ? end : Math.min(end, dataStart + size.value);
    if (dataStart > end) return;
    yield { id: id.value, dataStart, dataEnd };
    if (size.unknown || dataEnd <= at) return;
    at = dataEnd;
  }
}

const EBML_SEGMENT = 0x18538067;
const EBML_INFO = 0x1549a966;
const EBML_TIMECODE_SCALE = 0x2ad7b1;
const EBML_DURATION = 0x4489;

function webmSeconds(bytes: Uint8Array): number | null {
  const data = view(bytes);
  for (const top of elements(bytes, 0, bytes.length)) {
    if (top.id !== EBML_SEGMENT) continue;
    for (const child of elements(bytes, top.dataStart, top.dataEnd)) {
      if (child.id !== EBML_INFO) continue;
      let scale = 1_000_000;
      let duration: number | null = null;
      for (const field of elements(bytes, child.dataStart, child.dataEnd)) {
        const length = field.dataEnd - field.dataStart;
        if (field.id === EBML_TIMECODE_SCALE && length > 0 && length <= 8) {
          let value = 0;
          for (let i = field.dataStart; i < field.dataEnd; i += 1) value = value * 256 + (bytes[i] as number);
          if (value > 0) scale = value;
        }
        if (field.id === EBML_DURATION) duration = length === 4 ? data.getFloat32(field.dataStart) : length === 8 ? data.getFloat64(field.dataStart) : null;
      }
      // Browser recordings (MediaRecorder) leave Duration out.
      return duration === null ? null : (duration * scale) / 1e9;
    }
    return null;
  }
  return null;
}

// ── MP3 ─────────────────────────────────────────────────────────────────────

const MP3_BITRATES: Record<string, number[]> = {
  // [version][layer] → kbps by index (MPEG1 L1/L2/L3, MPEG2/2.5 L1, L2&L3).
  "1-1": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  "1-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2-1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  "2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  "2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP3_RATES: Record<number, number[]> = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 25: [11025, 12000, 8000] };

interface Mp3Frame {
  version: 1 | 2 | 25;
  layer: 1 | 2 | 3;
  kbps: number;
  sampleRate: number;
  mono: boolean;
  samples: number;
  /** Bytes in this frame, header included. */
  length: number;
}

function mp3Frame(bytes: Uint8Array, at: number): Mp3Frame | null {
  const b1 = bytes[at + 1] ?? 0;
  const b2 = bytes[at + 2] ?? 0;
  const b3 = bytes[at + 3] ?? 0;
  if (bytes[at] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const versionBits = (b1 >> 3) & 3;
  const layerBits = (b1 >> 1) & 3;
  if (versionBits === 1 || layerBits === 0) return null;
  const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 25;
  const layer = (4 - layerBits) as 1 | 2 | 3;
  const bitrateIndex = b2 >> 4;
  const rateIndex = (b2 >> 2) & 3;
  if (bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const kbps = MP3_BITRATES[`${version === 1 ? 1 : 2}-${layer}`]?.[bitrateIndex];
  const sampleRate = MP3_RATES[version]?.[rateIndex];
  if (!kbps || !sampleRate) return null;
  const samples = layer === 1 ? 384 : layer === 2 || version === 1 ? 1152 : 576;
  const padding = (b2 >> 1) & 1;
  const length =
    layer === 1 ? (Math.floor((12 * kbps * 1000) / sampleRate) + padding) * 4 : Math.floor(((layer === 3 && version !== 1 ? 72 : 144) * kbps * 1000) / sampleRate) + padding;
  return { version, layer, kbps, sampleRate, mono: b3 >> 6 === 3, samples, length };
}

function mp3Seconds(bytes: Uint8Array): number | null {
  const data = view(bytes);
  let at = 0;
  // ID3v2 tags (there can be more than one) come before the audio.
  while (ascii(bytes, at, 3) === "ID3" && at + 10 <= bytes.length) {
    const size = ((bytes[at + 6]! & 0x7f) << 21) | ((bytes[at + 7]! & 0x7f) << 14) | ((bytes[at + 8]! & 0x7f) << 7) | (bytes[at + 9]! & 0x7f);
    at += 10 + size + (bytes[at + 5]! & 0x10 ? 10 : 0);
  }
  // The first real frame: one followed by another (or by the end), so a stray 0xFFE in junk isn't mistaken for audio.
  let frame: Mp3Frame | null = null;
  const searchEnd = Math.min(bytes.length - 4, at + 64 * 1024);
  for (; at < searchEnd; at += 1) {
    const candidate = mp3Frame(bytes, at);
    if (!candidate) continue;
    const next = at + candidate.length;
    if (next + 4 > bytes.length || mp3Frame(bytes, next)) {
      frame = candidate;
      break;
    }
  }
  if (!frame) return null;
  let end = bytes.length;
  if (ascii(bytes, end - 128, 3) === "TAG") end -= 128;

  const sideInfo = frame.version === 1 ? (frame.mono ? 17 : 32) : frame.mono ? 9 : 17;
  const xing = at + 4 + sideInfo;
  const tag = ascii(bytes, xing, 4);
  if ((tag === "Xing" || tag === "Info") && xing + 12 <= bytes.length) {
    const flags = data.getUint32(xing + 4);
    if (flags & 1) {
      const frames = data.getUint32(xing + 8);
      if (frames > 0) return (frames * frame.samples) / frame.sampleRate;
    }
  }
  if (ascii(bytes, at + 36, 4) === "VBRI" && at + 36 + 18 <= bytes.length) {
    const frames = data.getUint32(at + 36 + 14);
    if (frames > 0) return (frames * frame.samples) / frame.sampleRate;
  }
  // Constant bitrate: the audio's size at the first frame's bitrate.
  return ((end - at) * 8) / (frame.kbps * 1000);
}

// ── Ogg (Vorbis, Opus) ──────────────────────────────────────────────────────

function oggSeconds(bytes: Uint8Array): number | null {
  if (ascii(bytes, 0, 4) !== "OggS") return null;
  const data = view(bytes);
  // The first page's packet says the codec and its clock.
  const segments = bytes[26] ?? 0;
  const packet = 27 + segments;
  let rate = 0;
  let preSkip = 0;
  if (ascii(bytes, packet, 8) === "OpusHead") {
    rate = 48_000; // Opus granules always count 48 kHz samples.
    preSkip = data.getUint16(packet + 10, true);
  } else if (ascii(bytes, packet + 1, 6) === "vorbis" && bytes[packet] === 1) {
    rate = data.getUint32(packet + 12, true);
  }
  if (!rate) return null;
  const serial = data.getUint32(14, true);
  // The last page of this stream with a real granule position.
  for (let at = bytes.length - 27; at >= 0; at -= 1) {
    if (bytes[at] !== 0x4f || ascii(bytes, at, 4) !== "OggS") continue;
    if (data.getUint32(at + 14, true) !== serial) continue;
    const granule = data.getBigInt64(at + 6, true);
    if (granule < 0n) continue;
    const samples = Number(granule) - preSkip;
    return samples > 0 ? samples / rate : null;
  }
  return null;
}
