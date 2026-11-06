import type { MetaFunction } from "react-router";

import { GalleryPage } from "@/components/landing/gallery-page";
import { landingLinks } from "@/components/landing/landing-meta";

export const links = landingLinks;

export const meta: MetaFunction = () => [
  { title: "Templates · Crewcut" },
  { name: "description", content: "Hand-designed video templates with real photos, motion and music, in 9:16, 4:5, 1:1 and 16:9. Preview any of them, then make one yours." },
  { property: "og:title", content: "Templates · Crewcut" },
  { property: "og:image", content: "/landing/og.png" },
  { name: "theme-color", content: "#0D0D0F" },
];

/** The public template gallery (signed-out visitors; the workspace's own gallery is /templates). */
export default function GalleryRoute() {
  return <GalleryPage />;
}
