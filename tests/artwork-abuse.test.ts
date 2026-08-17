import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as requestUpload } from "@/app/api/artwork/upload/route";
import { presignS3Url } from "@/lib/storage/s3";
import { setArtworkStorageForTests, type ArtworkStorage } from "@/lib/storage/artwork-storage";
import { SESSION_COOKIE } from "@/lib/data/session-service";
import { __resetRateLimitsForTests } from "@/lib/rate-limit";
import { makeSession, resetDb } from "./db-helpers";

/**
 * Production Launch Session 03 §18, §19 — pre-upload artwork protection.
 *
 * Session 02 verified the object AFTER it was stored. Everything here
 * happens BEFORE: a signed URL that cannot be used for a bigger file, and a
 * total allowance that a patient script cannot walk around.
 */

type Recorded = { key: string; contentType: string; contentLength: number };

function fakeStorage(recorded: Recorded[]): ArtworkStorage {
  return {
    provider: "fake",
    async createUploadUrl({ key, contentType, contentLength }) {
      recorded.push({ key, contentType, contentLength });
      return { url: `https://fake.example/${key}`, method: "PUT", headers: { "Content-Type": contentType }, expiresInSeconds: 900 };
    },
    async head() {
      return null;
    },
    async readPrefix() {
      return null;
    },
    async createDownloadUrl() {
      return "https://fake.example/download";
    },
    async delete() {},
  };
}

let recorded: Recorded[];

beforeEach(async () => {
  await resetDb();
  __resetRateLimitsForTests();
  recorded = [];
  setArtworkStorageForTests(fakeStorage(recorded));
  delete process.env.ARTWORK_MAX_UPLOADS_PER_SESSION;
});

afterEach(() => {
  setArtworkStorageForTests(null);
  delete process.env.ARTWORK_MAX_UPLOADS_PER_SESSION;
});

const uploadRequest = (cookie: string, sizeBytes = 40_000) =>
  new Request("http://localhost/api/artwork/upload", {
    method: "POST",
    headers: { "content-type": "application/json", cookie, "x-forwarded-for": "203.0.113.30" },
    body: JSON.stringify({ fileName: "logo.png", fileType: "image/png", fileSizeBytes: sizeBytes }),
  });

/* ------------------------------------------------------------------ */

describe("the signed URL is bound to size as well as key and type (§18)", () => {
  it("passes the declared content length into the signature", async () => {
    const session = await makeSession();
    const res = await requestUpload(uploadRequest(`${SESSION_COOKIE}=${session.id}`, 123_456));
    expect(res.status).toBe(200);
    expect(recorded[0].contentLength).toBe(123_456);
    expect(recorded[0].contentType).toBe("image/png");
    expect(recorded[0].key).toMatch(/^artwork\/art_[0-9a-f]{32}\/logo\.png$/);
  });

  it("does NOT hand Content-Length back to the browser — the browser cannot forge it", async () => {
    const session = await makeSession();
    const res = await requestUpload(uploadRequest(`${SESSION_COOKIE}=${session.id}`));
    const data = await res.json();
    expect(Object.keys(data.upload.headers)).toEqual(["Content-Type"]);
  });

  it("a different content length produces a different signature", () => {
    const config = {
      endpoint: "https://s3.example",
      region: "us-east-1",
      bucket: "b",
      accessKeyId: "AK",
      secretAccessKey: "SK",
      forcePathStyle: false,
    };
    const now = new Date("2026-08-16T00:00:00Z");
    const small = presignS3Url(config, {
      method: "PUT",
      key: "artwork/a/logo.png",
      expiresInSeconds: 900,
      signedHeaders: { "content-type": "image/png", "content-length": "1000" },
      now,
    });
    const large = presignS3Url(config, {
      method: "PUT",
      key: "artwork/a/logo.png",
      expiresInSeconds: 900,
      signedHeaders: { "content-type": "image/png", "content-length": "25000000" },
      now,
    });
    expect(small).not.toBe(large);
  });
});

describe("per-session upload allowance (§19)", () => {
  it("stops unbounded anonymous object creation once the allowance is used", async () => {
    process.env.ARTWORK_MAX_UPLOADS_PER_SESSION = "3";
    const session = await makeSession();
    const cookie = `${SESSION_COOKIE}=${session.id}`;

    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      statuses.push((await requestUpload(uploadRequest(cookie))).status);
    }
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses.slice(3)).toEqual([429, 429]);
    // And no further object was created in the bucket.
    expect(recorded).toHaveLength(3);
  });

  it("tells the customer what to do instead of failing blankly", async () => {
    process.env.ARTWORK_MAX_UPLOADS_PER_SESSION = "1";
    const session = await makeSession();
    const cookie = `${SESSION_COOKIE}=${session.id}`;
    await requestUpload(uploadRequest(cookie));
    const res = await requestUpload(uploadRequest(cookie));
    const data = await res.json();
    expect(data.code).toBe("UPLOAD_LIMIT_REACHED");
    expect(data.error).toMatch(/contact us/i);
  });

  it("the default allowance is generous enough for a real multi-line B2B order", async () => {
    const session = await makeSession();
    const cookie = `${SESSION_COOKIE}=${session.id}`;
    // Six logos plus retries: nowhere near the default of 25.
    for (let i = 0; i < 9; i += 1) {
      const res = await requestUpload(uploadRequest(cookie));
      expect(res.status).toBe(200);
    }
  });

  it("one session's allowance does not consume another's", async () => {
    process.env.ARTWORK_MAX_UPLOADS_PER_SESSION = "1";
    const a = await makeSession();
    const b = await makeSession();
    await requestUpload(uploadRequest(`${SESSION_COOKIE}=${a.id}`));
    expect((await requestUpload(uploadRequest(`${SESSION_COOKIE}=${a.id}`))).status).toBe(429);
    expect((await requestUpload(uploadRequest(`${SESSION_COOKIE}=${b.id}`))).status).toBe(200);
  });
});
