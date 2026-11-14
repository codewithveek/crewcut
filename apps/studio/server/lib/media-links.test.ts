import { describe, expect, it } from "vitest";

import { linkExpiresAt } from "../../app/lib/media-links";
import { bucketConfigFromEnv, deploymentObjectKey, presignedObjectUrl } from "./media-links";

const ENV = {
  R2_BUCKET: "crewcut-media",
  R2_ACCESS_KEY_ID: "AKIDEXAMPLE",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com/",
  R2_PUBLIC_BASE_URL: "https://assets.example.com/",
} as unknown as NodeJS.ProcessEnv;

const row = (url: string, remoteId: string | null = "uploads/1-abc-photo.png", provider = "s3") => ({ provider, url, remoteId });

describe("bucketConfigFromEnv", () => {
  it("reads R2 or S3 settings and needs every field", () => {
    expect(bucketConfigFromEnv(ENV)).toEqual({
      bucket: "crewcut-media",
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "secret",
      endpoint: "https://acct.r2.cloudflarestorage.com",
      region: "auto",
    });
    expect(bucketConfigFromEnv({ ...ENV, S3_BUCKET: "other", S3_REGION: "eu" } as NodeJS.ProcessEnv)).toMatchObject({ bucket: "other", region: "eu" });
    expect(bucketConfigFromEnv({ ...ENV, R2_SECRET_ACCESS_KEY: " " } as NodeJS.ProcessEnv)).toBeNull();
  });

  it("refuses a plain-HTTP endpoint, since the links go to browsers", () => {
    expect(bucketConfigFromEnv({ ...ENV, R2_ENDPOINT: "http://minio:9000" } as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("deploymentObjectKey", () => {
  it("signs files stored under the deployment's public base", () => {
    expect(deploymentObjectKey(row("https://assets.example.com/uploads/1-abc-photo.png"), ENV)).toBe("uploads/1-abc-photo.png");
  });

  it("signs files under a former base listed in CREWCUT_MEDIA_PUBLIC_BASES", () => {
    const env = { ...ENV, CREWCUT_MEDIA_PUBLIC_BASES: " https://pub-123.r2.dev/ , https://old.example.com" } as NodeJS.ProcessEnv;
    expect(deploymentObjectKey(row("https://pub-123.r2.dev/uploads/1-abc-photo.png"), env)).toBe("uploads/1-abc-photo.png");
    expect(deploymentObjectKey(row("https://old.example.com/uploads/1-abc-photo.png"), env)).toBe("uploads/1-abc-photo.png");
    expect(deploymentObjectKey(row("https://pub-123.r2.dev/uploads/1-abc-photo.png"), ENV)).toBeNull();
  });

  it("leaves other buckets, providers and odd keys alone", () => {
    expect(deploymentObjectKey(row("https://someone-elses-bucket.com/uploads/x.png"), ENV)).toBeNull();
    // A base that only shares a prefix with ours is not ours.
    expect(deploymentObjectKey(row("https://assets.example.com.evil.net/uploads/x.png"), ENV)).toBeNull();
    expect(deploymentObjectKey(row("https://assets.example.com/uploads/x.png", null), ENV)).toBeNull();
    expect(deploymentObjectKey(row("https://assets.example.com/uploads/x.png", "uploads/x.png", "builder"), ENV)).toBeNull();
    expect(deploymentObjectKey(row("https://assets.example.com/uploads/x.png", "uploads/../secrets"), ENV)).toBeNull();
    expect(deploymentObjectKey(row("https://assets.example.com/uploads/x.png", "uploads//x.png"), ENV)).toBeNull();
  });
});

describe("presignedObjectUrl", () => {
  const config = bucketConfigFromEnv(ENV)!;
  const at = Date.parse("2026-11-11T14:25:10Z");

  it("makes a presigned GET on the bucket endpoint, never the public address", async () => {
    const url = new URL(await presignedObjectUrl(config, "uploads/1-abc-photo.png", { now: at }));
    expect(url.origin).toBe("https://acct.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/crewcut-media/uploads/1-abc-photo.png");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is the same link all hour, valid from the hour's start until at least minHours from now", async () => {
    const first = await presignedObjectUrl(config, "k.png", { now: at });
    const later = await presignedObjectUrl(config, "k.png", { now: at + 30 * 60_000 });
    const nextHour = await presignedObjectUrl(config, "k.png", { now: Date.parse("2026-11-11T15:00:01Z") });
    expect(later).toBe(first);
    expect(nextHour).not.toBe(first);
    const params = new URL(first).searchParams;
    expect(params.get("X-Amz-Date")).toBe("20261111T140000Z");
    // 1 hour window + 6 hours minimum.
    expect(params.get("X-Amz-Expires")).toBe(String(7 * 3600));
    const expires = linkExpiresAt(first);
    expect(expires - (at + 30 * 60_000)).toBeGreaterThanOrEqual(6 * 3600_000);
    expect(expires - at).toBeLessThanOrEqual(7 * 3600_000);
  });

  it("gives render jobs longer links, capped at the 7 days S3 allows", async () => {
    const render = new URL(await presignedObjectUrl(config, "k.png", { minHours: 24, now: at }));
    expect(render.searchParams.get("X-Amz-Expires")).toBe(String(25 * 3600));
    const capped = new URL(await presignedObjectUrl(config, "k.png", { minHours: 24 * 30, now: at }));
    expect(capped.searchParams.get("X-Amz-Expires")).toBe("604800");
  });
});

describe("linkExpiresAt", () => {
  it("reads local links, bucket links, and treats anything else as lasting", () => {
    expect(linkExpiresAt("/api/media/assets/a.png?exp=1762870000000&sig=abc")).toBe(1762870000000);
    expect(linkExpiresAt("https://x.r2.cloudflarestorage.com/b/k?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20261111T140000Z&X-Amz-Expires=3600&X-Amz-Signature=f")).toBe(
      Date.parse("2026-11-11T15:00:00Z"),
    );
    expect(linkExpiresAt("https://assets.example.com/uploads/a.png")).toBe(Number.POSITIVE_INFINITY);
    // "exp" must be a whole parameter, not the tail of another one.
    expect(linkExpiresAt("https://cdn.example.com/a.png?myexp=5")).toBe(Number.POSITIVE_INFINITY);
  });
});
