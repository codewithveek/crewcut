import type { MetaDescriptor } from "react-router";

import { LEGAL, LEGAL_PAGES, type LegalSlug } from "./legal/legal-info";

/**
 * Link-preview metadata for every public page: one helper so each page sends
 * the full Open Graph + X card set with absolute URLs (most crawlers ignore
 * relative ones), a canonical link and image alt text.
 *
 * The cover images are generated, not hand-made:
 *   pnpm --filter @crewcut/render-worker og-images
 * renders apps/studio/public/og/*.jpg from the copy below. Bump OG_VERSION
 * after regenerating so platforms that cache previews by URL fetch the new
 * ones.
 */
export const SITE_URL = LEGAL.site;
export const SITE_NAME = "Crewcut";
export const OG_VERSION = 1;
export const OG_SIZE = { width: 1200, height: 630 } as const;
export const BRAND_INK = "#0D0D0F";

export const HOME_TITLE = "Crewcut: the video editor for you and your AI crew";
export const HOME_DESCRIPTION = "Agents research, script, edit and voice your video, and every fact links to its source. You approve each step, or take over the edit any time. Free while in beta.";

export interface OgImage {
  /** Path under public/, e.g. "/og/home.jpg". */
  file: string;
  alt: string;
}

// ── The cover images (the generator draws exactly what these alts describe) ──

export const OG_HOME: OgImage = {
  file: "/og/home.jpg",
  alt: "Crewcut: the video editor for you and your AI crew. A timeline of the eight crew steps, from Ideas to Results, with the playhead on Fact-check and the steps you approve marked.",
};

export const OG_TEMPLATES: OgImage = {
  file: "/og/templates.jpg",
  alt: "Pick a template. Make it yours. Four Crewcut video templates in tall frames: Golden Hour, Product Drop, Event Night and Top Five.",
};

export const OG_WATCH: OgImage = {
  file: "/og/watch.jpg",
  alt: "Watch the video, made in Crewcut. A video frame with a play button and a timeline under it.",
};

/** The receipt each legal cover shows: real section numbers and titles from the document (update them with it). */
export const LEGAL_COVER: Record<LegalSlug, { line: string; receipt: Array<[number, string]> }> = {
  privacy: {
    line: "What Crewcut collects, why, who sees it, and how to get it deleted.",
    receipt: [
      [3, "The data we collect"],
      [5, "The AI crew and your content"],
      [6, "YouTube and Google data"],
      [9, "How long we keep data"],
      [11, "Your rights"],
    ],
  },
  terms: {
    line: "The deal between you and Crewcut, in plain words.",
    receipt: [
      [2, "Who can use Crewcut"],
      [5, "Free and paid plans"],
      [6, "Your content"],
      [7, "AI output"],
      [12, "Ending this agreement"],
    ],
  },
  cookies: {
    line: "The cookies and browser storage Crewcut uses, and your choices.",
    receipt: [
      [1, "What cookies are"],
      [2, "The kinds we use"],
      [3, "The cookies we set"],
      [4, "Browser storage"],
      [5, "Your choices"],
    ],
  },
  "acceptable-use": {
    line: "What you can and can't make with Crewcut.",
    receipt: [
      [1, "Illegal and seriously harmful content"],
      [2, "Deception and impersonation"],
      [3, "Other people's rights"],
      [4, "Using the service fairly"],
      [6, "Reporting"],
    ],
  },
};

export function ogLegal(slug: LegalSlug): OgImage {
  const page = LEGAL_PAGES.find((entry) => entry.slug === slug)!;
  return { file: `/og/${slug}.jpg`, alt: `Crewcut ${page.title}: ${LEGAL_COVER[slug].line}` };
}

export function ogTemplate(template: { id: string; name: string; category: string; ratios: readonly string[] }): OgImage {
  return {
    file: `/og/template-${template.id}.jpg`,
    alt: `${template.name}, a free ${template.category.toLowerCase()} video template on Crewcut, in ${template.ratios.join(", ")}. A still from the template in a tall frame.`,
  };
}

// ── The tags ────────────────────────────────────────────────────────────────

export const absoluteUrl = (path: string) => (/^https?:\/\//.test(path) ? path : `${SITE_URL}${path.startsWith("/") ? "" : "/"}${path}`);

export function pageMeta(input: {
  title: string;
  description: string;
  /** The page's own path (with any query that changes its content), used for og:url and the canonical link. */
  path: string;
  image: OgImage;
  type?: "website" | "article" | "video.other";
  noindex?: boolean;
  extra?: MetaDescriptor[];
}): MetaDescriptor[] {
  const url = absoluteUrl(input.path);
  const image = `${absoluteUrl(input.image.file)}?v=${OG_VERSION}`;
  return [
    { title: input.title },
    { name: "description", content: input.description },
    { tagName: "link", rel: "canonical", href: url },
    ...(input.noindex ? [{ name: "robots", content: "noindex" }] : []),
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:locale", content: "en_US" },
    { property: "og:type", content: input.type ?? "website" },
    { property: "og:url", content: url },
    { property: "og:title", content: input.title },
    { property: "og:description", content: input.description },
    { property: "og:image", content: image },
    { property: "og:image:secure_url", content: image },
    { property: "og:image:type", content: "image/jpeg" },
    { property: "og:image:width", content: String(OG_SIZE.width) },
    { property: "og:image:height", content: String(OG_SIZE.height) },
    { property: "og:image:alt", content: input.image.alt },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: input.title },
    { name: "twitter:description", content: input.description },
    { name: "twitter:image", content: image },
    { name: "twitter:image:alt", content: input.image.alt },
    { name: "theme-color", content: BRAND_INK },
    ...(input.extra ?? []),
  ];
}

/** Structured data for the home page: the site and the app (free while in beta). */
export const HOME_JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", "@id": `${SITE_URL}/#website`, url: `${SITE_URL}/`, name: SITE_NAME, description: HOME_DESCRIPTION },
    {
      "@type": "SoftwareApplication",
      name: SITE_NAME,
      url: `${SITE_URL}/`,
      applicationCategory: "MultimediaApplication",
      operatingSystem: "Web browser",
      description: HOME_DESCRIPTION,
      image: absoluteUrl(OG_HOME.file),
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
  ],
};
