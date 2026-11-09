import { getAppConfig, getFrameworkSessionCookieValues, getSession, resolveAppHomePath } from "@agent-native/core/server";
import { signInJourney } from "@agent-native/core/shared/sign-in-journey";
import { type H3Event, defineEventHandler, getHeader } from "h3";

import { SIGN_IN_PATHS, isPublicPath } from "../lib/public-paths.js";

/**
 * Sends people to the right side of sign-in before any page renders.
 *
 * The framework serves app pages as one anonymous shell and checks the
 * session after hydration, so a signed-out visit to /home showed skeletons
 * and then jumped to sign-in. Here (before the auth guard; middleware runs in
 * file-name order):
 *
 * - a page request without any session cookie goes straight to /sign-in,
 *   which brings the person back to that page afterwards. Only the cookie's
 *   presence is checked, so signed-in page loads cost nothing extra; a stale
 *   cookie still falls back to the app's own redirect.
 * - a signed-in visit to a sign-in page goes on to where it was headed (or
 *   home). This one validates the session, so a stale cookie can't loop.
 */

/** Framework, API, MCP and dev-server routes answer for themselves. */
const SKIPPED = /^\/(?:_agent-native|api|mcp|\.well-known|assets|_build|@|node_modules|src|__)(?:\/|$)/;

function isPageNavigation(event: H3Event, path: string): boolean {
  const method = event.req.method;
  if (method !== "GET" && method !== "HEAD") return false;
  // Files (".js", ".png", ".json") and React Router data requests (".data").
  if (/\.[A-Za-z0-9]+$/.test(path)) return false;
  const destination = getHeader(event, "sec-fetch-dest")?.toLowerCase();
  if (destination) return destination === "document";
  return getHeader(event, "accept")?.toLowerCase().includes("text/html") ?? false;
}

function hasSessionCookie(event: H3Event): boolean {
  if (getFrameworkSessionCookieValues(event).some(Boolean)) return true;
  // Better Auth's own session cookie (e.g. after Google sign-in).
  return /(?:^|;\s*)(?:__Secure-)?[^=;\s]+\.session_token=[^;\s]/.test(getHeader(event, "cookie") ?? "");
}

const homePath = () => resolveAppHomePath(getAppConfig().app, getAppConfig().workspace);

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } });
}

export default defineEventHandler(async (event) => {
  const path = event.url.pathname;
  if (SKIPPED.test(path) || !isPageNavigation(event, path)) return;

  if ((SIGN_IN_PATHS as readonly string[]).includes(path)) {
    if (!hasSessionCookie(event)) return;
    const session = await getSession(event).catch(() => null);
    if (!session) return;
    const query = event.url.searchParams;
    const { resumeHref } = signInJourney({
      at: `${path}${event.url.search}`,
      continuation: query.get("c"),
      legacyReturn: query.get("return"),
      basePath: "",
      homePath: homePath(),
    });
    return redirect(resumeHref);
  }

  if (isPublicPath(path) || hasSessionCookie(event)) return;
  // The framework's own sign-in link: it carries this page as where to continue afterwards.
  const { signInHref } = signInJourney({ at: `${path}${event.url.search}`, basePath: "", homePath: homePath() });
  return redirect(signInHref ?? "/sign-in");
});
