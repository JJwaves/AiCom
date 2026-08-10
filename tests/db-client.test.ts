import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";

/**
 * Session 03.5 hardening: production must never silently fall back to the
 * embedded PGlite database (per-instance storage → data loss on redeploy).
 * Development and tests keep the zero-setup embedded fallback.
 *
 * getDb() caches its handle on globalThis; each case resets the cache so the
 * environment under test is what actually gets evaluated. This file runs in
 * its own vitest worker, so poking the cache cannot affect other test files.
 */

const resetDbCache = () => {
  (globalThis as { __bagdirectDb?: unknown }).__bagdirectDb = undefined;
};

describe("db client environment safety", () => {
  beforeEach(() => {
    resetDbCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetDbCache();
  });

  it("fails loudly in production when DATABASE_URL is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.DATABASE_URL; // tests/setup.ts already deletes it; be explicit

    await expect(getDb()).rejects.toThrow(/DATABASE_URL/);
    resetDbCache();
    // The message must be actionable: name the fix and the migration step.
    await expect(getDb()).rejects.toThrow(/npm run db:migrate/);
    resetDbCache();
    await expect(getDb()).rejects.toThrow(/PGlite/i);
  });

  it("treats an empty DATABASE_URL as missing in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "");

    await expect(getDb()).rejects.toThrow(/DATABASE_URL/);
  });

  it("does not cache the production failure (a fixed env can retry)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.DATABASE_URL;
    await expect(getDb()).rejects.toThrow(/DATABASE_URL/);

    // Same process, env corrected → next call succeeds instead of replaying
    // the cached rejection. (Pool creation is lazy — no server contacted.)
    vi.stubEnv("DATABASE_URL", "postgresql://app:secret@127.0.0.1:5432/bagdirect");
    await expect(getDb()).resolves.toBeDefined();
  });

  it("initializes real-Postgres mode in production without touching the network", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgresql://app:secret@127.0.0.1:5432/bagdirect");

    // node-postgres pools connect lazily, so a handle must materialize even
    // though nothing is listening — proving production config short-circuits
    // the embedded fallback without needing a live server in CI.
    await expect(getDb()).resolves.toBeDefined();
  });

  it("never leaks the connection string through the failure path", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.DATABASE_URL;
    const err = await getDb().then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).not.toMatch(/secret|:\/\/.*@/); // no credentials, no URLs
  });

  it("keeps the embedded fallback working outside production (dev/test)", async () => {
    // NODE_ENV is "test" under vitest and PGLITE_DATA_DIR is memory://.
    const db = await getDb();
    const result = (await db.execute(sql`select 1 as ok`)) as { rows: Array<Record<string, unknown>> };
    expect(result.rows).toEqual([{ ok: 1 }]);
  });
});
