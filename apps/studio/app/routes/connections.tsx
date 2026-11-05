import { ConnectionsPage } from "@/components/crewcut/connections-page";

export function meta() {
  return [{ title: "Connections — Crewcut" }];
}

export default function ConnectionsRoute() {
  return <ConnectionsPage />;
}
