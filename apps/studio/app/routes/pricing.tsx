import type { MetaFunction } from "react-router";

import { landingLinks } from "@/components/landing/landing-meta";
import { PricingPage } from "@/components/landing/pricing-page";
import { OG_HOME, pageMeta } from "@/components/landing/seo";

export const links = landingLinks;

export const meta: MetaFunction = () =>
  pageMeta({
    title: "Pricing · Crewcut",
    description: "Start free. Creator adds autopilot, more AI credits, Pro templates and 4K export; Studio adds a team and five channels. Bring your own AI keys on any plan.",
    path: "/pricing",
    image: OG_HOME,
  });

/** The public pricing page. */
export default function PricingRoute() {
  return <PricingPage />;
}
