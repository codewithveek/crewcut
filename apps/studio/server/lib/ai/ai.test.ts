import { describe, expect, it } from "vitest";

import { millicreditsForCost, normalizePlan, PLANS } from "../plans.js";
import { attribute } from "./attribution.js";
import { createGatewayFetch, describeGatewayError, gatewayConfig, personTag, providerBaseUrl, sdkKeyFor } from "./gateway.js";
import { availableModels, costMicros, defaultModel, enabledProviders, resolveModel } from "./models.js";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const env = (extra: Record<string, string> = {}) => ({ CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CLOUDFLARE_API_KEY: "cf-token", ...extra });

describe("Crewcut AI models", () => {
  it("offers Workers AI by default and providers we hold keys for", () => {
    expect([...enabledProviders({})]).toEqual(["workers-ai"]);
    expect([...enabledProviders({ CREWCUT_AI_ANTHROPIC_KEY: "sk-ant" })].sort()).toEqual(["anthropic", "workers-ai"]);
    expect([...enabledProviders({ CREWCUT_AI_PROVIDERS: "anthropic, google" })]).toEqual(["anthropic", "google"]);
  });

  it("picks the best available default and falls back for unknown requests", () => {
    expect(defaultModel({})?.id).toBe("@cf/zai-org/glm-5.3");
    expect(defaultModel({ CREWCUT_AI_PROVIDERS: "anthropic,workers-ai" })?.id).toBe("claude-sonnet-5-5");
    expect(defaultModel({ CREWCUT_AI_DEFAULT_MODEL: "@cf/openai/gpt-oss-120b" })?.id).toBe("@cf/openai/gpt-oss-120b");
    expect(resolveModel("claude-opus-5-5", {})?.id).toBe("@cf/zai-org/glm-5.3");
    expect(resolveModel("@cf/openai/gpt-oss-120b", {})?.id).toBe("@cf/openai/gpt-oss-120b");
  });

  it("accepts model overrides and ignores bad ones", () => {
    const custom = JSON.stringify([{ id: "@cf/meta/llama-4-scout-17b-16e-instruct", provider: "workers-ai", label: "Llama 4 Scout", tier: "economy", inputPerMTok: 0.27, outputPerMTok: 0.85, priceSource: "test" }]);
    expect(availableModels({ CREWCUT_AI_MODELS: custom }).some((model) => model.id === "@cf/meta/llama-4-scout-17b-16e-instruct")).toBe(true);
    expect(availableModels({ CREWCUT_AI_MODELS: "{nope" }).length).toBe(availableModels({}).length);
  });

  it("prices cached tokens once, at the cache rate", () => {
    const sonnet = { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2, cacheWritePerMTok: 2.5 };
    // 1M prompt tokens of which 800k cached reads: 200k × $2 + 800k × $0.20 = $0.56; 10k out × $10 = $0.10
    expect(costMicros(sonnet, { inputTokens: 1_000_000, outputTokens: 10_000, cacheReadTokens: 800_000 })).toBe(660_000);
    expect(costMicros(sonnet, { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });
});

describe("credits", () => {
  it("turns cost into credits with the markup, never rounding a paid call to zero", () => {
    // $0.60 × 3 ÷ $0.05 = 36 credits
    expect(millicreditsForCost(600_000, {})).toBe(36_000);
    expect(millicreditsForCost(1, {})).toBe(1);
    expect(millicreditsForCost(100_000, {})).toBe(6000); // $0.10 × 3 ÷ $0.05, no float noise
    expect(millicreditsForCost(0, {})).toBe(0);
    expect(millicreditsForCost(600_000, { CREWCUT_CREDIT_MARKUP: "2", CREWCUT_CREDIT_USD: "0.04" })).toBe(30_000);
  });

  it("reads old Pro workspaces as Creator", () => {
    expect(normalizePlan("pro")).toBe("creator");
    expect(normalizePlan("studio")).toBe("studio");
    expect(normalizePlan(undefined)).toBe("free");
    expect(PLANS.studio.monthlyCredits).toBeGreaterThan(PLANS.creator.monthlyCredits);
  });
});

describe("Cloudflare AI Gateway", () => {
  it("needs an account id and a token, and can be switched off", () => {
    expect(gatewayConfig({})).toBeNull();
    expect(gatewayConfig(env())?.gatewayId).toBe("crewcut");
    expect(gatewayConfig(env({ CREWCUT_AI_GATEWAY: "off" }))).toBeNull();
    expect(gatewayConfig(env({ CLOUDFLARE_ACCOUNT_ID: "not-an-id" }))).toBeNull();
    expect(gatewayConfig(env({ CREWCUT_AI_GATEWAY_TOKEN: "own", CREWCUT_AI_GATEWAY_ID: "prod" }))).toMatchObject({ token: "own", gatewayId: "prod" });
  });

  it("maps each provider to its gateway path", () => {
    const config = gatewayConfig(env())!;
    const base = `https://gateway.ai.cloudflare.com/v1/${ACCOUNT}/crewcut`;
    expect(providerBaseUrl(config, "anthropic")).toBe(`${base}/anthropic/v1`);
    expect(providerBaseUrl(config, "openai")).toBe(`${base}/openai`);
    expect(providerBaseUrl(config, "google")).toBe(`${base}/google-ai-studio/v1beta`);
    expect(providerBaseUrl(config, "workers-ai")).toBe(`${base}/workers-ai/v1`);
  });

  it("adds the gateway token and removes the placeholder key when the gateway holds the key", async () => {
    const config = gatewayConfig(env({ CREWCUT_AI_GATEWAY_KEY_ALIAS: "production" }))!;
    const seen: Array<{ url: string; headers: Headers; body: string }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: new Headers(init.headers), body: String(init.body) });
      return new Response("{}");
    }) as unknown as typeof fetch;
    const { apiKey, sendsProviderKey } = sdkKeyFor("anthropic", {});
    expect(sendsProviderKey).toBe(false);
    const gatewayFetch = createGatewayFetch({ config, provider: "anthropic", sendsProviderKey, metadata: { video: "vid_abc123", stage: "script", person: personTag("A@B.com") }, fetchImpl });
    await gatewayFetch(`${providerBaseUrl(config, "anthropic")}/messages`, { method: "POST", headers: { "x-api-key": apiKey, "content-type": "application/json" }, body: "{}" });
    const [call] = seen;
    expect(call?.headers.get("cf-aig-authorization")).toBe("Bearer cf-token");
    expect(call?.headers.get("x-api-key")).toBeNull();
    expect(call?.headers.get("cf-aig-byok-alias")).toBe("production");
    expect(JSON.parse(call?.headers.get("cf-aig-metadata") ?? "{}")).toEqual({ app: "crewcut", video: "vid_abc123", stage: "script", person: personTag("a@b.com") });
    expect(call?.headers.get("cf-aig-metadata")).not.toContain("@");
  });

  it("keeps Crewcut's own provider key when one is set", async () => {
    const config = gatewayConfig(env())!;
    let headers = new Headers();
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      headers = new Headers(init.headers);
      return new Response("{}");
    }) as unknown as typeof fetch;
    const key = sdkKeyFor("openai", { CREWCUT_AI_OPENAI_KEY: "sk-real" });
    const gatewayFetch = createGatewayFetch({ config, provider: "openai", sendsProviderKey: key.sendsProviderKey, fetchImpl });
    await gatewayFetch(`${providerBaseUrl(config, "openai")}/responses`, { headers: { authorization: `Bearer ${key.apiKey}` }, body: "{}" });
    expect(headers.get("authorization")).toBe("Bearer sk-real");
    expect(headers.get("cf-aig-byok-alias")).toBeNull();
  });

  it("refuses requests that aren't for the gateway", async () => {
    const config = gatewayConfig(env())!;
    const gatewayFetch = createGatewayFetch({ config, provider: "openai", sendsProviderKey: false, fetchImpl: (async () => new Response("{}")) as unknown as typeof fetch });
    await expect(gatewayFetch("https://api.openai.com/v1/responses", {})).rejects.toThrow(/only go to the Cloudflare AI Gateway/);
    await expect(gatewayFetch(`https://gateway.ai.cloudflare.com/v1/${ACCOUNT}/other/openai/responses`, {})).rejects.toThrow();
  });

  it("explains gateway errors people can act on", () => {
    expect(describeGatewayError('{"name":"AiGatewayError","message":"Insufficient unified billing credits."}')).toMatch(/topping up/);
    expect(describeGatewayError('{"name":"AiGatewayError","internalCode":2009,"message":"Unauthorized"}')).toMatch(/gateway token/);
    expect(describeGatewayError("Payment Required", 402)).toMatch(/topping up/);
    expect(describeGatewayError("Some other failure")).toBeNull();
    expect(describeGatewayError("Internal error", 500)).toBeNull();
  });
});

describe("cost attribution", () => {
  const messages = [
    { role: "user", content: [{ type: "text", text: "Run autopilot for video vid_64c2fcc570ec46bfaa6c please" }] },
    { role: "assistant", content: [{ type: "tool-call", name: "find-trends", input: { videoId: "vid_64c2fcc570ec46bfaa6c" } }] },
  ];

  it("uses the tool calls the model just made first", () => {
    expect(attribute(messages, [{ name: "write-script", input: { videoId: "vid_other1234567" } }])).toEqual({ videoId: "vid_other1234567", stage: "script" });
  });

  it("falls back to the latest earlier tool call, then the text", () => {
    expect(attribute(messages)).toEqual({ videoId: "vid_64c2fcc570ec46bfaa6c", stage: "trend" });
    expect(attribute([messages[0]!])).toEqual({ videoId: "vid_64c2fcc570ec46bfaa6c", stage: "chat" });
    expect(attribute([])).toEqual({ videoId: undefined, stage: "chat" });
  });
});
