import { useParams } from "react-router";

import { ProofReportPage } from "@/components/proofcut/proof-report";

export function meta() {
  return [{ title: "Proof report — Proofcut" }];
}

export default function ProofReportRoute() {
  const { videoId } = useParams();
  if (!videoId) return null;
  return <ProofReportPage videoId={videoId} />;
}
