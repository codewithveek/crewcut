/**
 * Where the subject is in a video, worked out in the browser (no upload, no
 * AI credits). Frames are sampled a few times a second and scored at low
 * resolution for movement, detail and skin tones; the centre of the
 * strongest region is the subject. It follows "the busiest, most human part
 * of the picture", which suits talking heads, people and moving objects; it
 * doesn't recognise faces.
 */

export interface SourceSample {
  /** Time in the source file (ms). */
  sourceMs: number;
  x: number;
  y: number;
  weight: number;
}

const ANALYSIS_WIDTH = 96;
const SEEK_TIMEOUT_MS = 8000;

function waitFor(video: HTMLVideoElement, event: "loadedmetadata" | "seeked", timeoutMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (error?: Error) => {
      clearTimeout(timer);
      video.removeEventListener(event, onEvent);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onEvent = () => done();
    const onError = () => done(new Error("The video couldn't be read."));
    const onAbort = () => done(new DOMException("Stopped", "AbortError"));
    const timer = setTimeout(() => done(new Error("The video took too long to load.")), timeoutMs);
    video.addEventListener(event, onEvent, { once: true });
    video.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Saliency centre of one frame (and how distinct it is), given the previous frame's luma for movement. */
export function frameSubject(data: Uint8ClampedArray, width: number, height: number, previous: Float32Array | null): { x: number; y: number; weight: number; luma: Float32Array } {
  const count = width * height;
  const luma = new Float32Array(count);
  const skin = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const r = data[i * 4] as number;
    const g = data[i * 4 + 1] as number;
    const b = data[i * 4 + 2] as number;
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    luma[i] = y;
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    skin[i] = cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173 && y > 40 ? 1 : 0;
  }
  const score = new Float32Array(count);
  let maxDetail = 1;
  let maxMotion = 1;
  const detail = new Float32Array(count);
  const motion = new Float32Array(count);
  for (let row = 1; row < height - 1; row += 1) {
    for (let col = 1; col < width - 1; col += 1) {
      const i = row * width + col;
      const d = Math.abs((luma[i + 1] as number) - (luma[i - 1] as number)) + Math.abs((luma[i + width] as number) - (luma[i - width] as number));
      detail[i] = d;
      if (d > maxDetail) maxDetail = d;
      const m = previous ? Math.abs((luma[i] as number) - (previous[i] as number)) : 0;
      motion[i] = m;
      if (m > maxMotion) maxMotion = m;
    }
  }
  // A cut (most of the frame changed) says nothing about where the subject is.
  let changed = 0;
  for (let i = 0; i < count; i += 1) if ((motion[i] as number) > 40) changed += 1;
  const cut = changed > count * 0.55;
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const i = row * width + col;
      const dx = col / (width - 1) - 0.5;
      const dy = row / (height - 1) - 0.45;
      const centre = 1 - 0.35 * Math.min(1, Math.sqrt(dx * dx + dy * dy) * 1.6);
      score[i] = (0.45 * ((detail[i] as number) / maxDetail) + (cut ? 0 : 0.35 * ((motion[i] as number) / maxMotion)) + 0.25 * (skin[i] as number)) * centre;
    }
  }
  // Centre of the strongest 25%.
  const sorted = Float32Array.from(score).sort();
  const threshold = sorted[Math.floor(count * 0.75)] ?? 0;
  let sum = 0;
  let sx = 0;
  let sy = 0;
  let mean = 0;
  for (let i = 0; i < count; i += 1) mean += score[i] as number;
  mean /= count;
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const value = score[row * width + col] as number;
      if (value < threshold || value <= 0) continue;
      sum += value;
      sx += value * (col + 0.5);
      sy += value * (row + 0.5);
    }
  }
  if (sum <= 0) return { x: 0.5, y: 0.5, weight: 0, luma };
  const topMean = sum / Math.max(1, count * 0.25);
  // Distinct subjects stand out from the frame's average; flat frames get little say.
  const weight = cut ? 0.05 : Math.max(0, Math.min(1, (topMean / Math.max(1e-6, mean) - 1) / 2));
  return { x: sx / sum / width, y: sy / sum / height, weight, luma };
}

/**
 * Samples the video at `sourceTimes` (ms) and returns where its subject is
 * at each, plus the picture's shape. Needs a link the page may read pixels
 * from (same origin, or CORS-enabled storage).
 */
export async function trackSubject(url: string, sourceTimes: readonly number[], options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {}): Promise<{ samples: SourceSample[]; aspect: number; durationMs: number }> {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    video.src = url;
    await waitFor(video, "loadedmetadata", 20_000, options.signal);
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (!sourceWidth || !sourceHeight) throw new Error("The video has no picture to follow.");
    const width = sourceWidth >= sourceHeight ? ANALYSIS_WIDTH : Math.max(16, Math.round((ANALYSIS_WIDTH * sourceWidth) / sourceHeight));
    const height = sourceWidth >= sourceHeight ? Math.max(16, Math.round((ANALYSIS_WIDTH * sourceHeight) / sourceWidth)) : ANALYSIS_WIDTH;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("This browser can't analyse video frames.");
    const durationMs = Number.isFinite(video.duration) ? video.duration * 1000 : Number.POSITIVE_INFINITY;
    const samples: SourceSample[] = [];
    let previous: Float32Array | null = null;
    for (const [index, sourceMs] of sourceTimes.entries()) {
      if (options.signal?.aborted) throw new DOMException("Stopped", "AbortError");
      const target = Math.min(Math.max(0, sourceMs), Math.max(0, durationMs - 50)) / 1000;
      if (Math.abs(video.currentTime - target) > 0.001) {
        video.currentTime = target;
        await waitFor(video, "seeked", SEEK_TIMEOUT_MS, options.signal);
      }
      context.drawImage(video, 0, 0, width, height);
      let pixels: ImageData;
      try {
        pixels = context.getImageData(0, 0, width, height);
      } catch {
        throw new Error("This video's pictures can't be read here (its storage doesn't allow it), so it can't be followed.");
      }
      const result = frameSubject(pixels.data, width, height, previous);
      previous = result.luma;
      samples.push({ sourceMs, x: result.x, y: result.y, weight: result.weight });
      options.onProgress?.((index + 1) / sourceTimes.length);
    }
    return { samples, aspect: sourceWidth / sourceHeight, durationMs };
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}
