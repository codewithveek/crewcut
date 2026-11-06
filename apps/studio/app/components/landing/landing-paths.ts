/** "/" shows the landing page to signed-out visitors; "/welcome" shows it to anyone (and in local dev, where you're always signed in); "/gallery" is the public template gallery. */
export function isLandingPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/welcome" || pathname === "/gallery";
}
