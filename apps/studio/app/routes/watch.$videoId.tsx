import type { HeadersFunction, LoaderFunctionArgs, MetaFunction } from "react-router";
import { useParams } from "react-router";

import { landingLinks } from "@/components/landing/landing-meta";
import { OG_WATCH, pageMeta } from "@/components/landing/seo";
import { WatchPage } from "@/components/landing/watch-page";

export const links = landingLinks;

type SharedVideoMeta = { title: string; videoUrl: string | null } | null;

/**
 * Only for the link preview: the video's title (and file) so a pasted link
 * shows what it is. Reads the same public endpoint the page uses, so a video
 * that isn't shared stays a plain "Shared video" with nothing revealed. The
 * page itself still loads its data in the browser.
 */
export async function loader({ request, params }: LoaderFunctionArgs): Promise<{ video: SharedVideoMeta }> {
  const id = params.videoId ?? "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return { video: null };
  try {
    const response = await fetch(new URL(`/api/share/${encodeURIComponent(id)}`, request.url), { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return { video: null };
    const body = (await response.json()) as { title?: unknown; videoUrl?: unknown };
    return { video: typeof body.title === "string" ? { title: body.title, videoUrl: typeof body.videoUrl === "string" ? body.videoUrl : null } : null };
  } catch {
    return { video: null };
  }
}

/** The owner can stop sharing at any time: keep cached copies (and the title in them) short-lived. */
export const headers: HeadersFunction = () => ({ "x-agent-native-ssr-max-age": "300" });

export const meta: MetaFunction<typeof loader> = ({ loaderData, params }) => {
  const video = loaderData?.video ?? null;
  const title = video?.title.trim() ? `${video.title.trim()} · Crewcut` : "Shared video · Crewcut";
  return pageMeta({
    title,
    description: video ? `Watch “${video.title.trim()}”, shared from Crewcut. View only, no sign-in needed.` : "A video shared from Crewcut, the video editor for you and your AI crew. View only, no sign-in needed.",
    path: `/watch/${encodeURIComponent(params.videoId ?? "")}`,
    image: OG_WATCH,
    type: "video.other",
    // Shared by link, not published: keep these out of search results.
    noindex: true,
    extra: video?.videoUrl
      ? [
          { property: "og:video", content: video.videoUrl },
          { property: "og:video:secure_url", content: video.videoUrl },
          { property: "og:video:type", content: "video/mp4" },
        ]
      : [],
  });
};

/** A video shared with "Anyone with the link" (view only, no sign-in). */
export default function WatchRoute() {
  const { videoId = "" } = useParams();
  return <WatchPage videoId={videoId} />;
}
