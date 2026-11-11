/**
 * Browser security headers on every response.
 *
 * The middleware (01-security-headers.ts) sets them for responses the server
 * builds itself (pages). A route that returns its own `Response` (the API
 * routes, media, actions) never sees those, so this adds the same headers to
 * every finished response that doesn't already carry them.
 */
const FRAMEWORK_ROUTES = /^\/(?:_agent-native|mcp|\.well-known)(?:\/|$)/;

interface Hooks {
  hook(name: "response", handler: (response: Response, event: { url?: URL; req?: Request }) => void): void;
}

export default function securityHeadersPlugin(nitroApp?: { hooks?: Hooks }): void {
  nitroApp?.hooks?.hook?.("response", (response, event) => {
    try {
      const headers = response.headers;
      const add = (name: string, value: string) => {
        if (!headers.has(name)) headers.set(name, value);
      };
      add("x-content-type-options", "nosniff");
      add("referrer-policy", "strict-origin-when-cross-origin");
      if (process.env.NODE_ENV === "production") add("strict-transport-security", "max-age=31536000");
      const path = event.url?.pathname ?? (event.req ? new URL(event.req.url).pathname : "");
      if (!FRAMEWORK_ROUTES.test(path)) {
        add("x-frame-options", "SAMEORIGIN");
        add("content-security-policy", "frame-ancestors 'self'");
      }
    } catch {
      // Some responses (redirects made with Response.redirect, proxied bodies) have read-only headers.
    }
  });
}
