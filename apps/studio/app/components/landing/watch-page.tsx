import { useEffect, useState } from "react";

import { Footer, Nav, START_HREF } from "./landing-page";

interface SharedVideo {
  id: string;
  title: string;
  ratio: string;
  videoUrl: string | null;
  exportedAt: string | null;
}

type State = { kind: "loading" } | { kind: "missing" } | { kind: "ready"; video: SharedVideo };

const RATIO: Record<string, string> = { "16:9": "16 / 9", "9:16": "9 / 16", "1:1": "1 / 1", "4:5": "4 / 5", "4:3": "4 / 3", "3:4": "3 / 4", "21:9": "21 / 9", "2:3": "2 / 3" };

/** A video its owner shared with "Anyone with the link": watch only, no editing, no sign-in. */
export function WatchPage({ videoId }: { videoId: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    let alive = true;
    void fetch(`/api/share/${encodeURIComponent(videoId)}`, { credentials: "same-origin" })
      .then(async (response) => (response.ok ? ((await response.json()) as SharedVideo) : null))
      .catch(() => null)
      .then((video) => {
        if (!alive) return;
        setState(video ? { kind: "ready", video } : { kind: "missing" });
        if (video) document.title = `${video.title} · Crewcut`;
      });
    return () => {
      alive = false;
    };
  }, [videoId]);

  const ratio = state.kind === "ready" ? (RATIO[state.video.ratio] ?? "16 / 9") : "16 / 9";
  const tall = state.kind === "ready" && (state.video.ratio === "9:16" || state.video.ratio === "4:5" || state.video.ratio === "3:4" || state.video.ratio === "2:3");

  return (
    <div className="lp">
      <a href="#main" className="lp-skip">
        Skip to content
      </a>
      <Nav home="/" />
      <main id="main" className="lp-watch">
        <div className="lp-wrap">
          {state.kind === "missing" ? (
            <div className="lp-watch-empty">
              <h1 className="lp-watch-title">This video isn't available</h1>
              <p>The link may be wrong, or its owner stopped sharing it.</p>
              <a href={START_HREF} className="lp-btn lp-btn-cut">
                Make your own video
              </a>
            </div>
          ) : (
            <>
              <div className="lp-watch-stage" data-tall={tall || undefined} style={{ aspectRatio: ratio }} aria-busy={state.kind === "loading"}>
                {state.kind === "ready" && state.video.videoUrl ? (
                  <video src={state.video.videoUrl} controls playsInline preload="metadata" aria-label={state.video.title} />
                ) : state.kind === "ready" ? (
                  <p className="lp-watch-note">The owner hasn't exported this video yet. Check back soon.</p>
                ) : null}
              </div>
              <div className="lp-watch-meta">
                <h1 className="lp-watch-title">{state.kind === "ready" ? state.video.title : " "}</h1>
                <p className="lp-watch-by">
                  Shared from Crewcut, view only.{" "}
                  <a href={START_HREF}>Make your own</a>
                </p>
              </div>
            </>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
