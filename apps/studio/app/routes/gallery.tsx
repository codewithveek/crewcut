import type { HeadersFunction, MetaFunction } from "react-router";

import { GalleryPage } from "@/components/landing/gallery-page";
import { LANDING_TEMPLATES } from "@/components/landing/landing-media";
import { landingLinks } from "@/components/landing/landing-meta";
import { OG_TEMPLATES, ogTemplate, pageMeta } from "@/components/landing/seo";

export const links = landingLinks;

/** The preview query changes the page's metadata, so shared caches must key this page by its query (Agent-Native's SSR cache ignores queries by default). */
export const headers: HeadersFunction = () => ({ "x-agent-native-ssr-key": "query" });

/** A shared "?preview=<id>" link previews that template (its own cover, name and description); the plain gallery gets the gallery cover. */
export const meta: MetaFunction = ({ location }) => {
  const id = new URLSearchParams(location.search).get("preview");
  const template = id ? LANDING_TEMPLATES.find((entry) => entry.id === id) : undefined;
  if (template) {
    return pageMeta({
      title: `${template.name}: a free video template · Crewcut`,
      description: `${template.description} Preview it free, then make it yours with your own words and photos.`,
      path: `/gallery?preview=${encodeURIComponent(template.id)}`,
      image: ogTemplate(template),
    });
  }
  return pageMeta({
    title: "Video templates · Crewcut",
    description: "Video templates for 9:16, 4:5, 1:1 and 16:9. Drop in your photos and words; the motion and music are already done. Preview any of them free.",
    path: "/gallery",
    image: OG_TEMPLATES,
  });
};

/** The public template gallery (signed-out visitors; the workspace's own gallery is /templates). */
export default function GalleryRoute() {
  return <GalleryPage />;
}
