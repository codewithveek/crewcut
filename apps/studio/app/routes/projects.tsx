import { ProjectsPage } from "@/components/crewcut/dashboard/projects-page";

export function meta() {
  return [{ title: "Projects — Crewcut" }];
}

export default function ProjectsRoute() {
  return <ProjectsPage />;
}
