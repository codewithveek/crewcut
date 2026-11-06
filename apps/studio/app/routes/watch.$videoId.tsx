import type { MetaFunction } from "react-router";
import { useParams } from "react-router";

import { landingLinks } from "@/components/landing/landing-meta";
import { WatchPage } from "@/components/landing/watch-page";

export const links = landingLinks;

export const meta: MetaFunction = () => [
  { title: "Shared video · Crewcut" },
  { name: "robots", content: "noindex" },
  { property: "og:image", content: "/landing/og.png" },
  { name: "theme-color", content: "#0D0D0F" },
];

/** A video shared with "Anyone with the link" (view only, no sign-in). */
export default function WatchRoute() {
  const { videoId = "" } = useParams();
  return <WatchPage videoId={videoId} />;
}
