import type { LinksFunction, MetaFunction } from "react-router";

import landingCss from "./landing.css?url";

const TITLE = "Crewcut: the video editor for you and your AI crew";
const DESCRIPTION = "Agents research, script, edit and voice your video, and every fact links to its source. You approve each step, or take over the edit any time.";

export const landingLinks: LinksFunction = () => [{ rel: "stylesheet", href: landingCss }];

export const landingMeta: MetaFunction = () => [
  { title: TITLE },
  { name: "description", content: DESCRIPTION },
  { property: "og:title", content: TITLE },
  { property: "og:description", content: DESCRIPTION },
  { property: "og:type", content: "website" },
  { property: "og:image", content: "/landing/og.png" },
  { name: "twitter:card", content: "summary_large_image" },
  { name: "theme-color", content: "#0D0D0F" },
];
