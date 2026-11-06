import {
  IconAdjustmentsHorizontal,
  IconArrowRight,
  IconArrowsLeftRight,
  IconAspectRatio,
  IconBadgeCc,
  IconBrandYoutube,
  IconCheck,
  IconDownload,
  IconHistory,
  IconKeyframes,
  IconMicrophone,
  IconMusic,
  IconScissors,
  IconTemplate,
  IconTypography,
  IconUserCheck,
} from "@tabler/icons-react";
import { type ReactNode, useRef } from "react";

import { CrewcutMark } from "@/components/crewcut/primitives";

import { HeroDemo } from "./hero-demo";
import { type EditorShot, LiveEditor } from "./live-editor";
import { TemplatesShowcase } from "./templates-showcase";
import { useInView } from "./use-landing";

export const START_HREF = "/home";
export const SIGN_IN_HREF = "/sign-in";

export function LandingPage() {
  return (
    <div className="lp">
      <a href="#main" className="lp-skip">
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <Hero />
        <Crew />
        <Receipts />
        <TemplatesShowcase />
        <EditorTour />
        <FinalCall />
      </main>
      <Footer />
    </div>
  );
}

// ── Nav ─────────────────────────────────────────────────────────────────────

/** On the landing page the section links stay in-page; elsewhere (the gallery) they point back to it. */
export function Nav({ home = "" }: { home?: string }) {
  return (
    <header className="lp-nav">
      <div className="lp-wrap lp-nav-row">
        <a href={home || "#main"} className="lp-brand" aria-label="Crewcut home">
          <CrewcutMark motion="intro" hover className="size-8" />
          <span className="lp-wordmark">crewcut</span>
        </a>
        <nav aria-label="Sections" className="lp-nav-links">
          <a href={`${home}#crew`}>How it works</a>
          <a href={`${home}#receipts`}>Fact-check</a>
          <a href="/gallery">Templates</a>
          <a href={`${home}#editor`}>Editor</a>
        </nav>
        <div className="lp-nav-actions">
          <a href={SIGN_IN_HREF} className="lp-link-quiet">
            Sign in
          </a>
          <a href={START_HREF} className="lp-btn lp-btn-cut lp-btn-sm">
            Start free
          </a>
        </div>
      </div>
    </header>
  );
}

// ── Hero ────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="lp-hero" aria-labelledby="hero-title">
      <div className="lp-wrap">
        <h1 id="hero-title" className="lp-hero-title">
          <span className="lp-hero-line">
            <span className="lp-word" style={{ "--i": 0 } as React.CSSProperties}>The</span>{" "}
            <span className="lp-word" style={{ "--i": 1 } as React.CSSProperties}>video</span>{" "}
            <span className="lp-word" style={{ "--i": 2 } as React.CSSProperties}>editor</span>{" "}
            <span className="lp-word" style={{ "--i": 3 } as React.CSSProperties}>for</span>{" "}
            <span className="lp-word" style={{ "--i": 4 } as React.CSSProperties}>you</span>
          </span>
          {/* The second line is the logo's cut half: it wipes in, then slips off the first line's edge. */}
          <span className="lp-hero-line lp-hero-cut">and your AI crew.</span>
        </h1>
        <div className="lp-hero-foot">
          <p className="lp-hero-lede">
            Agents research, script, edit and voice your video, and every fact links to its source. You approve each step, or take over the edit any time.
          </p>
          <div className="lp-hero-actions">
            <a href={START_HREF} className="lp-btn lp-btn-cut">
              Start free
              <IconArrowRight className="size-4" aria-hidden />
            </a>
            <a href="#crew" className="lp-btn lp-btn-ghost">
              See how it works
            </a>
            <p className="lp-hero-note">Free while in beta. No card needed.</p>
          </div>
        </div>
      </div>
      <div className="lp-wrap lp-hero-demo">
        <HeroDemo />
      </div>
    </section>
  );
}

// ── The crew (a real sequence, so it's numbered) ────────────────────────────

const CREW: Array<{ name: string; job: string; gate?: string }> = [
  { name: "Ideas", job: "Finds topics your audience is asking about, with the evidence.", gate: "You pick" },
  { name: "Research", job: "Collects sources and quotes the facts word for word." },
  { name: "Script", job: "Writes it, and points every factual line at a fact.", gate: "You approve" },
  { name: "Fact-check", job: "Flags weak lines and suggests a fix.", gate: "You approve" },
  { name: "Edit", job: "Designs and animates a look of its own.", gate: "You approve" },
  { name: "Voice & sound", job: "Records the voice-over and times scenes to it." },
  { name: "Publish", job: "Writes the post and uploads when you say go.", gate: "You publish" },
  { name: "Results", job: "Reads how it did and carries the lessons forward." },
];

function Crew() {
  return (
    <section id="crew" className="lp-crew" aria-labelledby="crew-title">
      <div className="lp-wrap">
        <div className="lp-section-head">
          <h2 id="crew-title" className="lp-h2">
            A crew of eight.
            <br />
            One director: you.
          </h2>
          <p className="lp-body">
            Each step has a specialist that does the work. The steps marked <span className="lp-gate-inline">You approve</span> wait for your OK, and everything stays editable after.
          </p>
        </div>
        <div className="lp-track" role="list">
          <div className="lp-track-ruler" aria-hidden>
            {Array.from({ length: 9 }, (_, index) => (
              <span key={index}>{`0:${String(index * 5).padStart(2, "0")}`}</span>
            ))}
          </div>
          <div className="lp-track-lane">
            {CREW.map((step, index) => (
              <div key={step.name} role="listitem" className="lp-track-clip" style={{ "--i": index } as React.CSSProperties}>
                <span className="lp-track-num">{index + 1}</span>
                <h3 className="lp-track-name">{step.name}</h3>
                <p className="lp-track-job">{step.job}</p>
                {step.gate ? (
                  <span className="lp-gate">
                    <IconUserCheck className="size-3.5" aria-hidden />
                    {step.gate}
                  </span>
                ) : null}
              </div>
            ))}
            <span className="lp-track-playhead" aria-hidden />
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Receipts (real lines from the sample project) ───────────────────────────

const SCRIPT_LINES = [
  { id: "l5", text: "Start critically damped, with a response of 0.35 to 0.5 seconds." },
  { id: "l6", text: "Nothing should appear from nothing: enter from 0.9, never from zero." },
  { id: "l7", text: "Stagger lists by 40 to 80 milliseconds so they read as one motion.", focus: true },
  { id: "l8", text: "But video is slower than UI: entrances run 400 to 700 milliseconds." },
];

function Receipts() {
  return (
    <section id="receipts" className="lp-receipts" aria-labelledby="receipts-title">
      <div className="lp-wrap lp-receipts-grid">
        <div>
          <h2 id="receipts-title" className="lp-h2">
            Every claim comes
            <br />
            with a receipt.
          </h2>
          <p className="lp-body">
            The research step quotes its sources word for word. The fact-check marks each line Supported, Weak or Unsupported, and nothing unsourced ships without your say-so. Then share the Proof report with anyone who asks.
          </p>
          <ul className="lp-verdicts" aria-label="Fact-check results">
            <li data-verdict="supported">Supported</li>
            <li data-verdict="weak">Weak</li>
            <li data-verdict="unsupported">Unsupported</li>
          </ul>
        </div>
        <div className="lp-receipt-stack">
          <figure className="lp-script">
            <figcaption className="lp-script-cap">Script · sample project</figcaption>
            <ol>
              {SCRIPT_LINES.map((line) => (
                <li key={line.id} data-focus={line.focus || undefined}>
                  <span className="lp-script-dot" aria-hidden />
                  <span className="lp-script-text">{line.text}</span>
                </li>
              ))}
            </ol>
          </figure>
          <figure className="lp-source">
            <figcaption>
              <span>Source · research notes</span>
              <span className="lp-supported">
                <IconCheck className="size-3.5" aria-hidden />
                Supported
              </span>
            </figcaption>
            <blockquote>“Stagger lists by 40–80 ms per item so they read as one motion.”</blockquote>
            <p className="lp-source-note">Exact quote, with a link back to where it came from.</p>
          </figure>
        </div>
      </div>
    </section>
  );
}

// ── Editor tour ─────────────────────────────────────────────────────────────

const TOOLS: Array<{ icon: ReactNode; label: string }> = [
  { icon: <IconScissors />, label: "Trim and split" },
  { icon: <IconArrowsLeftRight />, label: "A transition at every cut" },
  { icon: <IconKeyframes />, label: "Keyframes" },
  { icon: <IconBadgeCc />, label: "Captions that follow the voice" },
  { icon: <IconTypography />, label: "Text and titles" },
  { icon: <IconMicrophone />, label: "Voice-over" },
  { icon: <IconMusic />, label: "Music and sound effects" },
  { icon: <IconAdjustmentsHorizontal />, label: "Filters and color" },
  { icon: <IconTemplate />, label: "Templates" },
  { icon: <IconAspectRatio />, label: "Eight frame shapes" },
  { icon: <IconHistory />, label: "Every change in history" },
  { icon: <IconDownload />, label: "Export MP4" },
  { icon: <IconBrandYoutube />, label: "Publish to YouTube" },
];

/** The real editor in light mode with a 16:9 project (Top Five), captured like the hero and playing its MP4. */
const EDITOR_SHOT: EditorShot[] = [
  {
    key: "16:9",
    image: "/landing/editor-16x9.webp",
    video: "/landing/editor-16x9.mp4",
    stage: { left: 31.667, top: 13.681, width: 41.944, height: 37.75 },
    playhead: { x0: 18.889, top: 73.111, bottom: 2.2, msWidth: 0.005145 },
  },
];

function EditorTour() {
  return (
    <section id="editor" className="lp-editor" aria-labelledby="editor-title">
      <div className="lp-wrap">
        <div className="lp-section-head">
          <h2 id="editor-title" className="lp-h2">
            An editor that feels
            <br />
            like an editor.
          </h2>
          <p className="lp-body">Tracks, keyframes, a transition at every cut, captions that follow the voice. Everything the crew makes stays editable, down to the frame.</p>
        </div>
        <figure className="lp-shot">
          <LiveEditor
            shots={EDITOR_SHOT}
            active="16:9"
            tone="light"
            label="The Crewcut editor, light mode"
            alt="The Crewcut editor in light mode: a widescreen list video in the preview, the selected clip's settings on the right, and photo and music tracks on the timeline."
          />
        </figure>
        {/* A marquee: the list twice in one track, so the loop is seamless; screen readers get it once. */}
        <div className="lp-marquee">
          <div className="lp-marquee-track">
            {[0, 1].map((copy) => (
              <ul key={copy} className="lp-tools" aria-label={copy === 0 ? "Editing tools" : undefined} aria-hidden={copy === 1 || undefined}>
                {TOOLS.map((tool) => (
                  <li key={tool.label}>
                    <span className="lp-tool-icon" aria-hidden>
                      {tool.icon}
                    </span>
                    {tool.label}
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Closing call + footer ───────────────────────────────────────────────────

export function FinalCall() {
  return (
    <section className="lp-final" aria-labelledby="final-title">
      <div className="lp-wrap lp-final-inner">
        <h2 id="final-title" className="lp-final-title">
          Bring an idea.
          <br />
          <span className="lp-final-cut">Leave with a video.</span>
        </h2>
        <p className="lp-body lp-body-on-ink">Start from a template, a blank timeline, or one sentence for the crew.</p>
        <a href={START_HREF} className="lp-btn lp-btn-cut lp-btn-lg">
          Start free
          <IconArrowRight className="size-5" aria-hidden />
        </a>
      </div>
    </section>
  );
}

export function Footer() {
  const endRef = useRef<HTMLDivElement>(null);
  const seen = useInView(endRef, { once: true, rootMargin: "0px 0px -15% 0px" });
  return (
    <footer className="lp-footer">
      {/* The page ends the way Crewcut videos do: the ending card. */}
      <div ref={endRef} className="lp-ending" data-play={seen || undefined}>
        <CrewcutMark variant="glyph" motion={seen ? "intro" : "none"} className="lp-ending-mark" />
        <span className="lp-ending-word" aria-label="crewcut">
          {"crewcut".split("").map((letter, index) => (
            <span key={index} style={{ "--i": index } as React.CSSProperties} aria-hidden>
              {letter}
            </span>
          ))}
        </span>
      </div>
      <div className="lp-wrap lp-footer-row">
        <p>Built with Agent-Native, Remotion, ElevenLabs and Pexels.</p>
        <nav aria-label="Footer" className="lp-footer-links">
          <a href="/gallery">Templates</a>
          <a href={SIGN_IN_HREF}>Sign in</a>
          <a href={START_HREF}>Start free</a>
        </nav>
        <p>© 2026 Crewcut</p>
      </div>
    </footer>
  );
}
