import { z } from "zod";

/**
 * Crewcut AI: the models Crewcut runs on its own accounts, through Cloudflare
 * AI Gateway. People who add their own provider key don't use this list; their
 * key goes straight to their provider and costs no credits.
 *
 * Prices are US dollars per million tokens and drive both the admin cost page
 * and credit charges, so every entry says where its price came from. Override
 * or add models without a deploy with CREWCUT_AI_MODELS (a JSON array of
 * entries in this shape, matched by id).
 */

export const AI_PROVIDERS = ["anthropic", "openai", "google", "groq", "mistral", "cohere", "workers-ai"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** The AI SDK package that talks to each provider, and where it sits behind the gateway. */
export interface ProviderRoute {
  /** Which @ai-sdk provider (or "openai" in Chat Completions mode for Workers AI). */
  sdk: "anthropic" | "openai" | "google" | "groq" | "mistral" | "cohere";
  /** Path after https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/ that replaces the provider's own base URL. */
  gatewayPath: string;
  /** The header the SDK puts the provider key in; removed when the gateway supplies the key itself. */
  authHeader: "x-api-key" | "authorization" | "x-goog-api-key";
  /** Env var holding Crewcut's own key for this provider, sent with each request. Unset = keys stored in the gateway, or Unified Billing. */
  keyEnv: string | null;
  /** OpenAI only: use the Responses API (the gateway passes it through). */
  forceResponses?: boolean;
  label: string;
}

export const PROVIDER_ROUTES: Record<AiProvider, ProviderRoute> = {
  anthropic: { sdk: "anthropic", gatewayPath: "anthropic/v1", authHeader: "x-api-key", keyEnv: "CREWCUT_AI_ANTHROPIC_KEY", label: "Anthropic" },
  openai: { sdk: "openai", gatewayPath: "openai", authHeader: "authorization", keyEnv: "CREWCUT_AI_OPENAI_KEY", forceResponses: true, label: "OpenAI" },
  google: { sdk: "google", gatewayPath: "google-ai-studio/v1beta", authHeader: "x-goog-api-key", keyEnv: "CREWCUT_AI_GOOGLE_KEY", label: "Google" },
  groq: { sdk: "groq", gatewayPath: "groq", authHeader: "authorization", keyEnv: "CREWCUT_AI_GROQ_KEY", label: "Groq" },
  mistral: { sdk: "mistral", gatewayPath: "mistral/v1", authHeader: "authorization", keyEnv: "CREWCUT_AI_MISTRAL_KEY", label: "Mistral" },
  cohere: { sdk: "cohere", gatewayPath: "cohere/v2", authHeader: "authorization", keyEnv: "CREWCUT_AI_COHERE_KEY", label: "Cohere" },
  // Cloudflare's own models: the gateway token pays for them, so there is never a provider key.
  "workers-ai": { sdk: "openai", gatewayPath: "workers-ai/v1", authHeader: "authorization", keyEnv: null, label: "Cloudflare Workers AI" },
};

export const modelEntrySchema = z.object({
  id: z.string().trim().min(1).max(120),
  provider: z.enum(AI_PROVIDERS),
  label: z.string().trim().min(1).max(80),
  /** economy: cheap everyday work · standard: the default crew · premium: costs more credits per token. */
  tier: z.enum(["economy", "standard", "premium"]),
  inputPerMTok: z.number().nonnegative(),
  outputPerMTok: z.number().nonnegative(),
  cacheReadPerMTok: z.number().nonnegative().default(0),
  cacheWritePerMTok: z.number().nonnegative().default(0),
  vision: z.boolean().default(false),
  /** Where the price came from, shown on the admin cost page. */
  priceSource: z.string().trim().min(1).max(200),
});
export type ModelEntry = z.infer<typeof modelEntrySchema>;

const BUILT_IN_MODELS: ModelEntry[] = [
  // Anthropic list prices (Claude API docs, cached 2026-10-06); cache writes are 1.25× input (5-minute cache).
  { id: "claude-sonnet-5-5", provider: "anthropic", label: "Claude Sonnet 5.5", tier: "standard", inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2, cacheWritePerMTok: 2.5, vision: true, priceSource: "Anthropic list price" },
  { id: "claude-haiku-5-5", provider: "anthropic", label: "Claude Haiku 5.5", tier: "economy", inputPerMTok: 0.1, outputPerMTok: 0.5, cacheReadPerMTok: 0.01, cacheWritePerMTok: 0.125, vision: true, priceSource: "Anthropic list price" },
  { id: "claude-opus-5-5", provider: "anthropic", label: "Claude Opus 5.5", tier: "premium", inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2, cacheWritePerMTok: 5, vision: true, priceSource: "Anthropic list price" },
  // OpenAI and Google: the framework's price table (estimates until checked against the providers' pages).
  { id: "gpt-5.6-terra", provider: "openai", label: "GPT-5.6 Terra", tier: "standard", inputPerMTok: 2, outputPerMTok: 12, cacheReadPerMTok: 0.2, cacheWritePerMTok: 0, vision: true, priceSource: "estimate (framework price table)" },
  { id: "gemini-3.1-pro-preview", provider: "google", label: "Gemini 3.1 Pro", tier: "standard", inputPerMTok: 1.25, outputPerMTok: 10, cacheReadPerMTok: 0.31, cacheWritePerMTok: 0, vision: true, priceSource: "estimate (framework price table)" },
  { id: "gemini-3.8-flash", provider: "google", label: "Gemini 3.8 Flash", tier: "economy", inputPerMTok: 0.15, outputPerMTok: 0.6, cacheReadPerMTok: 0.04, cacheWritePerMTok: 0, vision: true, priceSource: "estimate (framework price table)" },
  // Workers AI: prices from Cloudflare's model catalog API (2026-11-09).
  { id: "@cf/zai-org/glm-5.3", provider: "workers-ai", label: "GLM 5.3", tier: "standard", inputPerMTok: 1.4, outputPerMTok: 4.4, cacheReadPerMTok: 0.26, cacheWritePerMTok: 0, vision: false, priceSource: "Cloudflare model catalog" },
  { id: "@cf/openai/gpt-oss-120b", provider: "workers-ai", label: "gpt-oss 120B", tier: "economy", inputPerMTok: 0.35, outputPerMTok: 0.75, cacheReadPerMTok: 0, cacheWritePerMTok: 0, vision: false, priceSource: "Cloudflare model catalog" },
];

/** Preferred defaults, best first; the first one whose provider is switched on wins. */
const DEFAULT_PREFERENCE = ["claude-sonnet-5-5", "gpt-5.6-terra", "gemini-3.1-pro-preview", "@cf/zai-org/glm-5.3"];

type Env = Record<string, string | undefined>;

const clean = (value: string | undefined) => value?.replace(/\r/g, "").trim() || undefined;

/** Built-in models plus CREWCUT_AI_MODELS overrides (bad JSON is reported, not fatal). */
export function allModels(env: Env = process.env): ModelEntry[] {
  const models = new Map(BUILT_IN_MODELS.map((model) => [model.id, model]));
  const raw = clean(env.CREWCUT_AI_MODELS);
  if (raw) {
    try {
      const parsed = z.array(modelEntrySchema).parse(JSON.parse(raw));
      for (const model of parsed) models.set(model.id, model);
    } catch (error) {
      console.warn("[crewcut-ai] CREWCUT_AI_MODELS is not valid; using the built-in models only:", error instanceof Error ? error.message : error);
    }
  }
  return [...models.values()];
}

/** Crewcut's own key for a provider, if one is set. */
export function operatorKey(provider: AiProvider, env: Env = process.env): string | undefined {
  const name = PROVIDER_ROUTES[provider].keyEnv;
  return name ? clean(env[name]) : undefined;
}

/**
 * Providers Crewcut AI may use. CREWCUT_AI_PROVIDERS lists them explicitly
 * (needed for providers whose keys live in the gateway or use Unified
 * Billing, which the app can't see). Otherwise: every provider we hold a key
 * for, plus Workers AI, which the gateway token always covers.
 */
export function enabledProviders(env: Env = process.env): Set<AiProvider> {
  const listed = clean(env.CREWCUT_AI_PROVIDERS);
  if (listed) {
    const names = listed.split(",").map((name) => name.trim().toLowerCase()).filter(Boolean);
    return new Set(AI_PROVIDERS.filter((provider) => names.includes(provider)));
  }
  const enabled = new Set<AiProvider>(["workers-ai"]);
  for (const provider of AI_PROVIDERS) if (operatorKey(provider, env)) enabled.add(provider);
  return enabled;
}

export function availableModels(env: Env = process.env): ModelEntry[] {
  const providers = enabledProviders(env);
  return allModels(env).filter((model) => providers.has(model.provider));
}

export function defaultModel(env: Env = process.env): ModelEntry | undefined {
  const available = availableModels(env);
  const configured = clean(env.CREWCUT_AI_DEFAULT_MODEL);
  if (configured) {
    const match = available.find((model) => model.id === configured);
    if (match) return match;
    console.warn(`[crewcut-ai] CREWCUT_AI_DEFAULT_MODEL "${configured}" isn't an available Crewcut AI model; picking one.`);
  }
  for (const id of DEFAULT_PREFERENCE) {
    const match = available.find((model) => model.id === id);
    if (match) return match;
  }
  return available[0];
}

/** The model to run: the one asked for when Crewcut AI offers it, else the default. */
export function resolveModel(requested: string | undefined, env: Env = process.env): ModelEntry | undefined {
  const available = availableModels(env);
  return available.find((model) => model.id === requested) ?? defaultModel(env);
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/**
 * What one call cost us, in millionths of a dollar. `inputTokens` is the whole
 * prompt and already includes the cached part (the engine convention), so the
 * cached tokens are moved to their own rate instead of being counted twice.
 */
export function costMicros(model: Pick<ModelEntry, "inputPerMTok" | "outputPerMTok" | "cacheReadPerMTok" | "cacheWritePerMTok">, usage: TokenUsage): number {
  const cacheRead = Math.max(0, usage.cacheReadTokens ?? 0);
  const cacheWrite = Math.max(0, usage.cacheWriteTokens ?? 0);
  const uncached = Math.max(0, usage.inputTokens - cacheRead - cacheWrite);
  // dollars per million tokens × tokens = micro-dollars
  const micros = uncached * model.inputPerMTok + Math.max(0, usage.outputTokens) * model.outputPerMTok + cacheRead * model.cacheReadPerMTok + cacheWrite * model.cacheWritePerMTok;
  return Math.round(micros);
}
