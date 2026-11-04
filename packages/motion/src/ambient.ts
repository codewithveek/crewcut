/**
 * Ambient motion (float, drift, pulse, sway): deterministic functions of time
 * and a seed — no Math.random(), no clocks — so every render matches.
 */
export type AmbientKind = "float" | "drift" | "pulse" | "sway";

export interface AmbientMotion {
  kind: AmbientKind;
  /** Design pixels for float/drift, scale delta for pulse, degrees for sway. */
  amplitude: number;
  periodMs: number;
}

export interface AmbientOffset {
  offsetX: number;
  offsetY: number;
  scale: number;
  rotation: number;
}

export function seededUnit(seed: string | number): number {
  let hash = 2166136261;
  const text = String(seed);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  let state = hash >>> 0;
  state = Math.imul(state ^ (state >>> 15), state | 1);
  state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
  return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
}

export function ambientOffset(motion: AmbientMotion, timeMs: number, seed: string | number): AmbientOffset {
  const phase = seededUnit(seed) * Math.PI * 2;
  const angle = (timeMs / Math.max(1, motion.periodMs)) * Math.PI * 2 + phase;
  switch (motion.kind) {
    case "float":
      return { offsetX: 0, offsetY: Math.sin(angle) * motion.amplitude, scale: 1, rotation: 0 };
    case "drift":
      return {
        offsetX: Math.sin(angle) * motion.amplitude,
        offsetY: Math.cos(angle * 0.7) * motion.amplitude * 0.6,
        scale: 1,
        rotation: 0,
      };
    case "pulse":
      return { offsetX: 0, offsetY: 0, scale: 1 + ((Math.sin(angle) + 1) / 2) * motion.amplitude, rotation: 0 };
    case "sway":
      return { offsetX: 0, offsetY: 0, scale: 1, rotation: Math.sin(angle) * motion.amplitude };
  }
}

/** mulberry32: seeded pseudo-random sequence for layout choices. */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
