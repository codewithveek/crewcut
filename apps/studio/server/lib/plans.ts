/**
 * Crewcut's plans, in one place: what each includes and what it costs. The
 * pricing page, the billing settings, export limits, autopilot, render
 * priority and the monthly credit grant all read this. Prices are US dollars;
 * local prices come from Bachs (see billing).
 *
 * "pro" is the old name for Creator (workspaces given Pro by an admin before
 * plans had names keep everything Creator includes).
 */

export const PLAN_IDS = ["free", "creator", "studio"] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export type PaidPlanId = Exclude<PlanId, "free">;
export type BillingInterval = "month" | "year";

export interface PlanDefinition {
  id: PlanId;
  name: string;
  tagline: string;
  /** US dollars per month when billed monthly, and per year when billed yearly. */
  price: { month: number; year: number };
  /** Credits granted at the start of each monthly period; they don't roll over. */
  monthlyCredits: number;
  /** Tallest export, in pixels (720 = 720p). */
  maxExportHeight: number;
  /** Free videos end with the Crewcut ending card. */
  endingRequired: boolean;
  /** Pro templates, music and sounds. */
  proContent: boolean;
  autopilot: boolean;
  /** Exports jump the render queue. */
  priorityRenders: boolean;
  /** Publishing accounts (YouTube channels) a workspace may connect. */
  channels: number;
  /** People who can work in the workspace (organisation members). */
  seats: number;
  features: string[];
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: "free",
    name: "Free",
    tagline: "Try the crew and make videos by hand.",
    price: { month: 0, year: 0 },
    monthlyCredits: 100,
    maxExportHeight: 720,
    endingRequired: true,
    proContent: false,
    autopilot: false,
    priorityRenders: false,
    channels: 1,
    seats: 1,
    features: ["The full editor and free templates", "100 AI credits a month (about 2–3 AI drafts)", "Videos up to 10 minutes, exported in 720p with the Crewcut ending card", "Use your own AI keys at no credit cost", "Publish to one YouTube channel yourself"],
  },
  creator: {
    id: "creator",
    name: "Creator",
    tagline: "Autopilot makes your shorts while you sleep.",
    price: { month: 19, year: 180 },
    monthlyCredits: 600,
    maxExportHeight: 2160,
    endingRequired: false,
    proContent: true,
    autopilot: true,
    priorityRenders: false,
    channels: 1,
    seats: 1,
    features: ["Autopilot: hands-off videos, from idea to export", "600 AI credits a month", "Videos up to 60 minutes, 1080p to 4K, ending card optional", "Every Pro template, track and sound", "Publish to YouTube from Crewcut"],
  },
  studio: {
    id: "studio",
    name: "Studio",
    tagline: "For teams and channels that publish every day.",
    price: { month: 49, year: 468 },
    monthlyCredits: 2000,
    maxExportHeight: 2160,
    endingRequired: false,
    proContent: true,
    autopilot: true,
    priorityRenders: true,
    channels: 5,
    seats: 5,
    features: ["Everything in Creator", "2,000 AI credits a month", "Videos up to 3 hours", "Up to 5 people and 5 YouTube channels", "Priority exports", "Crewcut from your own tools (MCP and API)"],
  },
};

/**
 * Longest video each plan can export, in minutes. Exports share the render
 * servers, so length is a plan limit like resolution is; the editor itself
 * never stops a timeline growing.
 */
export const MAX_EXPORT_MINUTES: Record<PlanId, number> = { free: 10, creator: 60, studio: 180 };

export function normalizePlan(value: string | null | undefined): PlanId {
  if (value === "creator" || value === "pro") return "creator";
  if (value === "studio") return "studio";
  return "free";
}

export function planDefinition(plan: string | null | undefined): PlanDefinition {
  return PLANS[normalizePlan(plan)];
}

/** Monthly-equivalent price of a yearly plan, for "$15/mo billed yearly". */
export function yearlyMonthly(plan: PlanDefinition): number {
  return Math.round((plan.price.year / 12) * 100) / 100;
}

/**
 * Credits: what people spend on Crewcut AI (the crew's model calls and AI
 * voice-overs). One credit is worth CREDIT_USD at top-up prices, and a call
 * costs its measured provider cost × CREDIT_MARKUP, so credits = cost ×
 * markup ÷ credit value. Both are settings so prices can follow the cost data
 * on the admin page without a deploy.
 */
export function creditSettings(env: Record<string, string | undefined> = process.env): { creditUsd: number; markup: number } {
  const number = (value: string | undefined, fallback: number) => {
    const parsed = Number(value?.trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return { creditUsd: number(env.CREWCUT_CREDIT_USD, 0.05), markup: number(env.CREWCUT_CREDIT_MARKUP, 3) };
}

/** Credits are stored in thousandths so small calls aren't rounded up to a whole credit. */
export const MILLI = 1000;

export function millicreditsForCost(costMicros: number, env?: Record<string, string | undefined>): number {
  if (costMicros <= 0) return 0;
  const { creditUsd, markup } = creditSettings(env);
  // micro-dollars → dollars → credits → millicredits. Rounded to a millionth
  // first, so float noise (0.1 × 3 = 0.30000000000000004) never adds a unit.
  const exact = ((costMicros / 1_000_000) * markup * MILLI) / creditUsd;
  return Math.max(1, Math.ceil(Math.round(exact * 1e6) / 1e6));
}

/** Top-up packs, sold as one-time payments. Bought credits last 12 months. */
export const TOP_UPS = [
  { id: "topup-300", credits: 300, price: 15 },
  { id: "topup-1000", credits: 1000, price: 45 },
] as const;
export type TopUpId = (typeof TOP_UPS)[number]["id"];
