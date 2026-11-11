import { createToolkitAuthPlugin } from "@agent-native/toolkit/app/auth/server";

import { PUBLIC_PATHS } from "../lib/public-paths.js";

export default createToolkitAuthPlugin({
  // Landing, gallery, shared videos, signed media and legal pages (see public-paths.ts).
  workspaceAppPublicPaths: [...PUBLIC_PATHS],
  // workspaceAppPublicPaths covers pages only, never /api/*, so these were
  // still asking for a session: /watch showed nothing to signed-out viewers.
  // The public share data returns 404 unless the owner made the video public.
  // Bachs payment webhooks authenticate with their signature, not a session.
  publicPaths: ["/api/share", "/api/billing/webhook", "/api/health"],
  // Media links carry their own expiring signature (checked by the route).
  publicPathsWithQueryToken: [{ path: "/api/media", queryParam: "sig" }],
  // Off so "/" renders the landing page instead of the framework's sign-in page;
  // signing in lives at /sign-in, and signed-in visitors to "/" are sent to /home.
  rootAuth: false,
  marketing: false,
  // "By continuing, you agree to…" under the sign-up form.
  signupLegalNotice: { termsUrl: "/terms", privacyUrl: "/privacy", termsLabel: "Terms of Service", privacyLabel: "Privacy Policy" },
});
