import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { IconCheck, IconCreditCard, IconKey, IconSparkles } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import { Button, Panel, Segmented, SkeletonLines } from "@/components/ds";
import { errorMessage, formatAgo } from "@/lib/crewcut";
import { cn } from "@/lib/utils";

/**
 * Plan & credits: the workspace's plan, what's left of this month's AI
 * credits, what used them, and the plans and top-ups on offer. Paying and
 * managing a subscription go through Bachs; the plan changes when Bachs tells
 * us the payment went through (a webhook), not when the browser comes back.
 */

type PlanId = "free" | "creator" | "studio";
type Interval = "month" | "year";

export interface PlanInfo {
  id: PlanId;
  name: string;
  tagline: string;
  price: { month: number; year: number };
  yearlyMonthly: number;
  monthlyCredits: number;
  features: string[];
}

interface CreditsData {
  workspace: string;
  balance: { plan: PlanId; periodStart: string; periodEnd: string; monthly: number; topup: number; available: number; allowance: number; freeGrantElsewhere?: boolean; topupExpiresAt: string | null };
  usedThisPeriod: Array<{ stage: string; credits: number; calls: number }>;
  ledger: Array<{ id: string; at: string; kind: string; credits: number; note: string }>;
  subscription: { plan: PlanId; interval: Interval; status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } | null;
  billingReady: { subscriptions: boolean; topUps: boolean; mode: "sandbox" | "live" | null };
  plans: PlanInfo[];
  topUps: ReadonlyArray<{ id: string; credits: number; price: number }>;
}

const STAGE_LABELS: Record<string, string> = {
  trend: "Ideas",
  research: "Research",
  script: "Script",
  qa: "Fact-check",
  motion: "Animation",
  voice: "Voice-over",
  publish: "Publish",
  analytics: "Results",
  edit: "Editing with the crew",
  chat: "Chat",
  check: "Connection checks",
};

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long" }) : "");
const money = (value: number) => (Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`);

async function goTo(action: "start-checkout" | "open-billing-portal", args: Record<string, unknown>) {
  try {
    const result = (await callAction(action as never, args as never)) as { url: string };
    window.location.assign(result.url);
  } catch (error) {
    toast.error(errorMessage(error));
  }
}

function CreditMeter({ balance }: { balance: CreditsData["balance"] }) {
  // Never show more than can actually be spent (a negative top-up pool eats into the month).
  const monthlyLeft = Math.max(0, Math.min(balance.monthly, balance.available));
  const share = balance.allowance > 0 ? Math.min(1, monthlyLeft / balance.allowance) : 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-foreground">
          <span className="pc-display text-3xl tabular-nums">{Math.max(0, balance.available).toLocaleString()}</span> <span className="text-muted-foreground">credits left</span>
        </p>
        {balance.allowance > 0 ? <p className="text-xs text-muted-foreground">Refills to {balance.allowance.toLocaleString()} on {day(balance.periodEnd)}</p> : null}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-ds-surface-3" role="meter" aria-valuemin={0} aria-valuemax={balance.allowance} aria-valuenow={monthlyLeft} aria-label="This month's credits left">
        <div className="h-full rounded-full bg-ds-accent transition-[width] duration-500" style={{ width: `${share * 100}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        {balance.freeGrantElsewhere ? "Your free monthly credits belong to your first workspace. This one runs on bought credits, a paid plan, or your own AI key." : `${monthlyLeft.toLocaleString()} of this month's ${balance.allowance.toLocaleString()}`}
        {balance.topup > 0 ? ` · ${balance.topup.toLocaleString()} bought, usable until ${day(balance.topupExpiresAt)}` : ""}
      </p>
    </div>
  );
}

export function PlanCards({ plans, current, interval, onPick, busy, actionLabel, featured: featuredPlan = "creator", className }: { plans: PlanInfo[]; current?: PlanId; interval: Interval; onPick?: (plan: PlanId) => void; busy?: boolean; actionLabel?: (plan: PlanInfo) => string | null; featured?: PlanId; className?: string }) {
  return (
    <div className={cn("grid gap-3", className ?? "md:grid-cols-3")}>
      {plans.map((plan) => {
        const isCurrent = plan.id === current;
        const featured = plan.id === featuredPlan;
        const label = actionLabel?.(plan) ?? null;
        return (
          <article key={plan.id} className={cn("flex flex-col gap-3 rounded-ds-lg bg-ds-surface p-4 shadow-[inset_0_0_0_1px_var(--ds-hairline)]", featured && "shadow-[inset_0_0_0_1.5px_var(--ds-accent)]")}>
            <header className="flex items-start justify-between gap-2">
              <div>
                <h3 className="pc-display text-lg text-foreground">{plan.name}</h3>
                <p className="text-[13px] text-muted-foreground">{plan.tagline}</p>
              </div>
              {isCurrent ? <span className="shrink-0 whitespace-nowrap rounded-full bg-ds-surface-2 px-2 py-0.5 text-[11px] font-medium text-ds-text-2">Your plan</span> : featured ? <span className="shrink-0 whitespace-nowrap rounded-full bg-ds-accent px-2 py-0.5 text-[11px] font-medium text-ds-on-accent">{featuredPlan === "creator" ? "Most popular" : "Includes this"}</span> : null}
            </header>
            <p className="text-foreground">
              {plan.price.month === 0 ? (
                <span className="pc-display text-3xl">$0</span>
              ) : interval === "year" ? (
                <>
                  <span className="pc-display text-3xl tabular-nums">{money(plan.yearlyMonthly)}</span>
                  <span className="text-sm text-muted-foreground">/month, {money(plan.price.year)} billed yearly</span>
                </>
              ) : (
                <>
                  <span className="pc-display text-3xl tabular-nums">{money(plan.price.month)}</span>
                  <span className="text-sm text-muted-foreground">/month</span>
                </>
              )}
            </p>
            <ul className="flex flex-1 flex-col gap-1.5">
              {plan.features.map((feature) => (
                <li key={feature} className="flex gap-2 text-[13px] text-ds-text-2">
                  <IconCheck className="mt-0.5 size-4 shrink-0 text-ds-accent" aria-hidden />
                  {feature}
                </li>
              ))}
            </ul>
            {label && onPick ? (
              <Button className="pc-press w-full" variant={featured ? "default" : "outline"} disabled={busy} onClick={() => onPick(plan.id)}>
                {label}
              </Button>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

export function BillingPage() {
  const query = useActionQuery("get-credits", {} as never);
  const data = query.data as CreditsData | undefined;
  const [interval, setInterval] = useState<Interval>("year");
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const checkout = params.get("checkout");
    if (!checkout) return;
    if (checkout === "done") toast.success("Payment received. Your plan updates as soon as Bachs confirms it, usually within a minute.");
    else toast("Checkout cancelled. Nothing was charged.");
    setParams((next) => {
      next.delete("checkout");
      return next;
    }, { replace: true });
    const timer = window.setTimeout(() => void query.refetch(), 4000);
    return () => window.clearTimeout(timer);
  }, [params, setParams, query]);

  const run = async (action: "start-checkout" | "open-billing-portal", args: Record<string, unknown>) => {
    setBusy(true);
    await goTo(action, args);
    setBusy(false);
  };

  const plan = data?.balance.plan ?? "free";
  const paid = Boolean(data?.subscription && ["active", "trialing", "past_due"].includes(data.subscription.status));

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-5 px-4 pb-10 pt-5 sm:px-8 sm:pt-9">
      <header className="flex flex-col gap-1">
        <h1 className="ds-title text-ds-text sm:text-2xl">Plan & credits</h1>
        <p className="text-[13px] text-ds-text-2">Credits pay for Crewcut AI: the crew's thinking and AI voice-overs. Editing, templates and exports never use them.</p>
      </header>

      <Panel
        title={data ? `${data.plans.find((entry) => entry.id === plan)?.name ?? "Free"} plan` : "Your plan"}
        description={
          data?.subscription && paid
            ? data.subscription.cancelAtPeriodEnd
              ? `Cancelled: stays active until ${day(data.subscription.currentPeriodEnd)}.`
              : data.subscription.status === "past_due"
                ? "The last payment didn't go through. Update your card in Manage billing to keep your plan."
                : `Billed ${data.subscription.interval === "year" ? "yearly" : "monthly"}${data.subscription.currentPeriodEnd ? ` · renews ${day(data.subscription.currentPeriodEnd)}` : ""}.`
            : "Upgrade for autopilot, more credits, Pro templates and 4K export."
        }
        actions={
          paid ? (
            <Button size="sm" variant="outline" className="pc-press" disabled={busy} onClick={() => void run("open-billing-portal", {})}>
              <IconCreditCard className="size-4" /> Manage billing
            </Button>
          ) : null
        }
      >
        {!data ? <SkeletonLines count={3} /> : <CreditMeter balance={data.balance} />}
      </Panel>

      <Panel title="Pay nothing for AI with your own keys" description="Add your own Anthropic, OpenAI, Google or ElevenLabs key and the crew uses it instead: no credits, billed by your provider.">
        <Button size="sm" variant="outline" className="pc-press" onClick={() => navigate("/settings/connections")}>
          <IconKey className="size-4" /> Add a key
        </Button>
      </Panel>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="pc-display text-[15px] text-foreground">Plans</h2>
          <Segmented ariaLabel="Billing period" size="sm" value={interval} onChange={setInterval} options={[{ value: "month", label: "Monthly" }, { value: "year", label: "Yearly · save 20%+" }]} />
        </div>
        {!data ? (
          <SkeletonLines count={4} />
        ) : (
          <PlanCards
            plans={data.plans}
            current={plan}
            interval={interval}
            busy={busy}
            onPick={(next) => void (paid ? run("open-billing-portal", {}) : run("start-checkout", { item: next, interval, origin: window.location.origin }))}
            actionLabel={(entry) => {
              if (entry.id === "free" || entry.id === plan) return null;
              if (!data.billingReady.subscriptions) return null;
              return paid ? `Switch to ${entry.name}` : `Get ${entry.name}`;
            }}
          />
        )}
        {data && !data.billingReady.subscriptions ? <p className="text-[12px] text-ds-text-3">Paid plans open soon. Everything on Free works today.</p> : null}
      </section>

      <Panel title="Need more credits this month?" description="Top-ups never expire at the month's end: they last 12 months.">
        {!data ? (
          <SkeletonLines count={1} />
        ) : (
          <div className="flex flex-wrap gap-2">
            {data.topUps.map((pack) => (
              <Button key={pack.id} variant="outline" className="pc-press" disabled={busy || !data.billingReady.topUps} onClick={() => void run("start-checkout", { item: pack.id, origin: window.location.origin })}>
                <IconSparkles className="size-4" /> {pack.credits.toLocaleString()} credits · {money(pack.price)}
              </Button>
            ))}
            {!data.billingReady.topUps ? <p className="w-full text-[12px] text-ds-text-3">Top-ups open soon.</p> : null}
          </div>
        )}
      </Panel>

      <div className="grid gap-5 md:grid-cols-2">
        <Panel title="Used this month">
          {!data ? (
            <SkeletonLines count={3} />
          ) : data.usedThisPeriod.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">Nothing yet this month.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {[...data.usedThisPeriod].sort((a, b) => b.credits - a.credits).map((row) => (
                <li key={row.stage} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="text-ds-text-2">{STAGE_LABELS[row.stage] ?? row.stage}</span>
                  <span className="tabular-nums text-foreground">{row.credits.toLocaleString()} credits</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Credit history">
          {!data ? (
            <SkeletonLines count={3} />
          ) : data.ledger.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No changes yet.</p>
          ) : (
            <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
              {data.ledger.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="min-w-0 truncate text-ds-text-2">
                    {row.note || row.kind} <span className="text-ds-text-3">· {formatAgo(row.at)}</span>
                  </span>
                  <span className={cn("shrink-0 tabular-nums", row.credits >= 0 ? "text-foreground" : "text-ds-text-2")}>
                    {row.credits > 0 ? "+" : ""}
                    {row.credits.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      {data?.billingReady.mode === "sandbox" ? <p className="text-[11px] text-ds-text-3">Payments are in test mode (Bachs sandbox): no real money moves.</p> : null}
    </div>
  );
}
