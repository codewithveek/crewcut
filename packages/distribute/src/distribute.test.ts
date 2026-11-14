import { publishCopySchema } from "@crewcut/contracts";
import { describe, expect, it, vi } from "vitest";

import { adaptCopy } from "./copy";
import {
  MemoryTokenVault,
  OAuthError,
  buildAuthorizeUrl,
  getAccessToken,
  needsRefresh,
  pkcePair,
  revokeTokens,
  signState,
  verifyState,
} from "./oauth";
import { YouTubeClient, YouTubeError, bytesSource, ctrFraction, parseYouTubeError } from "./youtube";

const client = { clientId: "cid", clientSecret: "secret", redirectUri: "https://app.test/api/connections/youtube/callback" };
const SECRET = "test-state-secret-0123456789";

describe("oauth", () => {
  it("builds a PKCE authorize URL with least scopes", async () => {
    const { verifier, challenge } = await pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const url = new URL(buildAuthorizeUrl("youtube", client, { state: "s", codeChallenge: challenge }));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toContain("youtube.upload");
    expect(url.searchParams.get("scope")).not.toContain("youtube.force-ssl");
  });

  it("signs state and rejects tampering, expiry and open redirects", async () => {
    const payload = { provider: "youtube" as const, ownerEmail: "a@b.c", orgId: null, returnTo: "/settings/connections", nonce: "n", expiresAt: Date.now() + 60_000 };
    const state = await signState(payload, SECRET);
    await expect(verifyState(state, SECRET)).resolves.toMatchObject({ ownerEmail: "a@b.c" });
    await expect(verifyState(`${state}x`, SECRET)).rejects.toBeInstanceOf(OAuthError);
    await expect(verifyState(state, "other-secret")).rejects.toThrow(/signature/);
    await expect(verifyState(await signState({ ...payload, expiresAt: 1 }, SECRET), SECRET)).rejects.toThrow(/expired/);
    await expect(verifyState(await signState({ ...payload, returnTo: "//evil.com" }, SECRET), SECRET)).rejects.toThrow(/app path/);
  });

  it("refreshes once for concurrent callers and keeps the refresh token", async () => {
    const vault = new MemoryTokenVault();
    await vault.set("yt", { accessToken: "old", refreshToken: "r1", expiresAt: Date.now() - 1000 });
    const fetchImpl = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(JSON.stringify({ access_token: "new", expires_in: 3600 }), { status: 200 });
    });
    const [a, b] = await Promise.all([
      getAccessToken(vault, "yt", "youtube", client, { fetchImpl: fetchImpl as unknown as typeof fetch }),
      getAccessToken(vault, "yt", "youtube", client, { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(a.accessToken).toBe("new");
    expect(b.refreshToken).toBe("r1");
    expect((await vault.get("yt"))?.refreshToken).toBe("r1");
  });

  it("treats tokens without an expiry as refreshable", () => {
    expect(needsRefresh({ accessToken: "a", refreshToken: "r" })).toBe(true);
    expect(needsRefresh({ accessToken: "a" })).toBe(false);
    expect(needsRefresh({ accessToken: "a", expiresAt: Date.now() + 3_600_000 })).toBe(false);
  });

  it("revokes remotely and always forgets locally", async () => {
    const vault = new MemoryTokenVault();
    await vault.set("yt", { accessToken: "a", refreshToken: "r" });
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));
    const result = await revokeTokens(vault, "yt", "youtube", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.revokedRemotely).toBe(true);
    expect(await vault.get("yt")).toBeNull();
    const body = String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body);
    expect(body).toBe("token=r");
  });
});

describe("youtube", () => {
  const copy = publishCopySchema.parse({ title: "Why good motion feels physical", description: "Springs, not curves.", hashtags: ["motion", "design"], sources: [{ title: "Masterplan", url: "https://example.com" }] });

  it("adapts copy within limits and lists sources", () => {
    const adapted = adaptCopy("youtube", copy);
    expect(adapted.text).toContain("Sources:");
    expect(adapted.text).toContain("#motion");
    expect(adapted.tags).toEqual(["motion", "design"]);
  });

  it("reads click-through as a fraction whether YouTube sends a percent or a fraction", () => {
    expect(ctrFraction(4.2, 10_000, 400)).toBeCloseTo(0.042);
    // 0.8 as a fraction would mean 8,000 clicks for 120 views: it was 0.8%.
    expect(ctrFraction(0.8, 10_000, 120)).toBeCloseTo(0.008);
    expect(ctrFraction(0.05, 10_000, 600)).toBeCloseTo(0.05);
    expect(ctrFraction(0, 10_000, 600)).toBe(0);
    expect(ctrFraction(Number.NaN, 10_000, 600)).toBe(0);
    expect(ctrFraction(250, 10, 10)).toBe(1);
  });

  it("reads metrics, and still returns them when YouTube refuses the reach query", async () => {
    const respond = (refuseReach: boolean) =>
      vi.fn(async (url: string) => {
        const metrics = new URL(url).searchParams.get("metrics") ?? "";
        if (metrics.startsWith("views")) return Response.json({ rows: [[500, 40, 55, 3, 20]] });
        if (metrics === "audienceWatchRatio") return Response.json({ rows: [[0, 1], [0.5, 0.6]] });
        if (refuseReach) return Response.json({ error: { message: "Unknown identifier" } }, { status: 400 });
        return Response.json({ rows: [[12_000, 3.5]] });
      });
    const client = (fetchImpl: ReturnType<typeof respond>) => new YouTubeClient({ getToken: async () => "t", fetchImpl: fetchImpl as unknown as typeof fetch });
    const withReach = await client(respond(false)).metrics("vid", { startDate: "2026-11-01", endDate: "2026-11-08" });
    expect(withReach).toMatchObject({ views: 500, impressions: 12_000, averagePercentViewed: 0.55 });
    expect(withReach.ctr).toBeCloseTo(0.035);
    const refused = await client(respond(true)).metrics("vid", { startDate: "2026-11-01", endDate: "2026-11-08" });
    expect(refused).toMatchObject({ views: 500, impressions: 0, ctr: 0 });
    expect(refused.retention).toHaveLength(2);
  });

  it("parses quota errors as non-retryable", async () => {
    const error = await parseYouTubeError(new Response(JSON.stringify({ error: { message: "quota", errors: [{ reason: "quotaExceeded" }] } }), { status: 403 }));
    expect(error).toBeInstanceOf(YouTubeError);
    expect(error.code).toBe("quota");
    expect(error.retryable).toBe(false);
  });

  it("uploads in chunks, restarts from 0 when a 308 has no Range, and retries a 401 once", async () => {
    const bytes = new Uint8Array(1000).fill(7);
    const puts: string[] = [];
    let tokenCalls = 0;
    let firstPut = true;
    let unauthorizedSent = false;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (url.includes("uploadType=resumable")) {
        if (!unauthorizedSent) {
          unauthorizedSent = true;
          return new Response("", { status: 401 });
        }
        return new Response("", { status: 200, headers: { location: "https://upload.test/session" } });
      }
      if (url === "https://upload.test/session") {
        puts.push(headers["content-range"] ?? "");
        if (firstPut) {
          firstPut = false;
          return new Response("", { status: 308 }); // no Range header: nothing stored
        }
        const [start, end] = (headers["content-range"] ?? "").replace("bytes ", "").split("/")[0]!.split("-").map(Number);
        if ((end ?? 0) + 1 < 1000) return new Response("", { status: 308, headers: { range: `bytes=0-${end}` } });
        expect(start).toBeGreaterThan(0);
        return new Response(JSON.stringify({ id: "vid123" }), { status: 200 });
      }
      if (url.includes("/videos?part=status")) {
        return new Response(JSON.stringify({ items: [{ status: { privacyStatus: "private", uploadStatus: "uploaded" } }] }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });
    const youtube = new YouTubeClient({
      getToken: async (force) => {
        tokenCalls += 1;
        return force ? "fresh" : "stale";
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      chunkBytes: 400,
      sleep: async () => {},
    });
    const result = await youtube.upload({ video: bytesSource(bytes), copy, privacy: "private", containsSyntheticMedia: true, shorts: false });
    expect(result.videoId).toBe("vid123");
    expect(result.url).toBe("https://youtu.be/vid123");
    expect(puts[0]).toBe("bytes 0-399/1000");
    expect(puts[1]).toBe("bytes 0-399/1000");
    expect(puts.at(-1)).toBe("bytes 800-999/1000");
    expect(tokenCalls).toBeGreaterThan(1);
  });

  it("reports forced-private uploads", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("uploadType=resumable")) return new Response("", { status: 200, headers: { location: "https://upload.test/s" } });
      if (url === "https://upload.test/s") return new Response(JSON.stringify({ id: "v" }), { status: 200 });
      return new Response(JSON.stringify({ items: [{ status: { privacyStatus: "private" } }] }), { status: 200 });
    });
    const youtube = new YouTubeClient({ getToken: async () => "t", fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} });
    const result = await youtube.upload({ video: bytesSource(new Uint8Array(10)), copy, privacy: "public", containsSyntheticMedia: true, shorts: false });
    expect(result.warnings.join(" ")).toMatch(/compliance audit/);
  });
});
