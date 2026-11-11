import { Navigate, useLocation } from "react-router";

export function meta() {
  return [{ title: "Connections — Crewcut" }];
}

export default function ConnectionsRoute() {
  // Connections lives in Settings now; old links (and YouTube's return link) keep working.
  const { search } = useLocation();
  return <Navigate to={`/settings/connections${search}`} replace />;
}
