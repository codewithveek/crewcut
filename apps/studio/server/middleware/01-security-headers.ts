import { defineEventHandler } from "h3";

/**
 * Browser security headers for everything the app serves.
 *
 * - nosniff: a response is only ever treated as the type it says it is.
 * - Referrer-Policy: other sites learn the origin, never the page (video and
 *   project ids live in paths).
 * - HSTS (production): browsers refuse plain http for a year.
 * - Framing: app pages may only be framed by the app itself, so another site
 *   can't load Crewcut invisibly and trick a signed-in person into clicking
 *   (publish, delete, pay). The framework's own embed and MCP routes set their
 *   framing rules themselves and are left alone.
 *
 * Headers set here are merged into whatever the route returns; a route that
 * sets the same header keeps its own value.
 */
const FRAMEWORK_ROUTES = /^\/(?:_agent-native|mcp|\.well-known)(?:\/|$)/;

export default defineEventHandler((event) => {
  const headers = event.res.headers;
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  if (process.env.NODE_ENV === "production") headers.set("strict-transport-security", "max-age=31536000");
  if (!FRAMEWORK_ROUTES.test(event.url.pathname)) {
    headers.set("x-frame-options", "SAMEORIGIN");
    headers.set("content-security-policy", "frame-ancestors 'self'");
  }
});
