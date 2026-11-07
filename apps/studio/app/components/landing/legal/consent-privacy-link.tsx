import { useEffect } from "react";

/**
 * Framework links that point at agent-native.com's privacy pages, and where
 * Crewcut's own pages are. Neither component takes the link as a prop where
 * Crewcut mounts it: the cookie banner sits inside AppProviders, and the
 * "Privacy & data" popover in Settings → Account uses the framework docs.
 */
const REPOINTS: ReadonlyArray<{ from: string; to: string; scope: string }> = [
  { from: "https://www.agent-native.com/privacy", to: "/privacy", scope: "[data-agent-native-consent-banner] a[href]" },
  { from: "https://www.agent-native.com/docs/privacy-and-data-rights", to: "/privacy#rights", scope: "a[href]" },
];

/**
 * Points those links at Crewcut's pages the moment they are hovered, focused
 * or clicked. Delegated listeners: nothing runs until someone reaches for a
 * link, so the editor pays nothing for this.
 */
export function ConsentPrivacyLink() {
  useEffect(() => {
    const repoint = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      for (const { from, to, scope } of REPOINTS) {
        const link = target.closest<HTMLAnchorElement>(scope);
        if (link && link.href.startsWith(from)) {
          link.setAttribute("href", to);
          return;
        }
      }
    };
    const events = ["pointerover", "focusin", "click", "auxclick"] as const;
    for (const type of events) document.addEventListener(type, repoint, true);
    return () => {
      for (const type of events) document.removeEventListener(type, repoint, true);
    };
  }, []);
  return null;
}
