import { createToolkitAuthPlugin } from "@agent-native/toolkit/app/auth/server";

export default createToolkitAuthPlugin({
  // The landing page ("/" for signed-out visitors, "/welcome" for anyone) and the public template gallery.
  workspaceAppPublicPaths: ["/", "/welcome", "/gallery"],
  // Off so "/" renders the landing page instead of the framework's sign-in page;
  // signing in lives at /sign-in, and signed-in visitors to "/" are sent to /home.
  rootAuth: false,
  marketing: false,
});
