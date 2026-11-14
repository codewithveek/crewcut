/**
 * When a media link from the server stops working, in ms since the epoch.
 * Local files get `/api/media/…?exp=<ms>&sig=…`; files in the bucket get
 * presigned links (`X-Amz-Date=<yyyymmddThhmmssZ>&X-Amz-Expires=<seconds>`).
 * Anything else (a public address) never expires: Infinity.
 */
export function linkExpiresAt(url: string): number {
  const exp = /[?&]exp=(\d+)(?:&|$)/.exec(url);
  if (exp) return Number(exp[1]);
  const date = /[?&]X-Amz-Date=(\d{8}T\d{6}Z)(?:&|$)/i.exec(url)?.[1];
  const seconds = /[?&]X-Amz-Expires=(\d+)(?:&|$)/i.exec(url)?.[1];
  if (date && seconds) {
    const signedAt = Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(4, 6)) - 1,
      Number(date.slice(6, 8)),
      Number(date.slice(9, 11)),
      Number(date.slice(11, 13)),
      Number(date.slice(13, 15)),
    );
    if (Number.isFinite(signedAt)) return signedAt + Number(seconds) * 1000;
  }
  return Number.POSITIVE_INFINITY;
}
