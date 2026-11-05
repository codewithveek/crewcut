import { useParams } from "react-router";

import { ProofReportPage } from "@/components/crewcut/proof-report";

export function meta() {
  return [{ title: "Proof report — Crewcut" }];
}

export default function ProofReportRoute() {
  const { videoId } = useParams();
  if (!videoId) return null;
  return <ProofReportPage videoId={videoId} />;
}
