import { registerAgentEngine } from "@agent-native/core/agent/engine";
import { defineAppConfig } from "@agent-native/core/server";

import { CREWCUT_ENGINE, crewcutEngineEntry } from "../lib/ai/engine.js";
import { gatewayConfig, providerBaseUrl } from "../lib/ai/gateway.js";

/**
 * Crewcut AI: every model call goes through the "crewcut" engine, which uses
 * the person's own key when they have one and Crewcut's own accounts (through
 * Cloudflare AI Gateway, paid with credits) when they don't.
 */
registerAgentEngine(crewcutEngineEntry);
defineAppConfig({ agent: { engine: CREWCUT_ENGINE } });

/*
 * The framework lets people chat only once it sees a usable AI connection: a
 * saved key, Builder, or an OpenAI-compatible endpoint. Choosing an engine
 * doesn't count. Crewcut AI is such an endpoint, so when the gateway is set up
 * we name its OpenAI route. Without an OPENAI_API_KEY next to it the framework
 * never sends anything there itself (an endpoint pairs only with the
 * deployment's own key, and people's keys keep their provider's address); the
 * Crewcut engine adds the gateway token on its own requests.
 */
const gateway = gatewayConfig();
if (gateway && !process.env.OPENAI_BASE_URL?.trim() && !process.env.OPENAI_API_KEY?.trim()) {
  process.env.OPENAI_BASE_URL = providerBaseUrl(gateway, "openai");
}
if (gateway) {
  console.log(`[crewcut-ai] Crewcut AI runs through Cloudflare AI Gateway "${gateway.gatewayId}".`);
} else if (process.env.NODE_ENV === "production") {
  console.warn("[crewcut-ai] No Cloudflare AI Gateway settings: people need their own AI key to use the crew.");
}

export default function crewcutAiEnginePlugin(): void {}
