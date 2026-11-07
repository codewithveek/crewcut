import { LegalPage, legalLinks, legalMeta } from "@/components/landing/legal/legal-page";
import { termsDoc } from "@/components/landing/legal/terms";

export const links = legalLinks;
export const meta = legalMeta("terms", "The agreement for using Crewcut: your account, your content, AI output, plans, and the law that applies.");

export default function LegalRoute() {
  return <LegalPage doc={termsDoc} />;
}
