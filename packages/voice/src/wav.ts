/** Minimal WAV codec (16-bit PCM out; 16-bit or 32-bit float in), from Cutroom's audio-io. */
export interface PcmAudio {
  sampleRate: number;
  channels: Float32Array[];
}

export function encodeWav(audio: PcmAudio): Uint8Array {
  const channelCount = Math.max(1, audio.channels.length);
  const frames = audio.channels[0]?.length ?? 0;
  const dataBytes = frames * channelCount * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeString = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = Math.max(-1, Math.min(1, audio.channels[channel]?.[frame] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Uint8Array(buffer);
}

export function decodeWav(bytes: Uint8Array): PcmAudio {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("Not a WAV file");
  let offset = 12;
  let format = 1;
  let channelCount = 1;
  let sampleRate = 44_100;
  let bitsPerSample = 16;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      format = view.getUint16(body, true);
      channelCount = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === "data") {
      const bytesPerSample = bitsPerSample / 8;
      const frames = Math.floor(size / (bytesPerSample * channelCount));
      const channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
      for (let frame = 0; frame < frames; frame += 1) {
        for (let channel = 0; channel < channelCount; channel += 1) {
          const position = body + (frame * channelCount + channel) * bytesPerSample;
          const target = channels[channel];
          if (!target) continue;
          target[frame] = format === 3 && bitsPerSample === 32 ? view.getFloat32(position, true) : view.getInt16(position, true) / 32768;
        }
      }
      return { sampleRate, channels };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}

export function durationMsOf(audio: PcmAudio): number {
  return Math.round(((audio.channels[0]?.length ?? 0) / audio.sampleRate) * 1000);
}

/** Max absolute value per bucket, normalised to 0..1 — the timeline waveform. */
export function peaksFromPcm(samples: Float32Array, buckets: number): number[] {
  const peaks: number[] = [];
  const size = Math.max(1, Math.floor(samples.length / buckets));
  let max = 0;
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    let peak = 0;
    for (let index = bucket * size; index < Math.min(samples.length, (bucket + 1) * size); index += 1) {
      peak = Math.max(peak, Math.abs(samples[index] ?? 0));
    }
    peaks.push(peak);
    max = Math.max(max, peak);
  }
  return peaks.map((peak) => (max > 0 ? Math.round((peak / max) * 1000) / 1000 : 0));
}
