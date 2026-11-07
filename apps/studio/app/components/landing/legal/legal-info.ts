/**
 * Facts the legal pages share. Change them here, then bump LEGAL_UPDATED on
 * every page whose meaning changes (and tell people about material changes,
 * as the Terms and Privacy Policy promise).
 */
export const LEGAL = {
  product: "Crewcut",
  operator: "Victory Lucky",
  country: "Nigeria",
  email: "support@getcrewcut.app",
  site: "https://getcrewcut.app",
  host: "getcrewcut.app",
  minimumAge: 16,
} as const;

/** Shown as "Last updated" and used as the effective date. */
export const LEGAL_UPDATED = { iso: "2026-11-07", label: "7 November 2026" } as const;

export type LegalSlug = "privacy" | "terms" | "cookies" | "acceptable-use";

export const LEGAL_PAGES: ReadonlyArray<{ slug: LegalSlug; href: string; title: string; short: string }> = [
  { slug: "privacy", href: "/privacy", title: "Privacy Policy", short: "Privacy" },
  { slug: "terms", href: "/terms", title: "Terms of Service", short: "Terms" },
  { slug: "cookies", href: "/cookies", title: "Cookie Policy", short: "Cookies" },
  { slug: "acceptable-use", href: "/acceptable-use", title: "Acceptable Use Policy", short: "Acceptable use" },
];

export const LEGAL_PATHS: ReadonlyArray<string> = LEGAL_PAGES.map((page) => page.href);
