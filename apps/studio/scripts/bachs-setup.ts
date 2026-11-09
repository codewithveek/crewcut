/**
 * Creates Crewcut's products in Bachs (sandbox or live, from BACHS_SECRET_KEY)
 * and prints the BACHS_PRODUCT_* lines to put in the server settings:
 *
 *   pnpm billing:setup            # creates the six products
 *   pnpm billing:setup --dry-run  # shows what it would create
 *
 * Prices come from server/lib/plans.ts. Products already set in the
 * environment (BACHS_PRODUCT_*) are skipped, so it is safe to run again.
 * Optional: BACHS_NGN_PER_USD (e.g. 1500) adds a naira price to the top-ups,
 * which Bachs shows to Nigerian buyers; subscriptions stay USD (Bachs bills
 * subscriptions in USD by card).
 */
import { bachsRequest, PRODUCT_ENV } from "../server/lib/billing/bachs.js";
import { PLANS, TOP_UPS } from "../server/lib/plans.js";

const dryRun = process.argv.includes("--dry-run");
const key = process.env.BACHS_SECRET_KEY?.trim();
if (!key && !dryRun) {
  console.error("Set BACHS_SECRET_KEY (sk_sandbox_… for testing) first.");
  process.exit(1);
}
const ngnPerUsd = Number(process.env.BACHS_NGN_PER_USD ?? "");

interface ProductSpec {
  envName: string;
  body: Record<string, unknown>;
}

const specs: ProductSpec[] = [];
for (const plan of [PLANS.creator, PLANS.studio]) {
  for (const interval of ["month", "year"] as const) {
    specs.push({
      envName: PRODUCT_ENV[`${plan.id}:${interval}`]!,
      body: {
        name: `Crewcut ${plan.name} (${interval === "month" ? "monthly" : "yearly"})`,
        description: `${plan.tagline} ${plan.monthlyCredits.toLocaleString("en-US")} AI credits a month.`,
        price: { currency: "USD", price_type: "fixed", amount: plan.price[interval].toFixed(2) },
        billing_cycle: { interval, frequency: 1 },
        metadata: { app: "crewcut", plan: plan.id, interval },
      },
    });
  }
}
for (const pack of TOP_UPS) {
  specs.push({
    envName: PRODUCT_ENV[pack.id]!,
    body: {
      name: `Crewcut credits: ${pack.credits.toLocaleString("en-US")}`,
      description: `${pack.credits.toLocaleString("en-US")} AI credits for Crewcut, usable for 12 months.`,
      price: {
        currency: "USD",
        price_type: "fixed",
        amount: pack.price.toFixed(2),
        ...(Number.isFinite(ngnPerUsd) && ngnPerUsd > 0 ? { currency_options: [{ currency: "NGN", amount: (Math.round((pack.price * ngnPerUsd) / 100) * 100).toFixed(2) }] } : {}),
      },
      metadata: { app: "crewcut", topup: pack.id, credits: String(pack.credits) },
    },
  });
}

const lines: string[] = [];
for (const spec of specs) {
  const existing = process.env[spec.envName]?.trim();
  if (existing) {
    console.log(`= ${spec.envName} already set (${existing}), skipped`);
    lines.push(`${spec.envName}=${existing}`);
    continue;
  }
  if (dryRun) {
    console.log(`+ would create ${spec.envName}: ${JSON.stringify(spec.body)}`);
    continue;
  }
  const product = await bachsRequest<{ id: string }>("POST", "/v1/products", spec.body, { idempotencyKey: `crewcut-setup-${spec.envName.toLowerCase()}` });
  console.log(`+ created ${spec.envName}: ${product.id}`);
  lines.push(`${spec.envName}=${product.id}`);
}

if (lines.length) {
  console.log("\nAdd these to the server settings (apps/studio/.env locally, Worker secrets in production):\n");
  console.log(lines.join("\n"));
  console.log("\nThen register https://<your app>/api/billing/webhook in the Bachs developer portal and set BACHS_WEBHOOK_SECRET.");
}
