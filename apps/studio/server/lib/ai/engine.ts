import {
  type AgentEngine,
  type AgentEngineEntry,
  createAISDKEngine,
  detectEngineFromEnvForRequest,
  detectEngineFromUserSecrets,
  type EngineCapabilities,
  type EngineEvent,
  type EngineStreamOptions,
  getAgentEngineEntry,
  getConfiguredEngineNameForRequest,
  getStoredModelForEngine,
  resolveEngine,
} from "@agent-native/core/agent/engine";
import { resolveCredentialDetailed } from "@agent-native/core/credentials";
import { getRequestOrgId, getRequestRunContext, getRequestUserEmail } from "@agent-native/core/server/request-context";

import { workspaceOf } from "../catalog.js";
import { assertCredits, OutOfCreditsError } from "../credits.js";
import { attribute } from "./attribution.js";
import { createGatewayFetch, describeGatewayError, gatewayConfig, type GatewayConfig, personTag, providerBaseUrl, sdkKeyFor } from "./gateway.js";
import { allModels, availableModels, costMicros, defaultModel, type ModelEntry, PROVIDER_ROUTES, resolveModel } from "./models.js";
import { recordAiUsage, type UsageSource } from "./usage.js";

/**
 * The "Crewcut AI" agent engine. Every model call the app makes (chat,
 * autopilot, background jobs) comes here, and it picks who runs it:
 *
 * 1. The person's own AI: the provider they chose in Settings, or any provider
 *    key they saved. Their key goes straight to their provider; no credits.
 * 2. Crewcut AI: Crewcut's own accounts through Cloudflare AI Gateway, paid
 *    for with credits. Refused politely when the workspace has none left.
 * 3. Local development only: a provider key in the server's environment.
 *
 * People who pick "Crewcut AI" in the model picker always get Crewcut AI.
 */

export const CREWCUT_ENGINE = "crewcut";
const APP_ID = "crewcut";

type Route =
  | { kind: "own"; engine: AgentEngine; engineName: string; model: string }
  | { kind: "managed"; model: ModelEntry; gateway: GatewayConfig }
  | { kind: "deployment"; engine: AgentEngine; engineName: string; model: string }
  | { kind: "unavailable"; message: string };

const BASE_CAPABILITIES: EngineCapabilities = { thinking: true, promptCaching: true, vision: true, computerUse: false, parallelToolCalls: true };

function capabilitiesFor(model: ModelEntry): EngineCapabilities {
  const provider = model.provider;
  return {
    thinking: provider === "anthropic" || provider === "openai" || provider === "google",
    promptCaching: provider === "anthropic",
    vision: model.vision,
    computerUse: false,
    parallelToolCalls: true,
  };
}

/** True when the person (or their organisation) saved the key this engine needs. Deployment keys never count. */
async function ownsKeyFor(entry: AgentEngineEntry | undefined, email: string, orgId: string | null): Promise<boolean> {
  if (!entry || entry.name === CREWCUT_ENGINE) return false;
  if (entry.name === "builder") return true; // only selected when their own Builder connection is usable
  const key = entry.requiredEnvVars[0];
  if (!key) return false;
  try {
    const credential = await resolveCredentialDetailed(key, { userEmail: email, ...(orgId ? { orgId } : {}) });
    return Boolean(credential?.value?.trim());
  } catch {
    return false;
  }
}

async function ownEngine(name: string, requested: string | undefined): Promise<{ engine: AgentEngine; model: string }> {
  const engine = await resolveEngine({ engineOption: name, appId: APP_ID });
  const stored = await getStoredModelForEngine(name, { appId: APP_ID }).catch(() => undefined);
  const model = stored ?? (requested && engine.supportedModels.includes(requested) ? requested : engine.defaultModel);
  return { engine, model };
}

/*
 * One agent turn makes many model calls, and the production database is far
 * from the server, so the route (whose key) and "has credits" answers are
 * reused for a short while instead of being looked up before every call.
 */
const ROUTE_TTL_MS = 60_000;
const CREDIT_TTL_MS = 15_000;
const routeCache = new Map<string, { at: number; route: Route }>();
const creditCache = new Map<string, number>();

function prune(map: Map<string, unknown>, max = 500): void {
  if (map.size <= max) return;
  for (const key of [...map.keys()].slice(0, map.size - max)) map.delete(key);
}

async function cachedRoute(requested: string | undefined, email: string | undefined, orgId: string | null): Promise<Route> {
  const key = `${email ?? ""}|${orgId ?? ""}|${requested ?? ""}`;
  const hit = routeCache.get(key);
  if (hit && Date.now() - hit.at < ROUTE_TTL_MS) return hit.route;
  const route = await chooseRoute(requested, email, orgId);
  if (route.kind !== "unavailable") {
    routeCache.set(key, { at: Date.now(), route });
    prune(routeCache);
  }
  return route;
}

/** Forget cached routes (a person saved or removed a key, or picked another model). */
export function forgetCrewcutAiRoutes(): void {
  routeCache.clear();
}

async function chooseRoute(requested: string | undefined, email: string | undefined, orgId: string | null): Promise<Route> {
  let chosen: string | undefined;
  try {
    chosen = await getConfiguredEngineNameForRequest({ appId: APP_ID });
  } catch {
    chosen = undefined;
  }

  if (email && chosen !== CREWCUT_ENGINE) {
    // The provider they picked in Settings, when it's on their own key.
    if (chosen && (await ownsKeyFor(getAgentEngineEntry(chosen), email, orgId))) {
      const own = await ownEngine(chosen, requested);
      return { kind: "own", engineName: chosen, ...own };
    }
    // Otherwise any provider key they saved.
    let detected: AgentEngineEntry | null = null;
    try {
      detected = await detectEngineFromUserSecrets();
    } catch {
      detected = null;
    }
    if (detected && (await ownsKeyFor(detected, email, orgId))) {
      const own = await ownEngine(detected.name, requested);
      return { kind: "own", engineName: detected.name, ...own };
    }
  }

  const gateway = gatewayConfig();
  const model = resolveModel(requested);
  if (gateway && model) return { kind: "managed", model, gateway };

  if (process.env.NODE_ENV !== "production") {
    const deployment = await detectEngineFromEnvForRequest().catch(() => null);
    if (deployment && deployment.name !== CREWCUT_ENGINE) {
      const engine = await resolveEngine({ engineOption: deployment.name, appId: APP_ID });
      return { kind: "deployment", engine, engineName: deployment.name, model: engine.defaultModel };
    }
  }

  return {
    kind: "unavailable",
    message: gateway
      ? "Crewcut AI has no models switched on right now. Add your own AI key in Settings, or tell the Crewcut team."
      : "Crewcut AI isn't set up on this server. Add your own AI key in Settings to use the crew.",
  };
}

function managedEngine(route: Extract<Route, { kind: "managed" }>, metadata: Parameters<typeof createGatewayFetch>[0]["metadata"]): AgentEngine {
  const { model, gateway } = route;
  const providerRoute = PROVIDER_ROUTES[model.provider];
  const { apiKey, sendsProviderKey } = sdkKeyFor(model.provider);
  return createAISDKEngine(providerRoute.sdk, {
    name: CREWCUT_ENGINE,
    label: "Crewcut AI",
    model: model.id,
    supportedModels: [model.id],
    acceptsCustomModels: true,
    capabilities: capabilitiesFor(model),
    apiKey,
    allowEnvFallback: false,
    baseUrl: providerBaseUrl(gateway, model.provider),
    requestFetch: createGatewayFetch({ config: gateway, provider: model.provider, sendsProviderKey, metadata }),
    forceResponses: providerRoute.forceResponses === true,
    skipCredentialFailureTracking: true,
  });
}

/** Crewcut AI for one model, straight through the gateway (admin checks and server-side tests). Null when it isn't set up. */
export function createCrewcutAiEngine(modelId?: string): { engine: AgentEngine; model: ModelEntry } | null {
  const gateway = gatewayConfig();
  const model = resolveModel(modelId);
  if (!gateway || !model) return null;
  return { engine: managedEngine({ kind: "managed", model, gateway }, { stage: "check" }), model };
}

/** Our cost for a call on someone's own key, when we know the model's price (for the cost picture only). */
function knownCost(model: string, usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }): number {
  const entry = allModels().find((candidate) => candidate.id === model);
  return entry ? costMicros(entry, usage) : 0;
}

class CrewcutEngine implements AgentEngine {
  readonly name = CREWCUT_ENGINE;
  readonly label = "Crewcut AI";
  readonly acceptsCustomModels = true;
  readonly preserveCustomModels = true;
  readonly capabilities = BASE_CAPABILITIES;

  get defaultModel(): string {
    return defaultModel()?.id ?? "claude-sonnet-5-5";
  }

  get supportedModels(): readonly string[] {
    return availableModels().map((model) => model.id);
  }

  async *stream(opts: EngineStreamOptions): AsyncIterable<EngineEvent> {
    const run = getRequestRunContext();
    const email = getRequestUserEmail() ?? run?.owner;
    const orgId = getRequestOrgId() ?? null;
    const route = await cachedRoute(opts.model, email, orgId);

    if (route.kind === "unavailable") {
      yield { type: "stop", reason: "error", error: route.message, errorCode: "crewcut_ai_unavailable" };
      return;
    }

    if (route.kind === "managed") {
      if (!email) {
        yield { type: "stop", reason: "error", error: "Sign in to use Crewcut AI.", errorCode: "crewcut_ai_unavailable" };
        return;
      }
      const workspace = workspaceOf({ email, orgId });
      try {
        const checked = creditCache.get(workspace);
        if (!checked || Date.now() - checked > CREDIT_TTL_MS) {
          await assertCredits(workspace, "the crew");
          creditCache.set(workspace, Date.now());
          prune(creditCache);
        }
      } catch (error) {
        creditCache.delete(workspace);
        if (error instanceof OutOfCreditsError) {
          yield { type: "stop", reason: "error", error: error.message, errorCode: "crewcut_out_of_credits", statusCode: 402 };
          return;
        }
        throw error;
      }
    }

    const before = attribute(opts.messages);
    const metadata = { workspace: orgId ?? "personal", person: email ? personTag(email) : undefined, video: before.videoId, stage: before.stage };
    const engine = route.kind === "managed" ? managedEngine(route, metadata) : route.engine;
    const model = route.kind === "managed" ? route.model.id : route.model;
    const source: UsageSource = route.kind === "managed" ? "managed" : route.kind === "own" ? "byok" : "deployment";
    const provider = route.kind === "managed" ? route.model.provider : route.engineName;

    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    let sawUsage = false;
    const emitted: Array<{ name: string; input: unknown }> = [];
    let errorText: string | undefined;
    // Set when a plain-words error has already reached the person: the inner
    // engine also throws after its error event, and that would show the raw
    // provider text ("Payment Required") instead. Rate limits still throw so
    // the agent's retry logic sees them.
    let explained = false;
    const started = Date.now();

    try {
      for await (const event of engine.stream({ ...opts, model })) {
        if (event.type === "usage") {
          sawUsage = true;
          usage.inputTokens += event.inputTokens;
          usage.outputTokens += event.outputTokens;
          usage.cacheReadTokens += event.cacheReadTokens ?? 0;
          usage.cacheWriteTokens += event.cacheWriteTokens ?? 0;
        } else if (event.type === "tool-call") {
          emitted.push({ name: event.name, input: event.input });
        } else if (event.type === "stop" && event.reason === "error") {
          errorText = event.error;
          const friendly = route.kind === "managed" ? describeGatewayError(event.error ?? "", event.statusCode) : null;
          if (friendly) {
            explained = event.statusCode !== 429;
            yield { ...event, error: friendly };
            continue;
          }
        }
        yield event;
      }
    } catch (error) {
      errorText ??= error instanceof Error ? error.message : String(error);
      if (!explained) throw error;
    } finally {
      if (email && (sawUsage || (route.kind === "managed" && errorText))) {
        const after = attribute(opts.messages, emitted);
        const cost = route.kind === "managed" ? costMicros(route.model, usage) : knownCost(model, usage);
        // Recorded without holding up the next step; failures are logged by recordAiUsage.
        void recordAiUsage({
          ownerEmail: email,
          orgId,
          source,
          kind: "llm",
          provider,
          model,
          ...usage,
          costMicros: cost,
          videoId: after.videoId,
          stage: after.stage,
          threadId: run?.threadId,
          runId: run?.runId,
          durationMs: Date.now() - started,
          error: errorText,
        });
      }
    }
  }
}

export const crewcutEngineEntry: AgentEngineEntry = {
  name: CREWCUT_ENGINE,
  label: "Crewcut AI",
  description: "Crewcut's own AI, paid for with credits. Uses your own provider key instead whenever you've added one.",
  capabilities: BASE_CAPABILITIES,
  get defaultModel() {
    return defaultModel()?.id ?? "claude-sonnet-5-5";
  },
  get supportedModels() {
    return availableModels().map((model) => model.id);
  },
  acceptsCustomModels: true,
  requiredEnvVars: [],
  create: () => new CrewcutEngine(),
};
