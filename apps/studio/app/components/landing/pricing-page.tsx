import { IconCheck } from "@tabler/icons-react";
import { useState } from "react";

import { PLANS, type PlanDefinition, TOP_UPS, yearlyMonthly } from "../../../server/lib/plans";
import { FinalCall, Footer, Nav, START_HREF } from "./landing-page";

type Interval = "month" | "year";

const money = (value: number) => (Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`);

const CREDIT_USES: Array<{ what: string; credits: string }> = [
  { what: "A full AI draft (ideas, research, script, fact-check, animation)", credits: "about 30–50" },
  { what: "Asking the crew for an edit", credits: "about 1–2" },
  { what: "A minute of AI voice-over", credits: "about 5" },
  { what: "Editing by hand, templates, stock photos, exports", credits: "free" },
];

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "What are credits?",
    a: "Credits pay for Crewcut AI: the crew's thinking, AI voice-overs and captions from speech, run on our accounts. Every plan gets a fresh batch each month, and the Plan page shows what's left and what used it.",
  },
  {
    q: "Can I use my own AI keys?",
    a: "Yes, on every plan, Free included. Add your own Anthropic, OpenAI, Google or ElevenLabs key and the crew uses it instead: no credits, and your provider bills you directly.",
  },
  {
    q: "What happens when I run out?",
    a: "The crew pauses and tells you. Nothing is charged automatically. Your editing, templates and exports keep working. Credits refill at the start of your next month, or buy a top-up that lasts 12 months.",
  },
  {
    q: "Do unused credits roll over?",
    a: "This month's credits don't. Top-ups do: they stay for 12 months from your latest purchase.",
  },
  {
    q: "Can I cancel any time?",
    a: "Yes. Cancel from Manage billing and your plan stays active until the end of the period you paid for.",
  },
];

function PlanCard({ plan, interval }: { plan: PlanDefinition; interval: Interval }) {
  const featured = plan.id === "creator";
  return (
    <article className="lp-price-card" data-featured={featured || undefined}>
      <header className="lp-price-card-head">
        <h3>{plan.name}</h3>
        {featured ? <span className="lp-price-badge">Most popular</span> : null}
      </header>
      <p className="lp-price-tagline">{plan.tagline}</p>
      <p className="lp-price-amount">
        {plan.price.month === 0 ? (
          <strong>$0</strong>
        ) : interval === "year" ? (
          <>
            <strong>{money(yearlyMonthly(plan))}</strong>
            <span>/month, billed {money(plan.price.year)} yearly</span>
          </>
        ) : (
          <>
            <strong>{money(plan.price.month)}</strong>
            <span>/month</span>
          </>
        )}
      </p>
      <a href={START_HREF} className={featured ? "lp-btn lp-btn-cut" : "lp-btn lp-price-btn"}>
        {plan.price.month === 0 ? "Start free" : `Start with ${plan.name}`}
      </a>
      <ul className="lp-price-features">
        {plan.features.map((feature) => (
          <li key={feature}>
            <IconCheck aria-hidden />
            {feature}
          </li>
        ))}
      </ul>
    </article>
  );
}

/** The public pricing page: plans, what credits pay for, and the questions people ask. */
export function PricingPage() {
  const [interval, setInterval] = useState<Interval>("year");
  return (
    <div className="lp">
      <a href="#main" className="lp-skip">
        Skip to content
      </a>
      <Nav home="/" current="/pricing" />
      <main id="main">
        <section className="lp-gallery-head" aria-labelledby="pricing-title">
          <div className="lp-wrap">
            <h1 id="pricing-title" className="lp-gallery-title">
              Pricing
            </h1>
            <p className="lp-gallery-lede">Start free. Upgrade when you want the crew to make videos on autopilot. Bring your own AI keys on any plan and pay nothing for AI.</p>
          </div>
        </section>

        <section className="lp-pricing" aria-label="Plans">
          <div className="lp-wrap">
            <div className="lp-price-toggle" role="group" aria-label="Billing period">
              <button type="button" aria-pressed={interval === "month"} onClick={() => setInterval("month")}>
                Monthly
              </button>
              <button type="button" aria-pressed={interval === "year"} onClick={() => setInterval("year")}>
                Yearly <span>save 20%+</span>
              </button>
            </div>
            <div className="lp-price-grid">
              {Object.values(PLANS).map((plan) => (
                <PlanCard key={plan.id} plan={plan} interval={interval} />
              ))}
            </div>
            <p className="lp-price-note">
              Prices in US dollars. Need more credits? Top-ups: {TOP_UPS.map((pack) => `${pack.credits.toLocaleString("en-US")} for ${money(pack.price)}`).join(" · ")}, usable for 12 months.
            </p>
          </div>
        </section>

        <section className="lp-pricing lp-pricing-alt" aria-labelledby="credits-title">
          <div className="lp-wrap lp-price-split">
            <div>
              <h2 id="credits-title" className="lp-h2">
                What credits pay for
              </h2>
              <p className="lp-body">Only the AI. Everything you do yourself is free. Typical amounts on our default models:</p>
            </div>
            <dl className="lp-price-uses">
              {CREDIT_USES.map((use) => (
                <div key={use.what}>
                  <dt>{use.what}</dt>
                  <dd>{use.credits}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="lp-pricing" aria-labelledby="faq-title">
          <div className="lp-wrap lp-price-split">
            <h2 id="faq-title" className="lp-h2">
              Questions
            </h2>
            <div className="lp-price-faq">
              {FAQ.map((item) => (
                <details key={item.q}>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
        <FinalCall />
      </main>
      <Footer home="/" />
    </div>
  );
}
