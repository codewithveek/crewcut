import type { LinksFunction, MetaFunction } from "react-router";

import landingCss from "./landing.css?url";
import { HOME_DESCRIPTION, HOME_JSON_LD, HOME_TITLE, OG_HOME, pageMeta } from "./seo";

export const landingLinks: LinksFunction = () => [{ rel: "stylesheet", href: landingCss }];

/** "/" and "/welcome" are the same page, so both name "/" as the canonical address. */
export const landingMeta: MetaFunction = () =>
  pageMeta({
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    path: "/",
    image: OG_HOME,
    extra: [{ "script:ld+json": HOME_JSON_LD }],
  });
