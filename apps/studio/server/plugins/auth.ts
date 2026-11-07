import { createToolkitAuthPlugin } from "@agent-native/toolkit/app/auth/server";

export default createToolkitAuthPlugin({
  // The landing page ("/" for signed-out visitors, "/welcome" for anyone), the public template gallery,
  // and view-only shared videos: /watch/<id> plus its data route (404 unless the owner shared it publicly)
  // and /api/media, whose files are only served with a valid, expiring signature.
  // The legal pages must be readable without an account (Google's OAuth review checks the privacy policy).
  workspaceAppPublicPaths: ["/", "/welcome", "/gallery", "/watch", "/api/share", "/api/media", "/privacy", "/terms", "/cookies", "/acceptable-use"],
  // Off so "/" renders the landing page instead of the framework's sign-in page;
  // signing in lives at /sign-in, and signed-in visitors to "/" are sent to /home.
  rootAuth: false,
  marketing: false,
  // "By continuing, you agree to…" under the sign-up form.
  signupLegalNotice: { termsUrl: "/terms", privacyUrl: "/privacy", termsLabel: "Terms of Service", privacyLabel: "Privacy Policy" },
});
