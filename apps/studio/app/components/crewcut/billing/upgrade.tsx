import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { IconSparkles } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";

import { Button, Dialog, Segmented, SkeletonLines } from "@/components/ds";
import { errorMessage } from "@/lib/crewcut";

import { type PlanInfo, PlanCards } from "./billing-page";

/**
 * The upgrade dialog: one place that explains a paid feature and offers the
 * plans, opened from wherever someone reaches for that feature (a 4K export,
 * autopilot, a Pro template…) instead of letting the action fail or quietly
 * doing less. `openUpgrade("autopilot")` from anywhere; the host is mounted
 * once in the app shell.
 *
 * Server refusals that need a plan arrive with HTTP 402 (and, where the
 * server knows, a code naming the feature): `showActionError` turns those
 * into this dialog and everything else into the usual toast.
 */

export type UpgradeFeature = "export-length" | "export-hd" | "no-ending" | "autopilot" | "pro-content" | "channels" | "credits" | "plans";

type PaidPlan = "creator" | "studio";

interface Pitch {
  /** The plan that unlocks it (highlighted). */
  plan: PaidPlan;
  title: (detail?: string) => string;
  body: string;
}

const PITCHES: Record<UpgradeFeature, Pitch> = {
  "export-length": {
    plan: "creator",
    title: () => "Export longer videos",
    body: "Free exports videos up to 10 minutes, Creator up to 60 minutes and Studio up to 3 hours. Your video is safe either way: you can keep editing it on any plan.",
  },
  "export-hd": {
    plan: "creator",
    title: (detail) => `Export in ${detail ?? "4K"} with Creator`,
    body: "Free exports go up to 720p. Creator and Studio export in 1080p, 2K and 4K, sharp on any screen.",
  },
  "no-ending": {
    plan: "creator",
    title: () => "End your video your way with Creator",
    body: "Free videos close on the Crewcut ending card. On Creator and Studio it's yours to keep or remove.",
  },
  autopilot: {
    plan: "creator",
    title: () => "Put the crew on autopilot with Creator",
    body: "Give it an idea and come back to a finished, fact-checked video. Nothing is ever published without you.",
  },
  "pro-content": {
    plan: "creator",
    title: () => "Export Pro templates, music and sounds with Creator",
    body: "You can try and edit Pro content on any plan. Exporting a video that uses it needs Creator or Studio.",
  },
  channels: {
    plan: "studio",
    title: () => "Publish to up to 5 channels with Studio",
    body: "Your plan publishes to one YouTube channel. Studio connects up to five, for teams and creators who run several.",
  },
  credits: {
    plan: "creator",
    title: () => "You're out of AI credits",
    body: "Credits pay for the crew's thinking, AI voice-overs and captions from speech. Top up now, or move to a plan with more every month. Your own AI key always costs no credits.",
  },
  plans: {
    plan: "creator",
    title: () => "Do more with Creator and Studio",
    body: "Autopilot, more AI credits every month, 4K export, and every Pro template, track and sound.",
  },
};

interface UpgradeState {
  feature: UpgradeFeature | null;
  detail?: string;
  /** The server's own words, when a refusal opened the dialog. */
  note?: string;
}

const useUpgrade = create<UpgradeState>(() => ({ feature: null }));

export function openUpgrade(feature: UpgradeFeature, options: { detail?: string; note?: string } = {}): void {
  useUpgrade.setState({ feature, ...options }, true);
}

const FEATURES = new Set<string>(Object.keys(PITCHES));

/** Opens the upgrade dialog for an error that means "this needs a plan" (HTTP 402). True when it did. */
export function upgradeFromError(error: unknown): boolean {
  const info = error as { status?: unknown; errorCode?: unknown; message?: unknown } | null;
  if (!info || info.status !== 402) return false;
  const coded = typeof info.errorCode === "string" && info.errorCode.startsWith("upgrade:") ? info.errorCode.slice("upgrade:".length) : "";
  const message = typeof info.message === "string" ? info.message : "";
  const feature: UpgradeFeature = FEATURES.has(coded)
    ? (coded as UpgradeFeature)
    : /credit/i.test(message)
      ? "credits"
      : /autopilot/i.test(message)
        ? "autopilot"
        : /pro content/i.test(message)
          ? "pro-content"
          : "plans";
  openUpgrade(feature, message ? { note: message } : {});
  return true;
}

/** For a failed action: the upgrade dialog when a plan would fix it, otherwise the usual error toast. */
export function showActionError(error: unknown): void {
  if (!upgradeFromError(error)) toast.error(errorMessage(error));
}

type PlanId = "free" | PaidPlan;
type Interval = "month" | "year";

interface PlanDetails extends PlanInfo {
  maxExportHeight: number;
  endingRequired: boolean;
  autopilot: boolean;
  channels: number;
}

interface CreditsData {
  balance: { plan: PlanId; available: number };
  subscription: { status: string } | null;
  billingReady: { subscriptions: boolean; topUps: boolean };
  plans: PlanDetails[];
  topUps: ReadonlyArray<{ id: string; credits: number; price: number }>;
  typicalDraftCredits?: number;
}

/** The workspace's plan and what it includes; `plan` is null until it has loaded (never guess a limit). */
export function usePlan(enabled = true): { plan: PlanDetails | null; data: CreditsData | undefined } {
  const query = useActionQuery("get-credits", {} as never, { enabled, staleTime: 60_000 } as never);
  const data = query.data as CreditsData | undefined;
  return { plan: data?.plans.find((entry) => entry.id === data.balance.plan) ?? null, data };
}

const money = (value: number) => (Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`);

export function UpgradeDialogHost() {
  const { feature, detail, note } = useUpgrade();
  const open = feature !== null;
  const { data } = usePlan(open);
  const [interval, setInterval] = useState<Interval>("year");
  const [busy, setBusy] = useState(false);
  const pitch = PITCHES[feature ?? "plans"];
  const close = () => useUpgrade.setState({ feature: null }, true);

  const go = async (action: "start-checkout" | "open-billing-portal", args: Record<string, unknown>) => {
    setBusy(true);
    try {
      const result = (await callAction(action as never, args as never)) as { url: string };
      window.location.assign(result.url);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const current = data?.balance.plan ?? "free";
  const paid = Boolean(data?.subscription && ["active", "trialing", "past_due"].includes(data.subscription.status));
  const paidPlans = data?.plans.filter((plan) => plan.id !== "free") ?? [];
  // Someone already on the plan that unlocks this (out of credits on Creator) is pointed at the next one up.
  const featured: PaidPlan = current === pitch.plan ? "studio" : pitch.plan;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())} title={pitch.title(detail)} description={pitch.body} className="w-[min(720px,calc(100vw-24px))]">
      <div className="flex flex-col gap-4">
        {/* The server's reason when it adds something the headline doesn't (which Pro items, when credits refill). */}
        {note && feature !== "autopilot" ? <p className="rounded-ds-sm bg-ds-surface-2 px-3 py-2 text-[13px] text-ds-text-2">{note}</p> : null}

        {feature === "credits" && data ? (
          <section className="flex flex-col gap-2" aria-label="Credit top-ups">
            <h3 className="ds-overline text-ds-text-3">Top up now</h3>
            <div className="flex flex-wrap gap-2">
              {data.topUps.map((pack) => (
                <Button key={pack.id} variant="outline" className="pc-press" disabled={busy || !data.billingReady.topUps} onClick={() => void go("start-checkout", { item: pack.id, origin: window.location.origin })}>
                  <IconSparkles className="size-4" /> {pack.credits.toLocaleString()} credits · {money(pack.price)}
                </Button>
              ))}
            </div>
            <p className="text-[12px] text-ds-text-3">{data.billingReady.topUps ? "Bought credits last 12 months." : "Top-ups open soon."}</p>
          </section>
        ) : null}

        <section className="flex flex-col gap-3" aria-label="Plans">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="ds-overline text-ds-text-3">{feature === "credits" ? "Or get more every month" : "Plans"}</h3>
            <Segmented ariaLabel="Billing period" size="sm" value={interval} onChange={setInterval} options={[{ value: "month", label: "Monthly" }, { value: "year", label: "Yearly · save 20%+" }]} />
          </div>
          {!data ? (
            <SkeletonLines count={5} />
          ) : (
            <PlanCards
              plans={paidPlans}
              current={current}
              featured={featured}
              className="md:grid-cols-2"
              interval={interval}
              busy={busy}
              onPick={(next) => void (paid ? go("open-billing-portal", {}) : go("start-checkout", { item: next, interval, origin: window.location.origin }))}
              actionLabel={(entry) => {
                if (entry.id === current || !data.billingReady.subscriptions) return null;
                return paid ? `Switch to ${entry.name}` : `Get ${entry.name}`;
              }}
            />
          )}
          {data && !data.billingReady.subscriptions ? <p className="text-[12px] text-ds-text-3">Paid plans open soon. Everything on Free keeps working until then.</p> : null}
        </section>

        <p className="text-[12px] text-ds-text-3">
          Cancel any time. Prices in US dollars.{" "}
          <a href="/settings/plan" className="font-medium text-ds-text-2 underline underline-offset-2" onClick={close}>
            See your plan and credits
          </a>
        </p>
      </div>
    </Dialog>
  );
}
