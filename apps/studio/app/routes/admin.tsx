import { AdminPage } from "@/components/crewcut/catalog/admin-page";

export function meta() {
  return [{ title: "Catalog admin — Crewcut" }];
}

export default function AdminRoute() {
  return <AdminPage />;
}
