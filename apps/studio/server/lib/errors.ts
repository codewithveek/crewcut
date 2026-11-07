/**
 * An error whose message is written for the person ("Export the video
 * first."). The framework returns it as-is with a 4xx status; a bare
 * `throw new Error()` is treated as an unexpected failure and shown only as
 * "Internal server error", so actions throw this for anything people should read.
 */
export class UserError extends Error {
  override readonly name = "UserError";
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}
