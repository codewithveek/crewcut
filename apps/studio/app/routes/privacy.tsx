import { LegalPage, legalLinks, legalMeta } from "@/components/landing/legal/legal-page";
import { privacyDoc } from "@/components/landing/legal/privacy";

export const links = legalLinks;
export const meta = legalMeta("privacy", "A plain account of what Crewcut collects, why, who it is shared with, how long it is kept and your rights.");

export default function LegalRoute() {
  return <LegalPage doc={privacyDoc} />;
}
