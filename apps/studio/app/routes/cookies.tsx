import { LegalPage, legalLinks, legalMeta } from "@/components/landing/legal/legal-page";
import { cookiesDoc } from "@/components/landing/legal/cookies";

export const links = legalLinks;
export const meta = legalMeta("cookies", "Every cookie and browser storage item Crewcut uses, what it is for, how long it lasts and how to control it.");

export default function LegalRoute() {
  return <LegalPage doc={cookiesDoc} />;
}
