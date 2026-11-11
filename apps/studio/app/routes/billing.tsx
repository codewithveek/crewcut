import { Navigate, useLocation } from "react-router";

export function meta() {
  return [{ title: "Plan & credits — Crewcut" }];
}

export default function BillingRoute() {
  // Plan & credits lives in Settings now; old links (and the payment provider's return link) keep working.
  const { search } = useLocation();
  return <Navigate to={`/settings/plan${search}`} replace />;
}
