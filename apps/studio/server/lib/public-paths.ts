/**
 * Pages and routes anyone may open without signing in. "/" matches only the
 * root; every other entry also covers what's under it ("/watch" → "/watch/<id>").
 *
 * The landing page ("/" for signed-out visitors, "/welcome" for anyone), the
 * public template gallery, view-only shared videos (/watch/<id> plus its data
 * route, 404 unless the owner shared it publicly), /api/media (files are only
 * served with a valid, expiring signature) and the legal pages (Google's OAuth
 * review checks the privacy policy).
 */
export const PUBLIC_PATHS = ["/", "/welcome", "/gallery", "/watch", "/api/share", "/api/media", "/privacy", "/terms", "/cookies", "/acceptable-use"] as const;

/** The framework's sign-in pages (it serves them itself). */
export const SIGN_IN_PATHS = ["/sign-in", "/login", "/signup"] as const;

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.some((entry) => (entry === "/" ? path === "/" : path === entry || path.startsWith(`${entry}/`)));
}
