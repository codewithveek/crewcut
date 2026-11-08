/**
 * OAuth for publishing platforms (ported from vid-skills `auth.ts`), fixing
 * the gaps its audit found:
 * - PKCE (S256) on every flow, including Google's
 * - signed, expiring `state` (HMAC-SHA256) instead of trusting a KV lookup alone
 * - revoke on disconnect
 * - single-flight refresh, so concurrent callers never race a rotating token
 * - tokens without a known expiry still refresh (treated as "maybe expired")
 * Tokens are persisted through a `TokenVault` the app backs with Agent-Native's
 * encrypted credential store — never in plain tables.
 */

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms. Absent = unknown; such tokens are refreshed when possible. */
  expiresAt?: number;
  scope?: string;
  extra?: Record<string, string>;
}

export interface TokenVault {
  get(key: string): Promise<TokenSet | null>;
  set(key: string, tokens: TokenSet): Promise<void>;
  delete(key: string): Promise<void>;
}

export class MemoryTokenVault implements TokenVault {
  private readonly store = new Map<string, TokenSet>();
  async get(key: string) {
    return this.store.get(key) ?? null;
  }
  async set(key: string, tokens: TokenSet) {
    this.store.set(key, tokens);
  }
  async delete(key: string) {
    this.store.delete(key);
  }
}

export interface OAuthClient {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
}

export interface OAuthProviderSpec {
  authorizeUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
  /** Least privilege: only what publishing and analytics need. */
  scopes: readonly string[];
  scopeSeparator?: string;
  extraAuthorizeParams?: Record<string, string>;
}

export const OAUTH_PROVIDERS = {
  youtube: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke",
    scopes: [
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/yt-analytics.readonly",
    ],
    extraAuthorizeParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
  },
} as const satisfies Record<string, OAuthProviderSpec>;

export type OAuthProviderId = keyof typeof OAUTH_PROVIDERS;

export class OAuthError extends Error {
  override readonly name = "OAuthError";
  constructor(
    readonly code: "state_invalid" | "state_expired" | "exchange_failed" | "refresh_failed" | "not_connected" | "revoke_failed",
    message: string,
  ) {
    super(message);
  }
}

// ── Encoding helpers (Web Crypto: works in Node, workers and the browser) ──

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export function randomToken(bytes = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken(32);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export interface OAuthStatePayload {
  provider: OAuthProviderId;
  /** Who started the flow; the callback must be the same session. */
  ownerEmail: string;
  orgId: string | null;
  /** Where to send the browser afterwards (must be a relative app path). */
  returnTo: string;
  nonce: string;
  expiresAt: number;
}

/** `payload.signature`, both base64url. The PKCE verifier is stored server-side under `nonce`. */
export async function signState(payload: OAuthStatePayload, secret: string): Promise<string> {
  const body = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(body));
  return `${body}.${base64Url(new Uint8Array(signature))}`;
}

export async function verifyState(state: string, secret: string, now = Date.now()): Promise<OAuthStatePayload> {
  const [body, signature] = state.split(".");
  if (!body || !signature) throw new OAuthError("state_invalid", "Malformed OAuth state.");
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromBase64Url(signature), new TextEncoder().encode(body));
  if (!valid) throw new OAuthError("state_invalid", "OAuth state signature is invalid.");
  const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as OAuthStatePayload;
  if (payload.expiresAt < now) throw new OAuthError("state_expired", "The connection attempt expired. Start again.");
  // Browsers read "/\host" like "//host": both would leave the app.
  if (!payload.returnTo.startsWith("/") || payload.returnTo.startsWith("//") || payload.returnTo.includes("\\")) {
    throw new OAuthError("state_invalid", "Redirect target must be an app path.");
  }
  return payload;
}

export function buildAuthorizeUrl(
  provider: OAuthProviderId,
  client: OAuthClient,
  options: { state: string; codeChallenge: string; loginHint?: string },
): string {
  const spec: OAuthProviderSpec = OAUTH_PROVIDERS[provider];
  const params = new URLSearchParams({
    response_type: "code",
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    scope: spec.scopes.join(spec.scopeSeparator ?? " "),
    state: options.state,
    code_challenge: options.codeChallenge,
    code_challenge_method: "S256",
    ...(spec.extraAuthorizeParams ?? {}),
    ...(options.loginHint ? { login_hint: options.loginHint } : {}),
  });
  return `${spec.authorizeUrl}?${params.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(
  provider: OAuthProviderId,
  client: OAuthClient,
  params: Record<string, string>,
  fetchImpl: typeof fetch,
  failure: "exchange_failed" | "refresh_failed",
): Promise<TokenSet> {
  const spec: OAuthProviderSpec = OAUTH_PROVIDERS[provider];
  const body = new URLSearchParams({ ...params, client_id: client.clientId, ...(client.clientSecret ? { client_secret: client.clientSecret } : {}) });
  const response = await fetchImpl(spec.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || !json.access_token) {
    throw new OAuthError(failure, `${provider}: ${json.error ?? `HTTP ${response.status}`} ${json.error_description ?? ""}`.trim());
  }
  return {
    accessToken: json.access_token,
    ...(json.refresh_token ? { refreshToken: json.refresh_token } : {}),
    ...(json.expires_in ? { expiresAt: Date.now() + json.expires_in * 1000 } : {}),
    ...(json.scope ? { scope: json.scope } : {}),
  };
}

export function exchangeCode(
  provider: OAuthProviderId,
  client: OAuthClient,
  options: { code: string; codeVerifier: string; fetchImpl?: typeof fetch },
): Promise<TokenSet> {
  return tokenRequest(
    provider,
    client,
    { grant_type: "authorization_code", code: options.code, redirect_uri: client.redirectUri, code_verifier: options.codeVerifier },
    options.fetchImpl ?? fetch,
    "exchange_failed",
  );
}

const REFRESH_MARGIN_MS = 120_000;
const inflightRefreshes = new Map<string, Promise<TokenSet>>();

export function needsRefresh(tokens: TokenSet, now = Date.now()): boolean {
  if (!tokens.accessToken) return true;
  if (tokens.expiresAt === undefined) return Boolean(tokens.refreshToken);
  return tokens.expiresAt - now <= REFRESH_MARGIN_MS;
}

/**
 * A valid access token for `key`, refreshing ≥ 2 min before expiry. One
 * refresh per key at a time: rotating providers issue a new refresh token per
 * refresh, and losing it locks the account out until a person reconnects.
 */
export async function getAccessToken(
  vault: TokenVault,
  key: string,
  provider: OAuthProviderId,
  client: OAuthClient,
  options: { force?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<TokenSet> {
  const tokens = await vault.get(key);
  if (!tokens) throw new OAuthError("not_connected", `${provider} isn't connected. Connect it in Settings → Connections.`);
  if (!options.force && !needsRefresh(tokens)) return tokens;
  if (!tokens.refreshToken) {
    if (tokens.accessToken && !options.force) return tokens;
    throw new OAuthError("refresh_failed", `${provider}: the token expired and can't be renewed. Reconnect the account.`);
  }
  const existing = inflightRefreshes.get(key);
  if (existing) return existing;
  const refresh = (async () => {
    const fresh = await tokenRequest(
      provider,
      client,
      { grant_type: "refresh_token", refresh_token: tokens.refreshToken as string },
      options.fetchImpl ?? fetch,
      "refresh_failed",
    );
    const merged: TokenSet = { ...tokens, ...fresh, refreshToken: fresh.refreshToken ?? tokens.refreshToken };
    await vault.set(key, merged);
    return merged;
  })();
  inflightRefreshes.set(key, refresh);
  try {
    return await refresh;
  } finally {
    inflightRefreshes.delete(key);
  }
}

/** Revokes at the provider (best effort) and always forgets the tokens locally. */
export async function revokeTokens(
  vault: TokenVault,
  key: string,
  provider: OAuthProviderId,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<{ revokedRemotely: boolean }> {
  const tokens = await vault.get(key);
  const spec: OAuthProviderSpec = OAUTH_PROVIDERS[provider];
  let revokedRemotely = false;
  const token = tokens?.refreshToken ?? tokens?.accessToken;
  if (token && spec.revokeUrl) {
    try {
      const response = await (options.fetchImpl ?? fetch)(spec.revokeUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }).toString(),
      });
      revokedRemotely = response.ok;
    } catch {
      revokedRemotely = false;
    }
  }
  await vault.delete(key);
  return { revokedRemotely };
}
