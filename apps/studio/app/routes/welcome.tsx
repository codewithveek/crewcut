import { LandingPage } from "@/components/landing/landing-page";
import { landingLinks, landingMeta } from "@/components/landing/landing-meta";

export const links = landingLinks;
export const meta = landingMeta;

/** The landing page for anyone, signed in or not (and in local development, where you're always signed in). */
export default function WelcomeRoute() {
  return <LandingPage />;
}
