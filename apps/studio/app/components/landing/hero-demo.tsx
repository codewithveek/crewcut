import { IconCheck, IconLoader2, IconPlayerPlay } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { type Box, type EditorShot, LiveEditor } from "./live-editor";
import { useHydrated, useInView, usePrefersReducedMotion } from "./use-landing";

type ShotRatio = "16:9" | "9:16" | "1:1";
const RATIOS: ShotRatio[] = ["16:9", "9:16", "1:1"];

/**
 * The real editor (dark theme, timeline fitted, Assistant tab open), captured
 * from a "Lisbon weekend" project made from the Golden Hour template in each
 * frame shape. The video is the same template rendered to MP4
 * (render-worker: landing-videos); the chat is drawn in the Assistant panel.
 */
const PLAYHEAD = { x0: 18.889, top: 73.111, bottom: 2.2, msWidth: 0.0049549 };
const SHOTS: EditorShot[] = [
  { key: "16:9", image: "/landing/hero-16x9.webp", video: "/landing/hero-16x9.mp4", stage: { left: 31.667, top: 13.681, width: 41.944, height: 37.75 }, playhead: PLAYHEAD },
  { key: "9:16", image: "/landing/hero-9x16.webp", video: "/landing/hero-9x16.mp4", stage: { left: 44.319, top: 8.889, width: 16.641, height: 47.333 }, playhead: PLAYHEAD },
  { key: "1:1", image: "/landing/hero-1x1.webp", video: "/landing/hero-1x1.mp4", stage: { left: 37.847, top: 8.889, width: 29.583, height: 47.333 }, playhead: PLAYHEAD },
];
const CHAT: Box = { left: 75.833, top: 11.111, width: 23.611, height: 53.111 };

interface Scene {
  prompt: string;
  ratio: ShotRatio;
  steps: string[];
  reply: string;
}

/** What the assistant does in the demo: each change is one the real editor makes, shown in the editor around it. */
const SCENES: Scene[] = [
  {
    prompt: "Make a vertical version for Shorts",
    ratio: "9:16",
    steps: ["Switched the frame to 9:16", "Re-laid out every scene for the taller frame", "Saved as one step you can undo"],
    reply: "Here's your Shorts cut.",
  },
  {
    prompt: "Now a square one for Instagram",
    ratio: "1:1",
    steps: ["Switched the frame to 1:1", "Kept the title clear of the crop", "Saved as one step you can undo"],
    reply: "Square version ready for your feed.",
  },
  {
    prompt: "And widescreen for YouTube",
    ratio: "16:9",
    steps: ["Switched the frame to 16:9", "Gave the photos room to drift", "Saved as one step you can undo"],
    reply: "Three versions, one project. Your call on which ships.",
  },
];

type Message = { id: number; role: "you" | "crew"; text: string; steps?: string[]; working?: boolean };

const GREETING: Message = { id: 0, role: "crew", text: "I cut your Lisbon photos into a first draft, timed to the music. Tell me what to change." };

const pct = (value: number) => `${value}%`;

export function HeroDemo() {
  const frameRef = useRef<HTMLDivElement>(null);
  const visible = useInView(frameRef);
  const visibleRef = useRef(false);
  visibleRef.current = visible;
  const reduced = usePrefersReducedMotion();
  const hydrated = useHydrated();
  const [ratio, setRatio] = useState<ShotRatio>("16:9");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [auto, setAuto] = useState(true);
  const [run, setRun] = useState(0);
  const nextId = useRef(1);

  // The scripted assistant: types a request, then makes the change. Pauses off-screen and in background tabs.
  useEffect(() => {
    if (!hydrated || reduced || !auto) return;
    let alive = true;
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        let left = ms;
        const tick = () => {
          if (!alive) return;
          if (left <= 0) return resolve();
          const step = Math.min(left, 60);
          window.setTimeout(() => {
            if (visibleRef.current && !document.hidden) left -= step;
            tick();
          }, step);
        };
        tick();
      });
    const push = (message: Omit<Message, "id">) => {
      const id = nextId.current++;
      setMessages((list) => [...list, { ...message, id }].slice(-4));
      return id;
    };
    void (async () => {
      // Hold the widescreen cut first: it's the one most people make.
      for (let index = 0; alive; index = (index + 1) % SCENES.length) {
        const scene = SCENES[index] as Scene;
        await sleep(index === 0 ? 4200 : 2400);
        for (let count = 1; count <= scene.prompt.length && alive; count += 1) {
          setDraft(scene.prompt.slice(0, count));
          await sleep(32);
        }
        await sleep(420);
        if (!alive) return;
        setDraft("");
        push({ role: "you", text: scene.prompt });
        await sleep(480);
        const reply = push({ role: "crew", text: "", steps: [], working: true });
        for (const [stepIndex, step] of scene.steps.entries()) {
          await sleep(620);
          if (!alive) return;
          setMessages((list) => list.map((message) => (message.id === reply ? { ...message, steps: [...(message.steps ?? []), step] } : message)));
          if (stepIndex === 0) setRatio(scene.ratio);
        }
        await sleep(380);
        setMessages((list) => list.map((message) => (message.id === reply ? { ...message, working: false, text: scene.reply } : message)));
        await sleep(scene.ratio === "16:9" ? 9000 : 5600);
      }
    })();
    return () => {
      alive = false;
    };
  }, [hydrated, reduced, auto, run]);

  /** The visitor takes the wheel: the demo stops and says so. */
  const choose = (next: ShotRatio) => {
    setRatio(next);
    setDraft("");
    if (auto) {
      setAuto(false);
      setMessages((list) => [...list.filter((message) => !message.working), { id: nextId.current++, role: "crew" as const, text: "You took over the edit. I'll wait here; the timeline is yours." }].slice(-4));
    }
  };
  const replay = () => {
    setMessages([GREETING]);
    setRatio("16:9");
    setAuto(true);
    setRun((value) => value + 1);
  };

  const shownMessages: Message[] =
    reduced && auto ? [GREETING, { id: -1, role: "you", text: SCENES[2]?.prompt ?? "" }, { id: -2, role: "crew", text: SCENES[2]?.reply ?? "", steps: SCENES[2]?.steps ?? [] }] : messages;

  const chat = (
    <div className="lp-demo-chat-inner">
      <ol className="lp-chat-list" aria-live="polite">
        {shownMessages.map((message) => (
          <li key={message.id} className="lp-msg" data-role={message.role}>
            {message.text ? <p>{message.text}</p> : null}
            {message.steps?.length ? (
              <ul className="lp-msg-steps">
                {message.steps.map((step) => (
                  <li key={step}>
                    <IconCheck aria-hidden />
                    {step}
                  </li>
                ))}
              </ul>
            ) : null}
            {message.working ? (
              <p className="lp-msg-working">
                <IconLoader2 className="motion-safe:animate-spin" aria-hidden />
                Editing…
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      <div className="lp-chat-composer" aria-hidden>
        {draft ? <span>{draft}</span> : <span className="lp-chat-placeholder">Ask for a change…</span>}
        {auto && !reduced ? <span className="lp-caret" /> : null}
      </div>
      {!auto ? (
        <button type="button" onClick={replay} className="lp-chat-replay">
          <IconPlayerPlay aria-hidden />
          Play the demo again
        </button>
      ) : null}
    </div>
  );

  return (
    <div ref={frameRef} className="lp-demo-wrap" role="region" aria-label="Live demo: the assistant makes three versions of a travel video in the Crewcut editor">
      <div className="lp-demo-controls">
        <span className="lp-demo-live">
          <span className="lp-demo-dot" aria-hidden />
          Live demo
        </span>
        <div className="lp-demo-ratios" role="group" aria-label="Frame shape">
          <span className="lp-demo-ratios-label">Try a frame shape</span>
          {RATIOS.map((entry) => (
            <button key={entry} type="button" aria-pressed={ratio === entry} onClick={() => choose(entry)} className="lp-demo-ratio">
              <span className="lp-demo-ratio-shape" data-ratio={entry} aria-hidden />
              {entry}
            </button>
          ))}
        </div>
      </div>

      <LiveEditor
        shots={SHOTS}
        active={ratio}
        tone="dark"
        label="The Crewcut editor"
        alt="The Crewcut editor with a travel video open: media panel, preview, the assistant, and photo and music tracks on the timeline."
      >
        <aside className="lp-demo-chat" aria-label="Assistant" style={{ left: pct(CHAT.left), top: pct(CHAT.top), width: pct(CHAT.width), height: pct(CHAT.height) }}>
          {chat}
        </aside>
      </LiveEditor>

      {/* Phones: the editor is too small to read text inside it, so the conversation sits below. */}
      <aside className="lp-demo-chat-below" aria-label="Assistant">
        {chat}
      </aside>
    </div>
  );
}
