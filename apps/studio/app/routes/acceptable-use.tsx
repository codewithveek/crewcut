import { LegalPage, legalLinks, legalMeta } from "@/components/landing/legal/legal-page";
import { acceptableUseDoc } from "@/components/landing/legal/acceptable-use";

export const links = legalLinks;
export const meta = legalMeta("acceptable-use", "What you may not use Crewcut's AI crew, editor and publishing for, and how to report misuse.");

export default function LegalRoute() {
  return <LegalPage doc={acceptableUseDoc} />;
}
