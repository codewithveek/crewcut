import { STAGE_LABELS, type Stage } from "@crewcut/contracts";

/** The verb shown after who decided: "Dana approved Script". */
export const DECISION_LABEL: Record<string, string> = {
  approved: "approved",
  sent_back: "sent back",
  override: "overrode a check on",
  rejected: "rejected",
  notified: "finished",
  published: "published",
};

const PLATFORM_NAME: Record<string, string> = {
  youtube: "YouTube",
  youtube_shorts: "YouTube Shorts",
  tiktok: "TikTok",
  instagram: "Instagram",
  instagram_reels: "Instagram Reels",
  linkedin: "LinkedIn",
  x: "X",
};

const clip = (text: string, max = 70) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/**
 * Decisions are stored with machine references the agent reads ("script v3",
 * "claim:l9", "composition v47", "→ script"). On screen they become plain
 * words: the script line itself, the idea's title, which version. Older
 * records also carry internal reasons ("Gate set to notify"), reworded here.
 */
export function describeDecision(
  event: { subject?: string | null; reason?: string | null },
  lookup: { lineText?: (lineId: string) => string | undefined; ideaTitle?: (ideaId: string) => string | undefined } = {},
): { detail: string | null; link: string | null } {
  const subject = event.subject?.trim() ?? "";
  let detail: string | null = null;
  let link: string | null = null;
  let match: RegExpMatchArray | null;
  if (!subject) detail = null;
  else if ((match = subject.match(/^claim:(l\d+)/))) {
    const text = lookup.lineText?.(match[1] ?? "");
    // A line that was later cut is no longer in the script: name it by its number.
    detail = text ? `“${clip(text)}”` : `Line ${(match[1] ?? "").slice(1)} of the script`;
  } else if ((match = subject.match(/^idea (.+)$/))) detail = lookup.ideaTitle?.(match[1] ?? "") ?? "The chosen idea";
  else if ((match = subject.match(/^script v(\d+)$/))) detail = `Script, version ${match[1]}`;
  else if ((match = subject.match(/^composition v(\d+)$/))) detail = `Video edit, version ${match[1]}`;
  else if ((match = subject.match(/^→\s*(\w+)$/))) detail = `Back to ${STAGE_LABELS[match[1] as Stage]?.agent ?? "an earlier step"}`;
  else if ((match = subject.match(/^(\w+) \((\w+)\)$/))) detail = `${PLATFORM_NAME[match[1] ?? ""] ?? match[1]}, ${match[2]}`;
  else if (/^https?:\/\//.test(subject)) link = subject;
  else detail = subject;

  // "Finished" records carry the stage's note as their reason, so the same rewording applies.
  const reason = plainStageNote((event.reason ?? "").replace(/^Applied fix: /, "Fix applied: ").trim());
  const text = [detail, reason].filter(Boolean).join(" · ");
  return { detail: text || null, link };
}

/** Stage notes saved before they were written plainly, reworded for the screen (new notes pass through). */
export function plainStageNote(note: string | null | undefined): string | null {
  if (!note) return null;
  const rules: Array<[RegExp, string | ((...groups: string[]) => string)]> = [
    [/^Demo seed$/, ""],
    [/^Gate set to notify$/, "No sign-off needed for this step"],
    [/^v(\d+)$/, (_, version) => `Version ${version}`],
    [/^v(\d+): (\d+) words \(budget (\d+)\)$/, (_, version, words, budget) => `Version ${version}: ${words} of ${budget} words`],
    [/^No voice provider connected.*$/, "No voice connected yet, so timing is estimated. Connect ElevenLabs in Settings to record the voice-over."],
    [/^Queued for a render worker.*$/, "Waiting to export."],
    [/^Rendering in a worker process.*$/, "Exporting. Progress shows here."],
    [/^(\d+) insights from .*$/, (_, count) => `${count} takeaways from the results`],
    [/^Fact-check score (\d+); (\d+) claims backed, (\d+) weak\.$/, (_, score, backed, weak) => `Fact-check score ${score}/100: ${backed} lines backed by sources, ${weak} weak.`],
    [/^(.+) post ready \((\w+)\) — waiting for a person to publish$/, (_, platform, privacy) => `${platform} post ready (${privacy}). Publish it when you're happy with it.`],
    [/(\d+) lines synthesized with ElevenLabs/, (_, count) => `${count} lines voiced with ElevenLabs`],
  ];
  for (const [pattern, replacement] of rules) {
    if (pattern.test(note)) {
      const text = typeof replacement === "string" ? note.replace(pattern, replacement) : note.replace(pattern, (...args) => replacement(...(args as string[])));
      return text.trim() || null;
    }
  }
  return note;
}
