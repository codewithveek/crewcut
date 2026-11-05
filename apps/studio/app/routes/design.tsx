import { Navigate } from "react-router";

import { DesignPage } from "@/components/crewcut/dashboard/design-page";

export function meta() {
  return [{ title: "Design system — Crewcut" }];
}

/** Development-only reference for the design system; not linked from the app. */
export default function DesignRoute() {
  if (!import.meta.env.DEV) return <Navigate to="/home" replace />;
  return <DesignPage />;
}
