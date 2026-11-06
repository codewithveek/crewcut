import { useSession } from "@agent-native/core/client/use-session";
import { useEffect } from "react";
import { useNavigate } from "react-router";

import { LandingPage } from "@/components/landing/landing-page";
import { landingLinks, landingMeta } from "@/components/landing/landing-meta";
import { HOME_PATH } from "@/lib/chat-paths";

export const links = landingLinks;
export const meta = landingMeta;

/** Signed-out visitors get the landing page; people already signed in go straight to Home. */
export default function IndexRoute() {
  const { status } = useSession();
  const navigate = useNavigate();
  useEffect(() => {
    if (status === "authenticated") navigate(HOME_PATH, { replace: true });
  }, [status, navigate]);
  return <LandingPage />;
}
