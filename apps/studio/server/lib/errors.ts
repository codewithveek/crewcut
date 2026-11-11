/**
 * An error whose message is written for the person ("Export the video
 * first."). The framework returns it as-is with a 4xx status; a bare
 * `throw new Error()` is treated as an unexpected failure and shown only as
 * "Internal server error", so actions throw this for anything people should read.
 */
export class UserError extends Error {
  override readonly name: string = "UserError";
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * A refusal a plan would lift ("Autopilot is part of Creator"). It travels as
 * HTTP 402 with a code naming the feature, so the app opens the upgrade
 * dialog for that feature instead of showing an error.
 */
export type UpgradeFeature = "export-length" | "export-hd" | "no-ending" | "autopilot" | "pro-content" | "channels" | "credits";

export class UpgradeRequiredError extends UserError {
  override readonly name = "UpgradeRequiredError";
  readonly errorCode: string;
  /** The framework passes typed codes through only for errors marked as expected. */
  readonly expected = true;

  constructor(feature: UpgradeFeature, message: string) {
    super(message, 402);
    this.errorCode = `upgrade:${feature}`;
  }
}
