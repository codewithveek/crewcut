/**
 * Springs in Apple's two parameters (damping ratio ζ and response in seconds),
 * per the masterplan's motion system and Emil Kowalski's `apple-design` skill.
 *
 * Remotion's spring() takes stiffness/damping/mass, so `toRemotionSpring`
 * converts with mass m = 1:
 *   k = (2π / response)² · m      c = 4π · ζ · m / response
 *
 * `springProgress` is the closed-form step response of the same oscillator,
 * so the editor preview, the Remotion player and the server render all compute
 * identical values for a given time (no frame-by-frame integration drift).
 */

export interface AppleSpring {
  /** ζ. 1 = critically damped (no overshoot); ~0.8 implies momentum. */
  dampingRatio: number;
  /** Seconds to (approximately) reach the target. */
  response: number;
}

export interface RemotionSpringConfig {
  stiffness: number;
  damping: number;
  mass: number;
}

const TWO_PI = Math.PI * 2;

export function toRemotionSpring(spring: AppleSpring, mass = 1): RemotionSpringConfig {
  assertSpring(spring);
  const angularFrequency = TWO_PI / spring.response;
  return {
    stiffness: angularFrequency * angularFrequency * mass,
    damping: (4 * Math.PI * spring.dampingRatio * mass) / spring.response,
    mass,
  };
}

export function fromRemotionSpring(config: RemotionSpringConfig): AppleSpring {
  const angularFrequency = Math.sqrt(config.stiffness / config.mass);
  return {
    response: TWO_PI / angularFrequency,
    dampingRatio: config.damping / (2 * Math.sqrt(config.stiffness * config.mass)),
  };
}

/**
 * Normalised position (0 → 1) of a spring released from rest at 0 towards 1,
 * `elapsedSeconds` after release. Underdamped springs overshoot past 1.
 */
export function springProgress(spring: AppleSpring, elapsedSeconds: number): number {
  assertSpring(spring);
  if (elapsedSeconds <= 0) return 0;
  const omega = TWO_PI / spring.response;
  const zeta = spring.dampingRatio;
  const t = elapsedSeconds;

  if (Math.abs(zeta - 1) < 1e-6) {
    return 1 - Math.exp(-omega * t) * (1 + omega * t);
  }
  if (zeta < 1) {
    const dampedOmega = omega * Math.sqrt(1 - zeta * zeta);
    const envelope = Math.exp(-zeta * omega * t);
    return (
      1 -
      envelope *
        (Math.cos(dampedOmega * t) + ((zeta * omega) / dampedOmega) * Math.sin(dampedOmega * t))
    );
  }
  const root = Math.sqrt(zeta * zeta - 1);
  const fastRate = -omega * (zeta - root);
  const slowRate = -omega * (zeta + root);
  return 1 + (slowRate * Math.exp(fastRate * t) - fastRate * Math.exp(slowRate * t)) / (fastRate - slowRate);
}

/** Seconds until the spring stays within `tolerance` of its target. */
export function springSettleSeconds(spring: AppleSpring, tolerance = 0.001): number {
  assertSpring(spring);
  const stepSeconds = 1 / 240;
  const maxSeconds = spring.response * 12;
  let lastOutside = 0;
  for (let t = 0; t <= maxSeconds; t += stepSeconds) {
    if (Math.abs(1 - springProgress(spring, t)) > tolerance) lastOutside = t;
  }
  return Math.min(maxSeconds, lastOutside + stepSeconds);
}

/** Largest overshoot past the target, as a fraction (0 for ζ ≥ 1). */
export function springOvershoot(spring: AppleSpring): number {
  if (spring.dampingRatio >= 1) return 0;
  const zeta = spring.dampingRatio;
  return Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta));
}

function assertSpring(spring: AppleSpring): void {
  if (!(spring.response > 0) || !Number.isFinite(spring.response)) {
    throw new RangeError(`Spring response must be a positive number of seconds, got ${spring.response}`);
  }
  if (!(spring.dampingRatio > 0) || !Number.isFinite(spring.dampingRatio)) {
    throw new RangeError(`Spring damping ratio must be positive, got ${spring.dampingRatio}`);
  }
}

/**
 * Named springs. Critically damped is the default (no overshoot); `momentum`
 * is reserved for motion that implies a throw, per the masterplan.
 */
export const SPRINGS = {
  snappy: { dampingRatio: 1, response: 0.35 },
  smooth: { dampingRatio: 1, response: 0.45 },
  gentle: { dampingRatio: 1, response: 0.6 },
  momentum: { dampingRatio: 0.8, response: 0.5 },
  bouncy: { dampingRatio: 0.65, response: 0.55 },
} as const satisfies Record<string, AppleSpring>;

export type SpringName = keyof typeof SPRINGS;
