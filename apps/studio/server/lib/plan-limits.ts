import { workspaceOf } from "./catalog.js";
import { planIdOf } from "./credits.js";
import { UpgradeRequiredError } from "./errors.js";
import { type PlanDefinition, PLANS } from "./plans.js";

/**
 * What a workspace's plan allows, checked where it matters: autopilot,
 * export size and the ending card, render priority, publishing channels.
 * Limits name the plan that lifts them, in plain words.
 */

export async function planFor(owner: { email: string; orgId: string | null }): Promise<PlanDefinition> {
  return PLANS[await planIdOf(workspaceOf(owner))];
}

export async function requireAutopilot(owner: { email: string; orgId: string | null }): Promise<void> {
  const plan = await planFor(owner);
  if (!plan.autopilot) {
    throw new UpgradeRequiredError("autopilot", "Autopilot is part of Creator and Studio. Upgrade on the Plan page to have the crew make videos hands-off.");
  }
}
