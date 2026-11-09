import { LEGAL_PATHS } from "./legal/legal-info";

/** "/" shows the landing page to signed-out visitors; "/welcome" shows it to anyone (and in local dev, where you're always signed in); "/gallery" is the public template gallery; "/watch/<id>" is a video shared view-only; the legal pages (/privacy, /terms, /cookies, /acceptable-use) are public too. */
export function isLandingPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/welcome" || pathname === "/gallery" || pathname === "/pricing" || pathname.startsWith("/watch/") || LEGAL_PATHS.includes(pathname);
}
