import { createHash } from "node:crypto";

import { type AiProvider, operatorKey, PROVIDER_ROUTES } from "./models.js";

/**
 * Cloudflare AI Gateway: every Crewcut AI request goes through it (logs,
 * spend limits, rate limits, one place to see what the crew costs). People's
 * own keys never come here; they go straight to their provider.
 *
 * Settings (all server-only):
 * - CREWCUT_AI_GATEWAY_ACCOUNT_ID (falls back to CLOUDFLARE_ACCOUNT_ID)
 * - CREWCUT_AI_GATEWAY_ID (default "crewcut")
 * - CREWCUT_AI_GATEWAY_TOKEN: a Cloudflare API token with AI Gateway Run
 *   (and Workers AI, for Cloudflare's own models). Falls back to
 *   CLOUDFLARE_API_TOKEN / CLOUDFLARE_API_KEY.
 * - CREWCUT_AI_GATEWAY_KEY_ALIAS: which stored provider key to use (default
 *   alias when unset).
 * - CREWCUT_AI_GATEWAY=off switches Crewcut AI off.
 */

export const GATEWAY_ORIGIN = "https://gateway.ai.cloudflare.com";

export interface GatewayConfig {
  accountId: string;
  gatewayId: string;
  token: string;
  keyAlias?: string;
}

type Env = Record<string, string | undefined>;
const clean = (value: string | undefined) => value?.replace(/\r/g, "").trim() || undefined;

export function gatewayConfig(env: Env = process.env): GatewayConfig | null {
  if (clean(env.CREWCUT_AI_GATEWAY)?.toLowerCase() === "off") return null;
  const accountId = clean(env.CREWCUT_AI_GATEWAY_ACCOUNT_ID) ?? clean(env.CLOUDFLARE_ACCOUNT_ID);
  const token = clean(env.CREWCUT_AI_GATEWAY_TOKEN) ?? clean(env.CLOUDFLARE_API_TOKEN) ?? clean(env.CLOUDFLARE_API_KEY);
  if (!accountId || !token) return null;
  if (!/^[a-f0-9]{32}$/i.test(accountId)) {
    console.warn("[crewcut-ai] The Cloudflare account id doesn't look right (32 hex characters); Crewcut AI is off.");
    return null;
  }
  const gatewayId = clean(env.CREWCUT_AI_GATEWAY_ID) ?? "crewcut";
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(gatewayId)) {
    console.warn("[crewcut-ai] CREWCUT_AI_GATEWAY_ID isn't a valid gateway id; Crewcut AI is off.");
    return null;
  }
  return { accountId, gatewayId, token, keyAlias: clean(env.CREWCUT_AI_GATEWAY_KEY_ALIAS) };
}

export function gatewayBaseUrl(config: GatewayConfig): string {
  return `${GATEWAY_ORIGIN}/v1/${config.accountId}/${config.gatewayId}`;
}

/** The base URL a provider's SDK should use: the gateway path that stands in for the provider's own API. */
export function providerBaseUrl(config: GatewayConfig, provider: AiProvider): string {
  return `${gatewayBaseUrl(config)}/${PROVIDER_ROUTES[provider].gatewayPath}`;
}

/**
 * Up to five values Cloudflare stores with each log line (its limit). No
 * emails: the person is a short one-way hash, enough to group a log by person.
 */
export interface GatewayMetadata {
  workspace?: string;
  person?: string;
  video?: string;
  stage?: string;
}

export function personTag(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 12);
}

function metadataHeader(metadata: GatewayMetadata): string | undefined {
  const entries = Object.entries({ app: "crewcut", ...metadata }).filter(([, value]) => typeof value === "string" && value.length > 0);
  if (entries.length <= 1) return undefined;
  return JSON.stringify(Object.fromEntries(entries.slice(0, 5).map(([key, value]) => [key, String(value).slice(0, 120)])));
}

/**
 * The fetch a provider SDK uses for Crewcut AI. It adds the gateway token and
 * metadata, and removes the SDK's placeholder key when the gateway supplies
 * the provider key itself (a stored key or Unified Billing only applies when
 * no provider key arrives: a placeholder would be forwarded and rejected).
 * Requests may only go to the gateway: anything else is refused.
 */
export function createGatewayFetch(options: {
  config: GatewayConfig;
  provider: AiProvider;
  metadata?: GatewayMetadata;
  /** Whether a real provider key travels with the request (Crewcut's own key). */
  sendsProviderKey: boolean;
  fetchImpl?: typeof fetch;
}): typeof fetch {
  const { config, provider, metadata, sendsProviderKey } = options;
  const route = PROVIDER_ROUTES[provider];
  const base = gatewayBaseUrl(config);
  const fetchImpl = options.fetchImpl ?? fetch;
  const meta = metadata ? metadataHeader(metadata) : undefined;

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const url = request ? request.url : input instanceof URL ? input.href : String(input);
    if (!url.startsWith(`${base}/`)) {
      throw new Error("Crewcut AI requests may only go to the Cloudflare AI Gateway.");
    }
    const headers = new Headers(request?.headers);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.set("cf-aig-authorization", `Bearer ${config.token}`);
    if (!sendsProviderKey) headers.delete(route.authHeader);
    if (config.keyAlias && !sendsProviderKey && provider !== "workers-ai") headers.set("cf-aig-byok-alias", config.keyAlias);
    if (meta) headers.set("cf-aig-metadata", meta);
    const body = init?.body ?? (request ? await request.arrayBuffer() : undefined);
    return fetchImpl(url, {
      method: init?.method ?? request?.method ?? "POST",
      headers,
      body: body as BodyInit | undefined,
      signal: init?.signal ?? request?.signal,
      redirect: "error",
    });
  }) as typeof fetch;
}

/** The key the SDK is built with: Crewcut's own key, or a placeholder the gateway fetch removes. */
export function sdkKeyFor(provider: AiProvider, env: Env = process.env): { apiKey: string; sendsProviderKey: boolean } {
  const key = operatorKey(provider, env);
  return key ? { apiKey: key, sendsProviderKey: true } : { apiKey: "supplied-by-cloudflare-ai-gateway", sendsProviderKey: false };
}

/**
 * The gateway's errors arrive as `{ name: "AiGatewayError", internalCode, message }`.
 * Turn the ones people can act on into plain words; null when it isn't one.
 */
export function describeGatewayError(message: string, statusCode?: number): string | null {
  if (statusCode === 402 || /Insufficient unified billing credits|Payment Required|internalCode"?:\s*2021/i.test(message)) {
    return "Crewcut AI can't reach this model right now (the AI account needs topping up). Try another model, or tell the Crewcut team.";
  }
  if (statusCode === 401 || (/AiGatewayError/.test(message) && /Unauthorized|2009/.test(message))) {
    return "Crewcut AI isn't connected properly right now. The Crewcut team has to fix the gateway token.";
  }
  if (statusCode === 429 || (/AiGatewayError/.test(message) && /rate limit|429/i.test(message))) {
    return "Crewcut AI is busy right now. Try again in a minute.";
  }
  return null;
}
