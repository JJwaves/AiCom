import { and, lt, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { rateLimitCounters } from "@/db/schema";

/**
 * Durable, shared rate-limit counters (Production Launch Session 03 §14).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY POSTGRES AND NOT REDIS
 * ─────────────────────────────────────────────────────────────────────────
 * The spec asks for "the smallest production-safe implementation" and warns
 * against introducing a large infrastructure platform unnecessarily.
 * Production already REQUIRES a Postgres (db/client.ts refuses to start
 * without one), so a shared counter costs one table and zero new vendors,
 * credentials, failure modes or bills. Redis would be faster per operation
 * and entirely unnecessary at soft-launch traffic.
 *
 * FIXED WINDOW, not a token bucket: a fixed-window counter is ONE atomic
 * `INSERT … ON CONFLICT DO UPDATE … RETURNING`, so concurrent instances
 * cannot both read "under the limit" and both proceed. A distributed token
 * bucket would need either a read-modify-write (racy) or a stored procedure
 * (heavier than the problem). The known cost of fixed windows — up to 2x the
 * nominal rate across a window boundary — is irrelevant here, because the
 * per-instance token bucket in front of it already smooths bursts.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * FAILURE MODE, STATED PLAINLY
 * ─────────────────────────────────────────────────────────────────────────
 * A store error does NOT open the gate. It returns `unavailable`, and
 * `enforceRateLimit` then runs on the in-memory bucket alone — a strictly
 * tighter-than-nothing limit that still applies per instance — and logs the
 * degradation. It never converts to "allow everything": there is no code
 * path in which a database outage grants unlimited AI spend.
 */

export type DurableVerdict =
  | { state: "allowed"; count: number }
  | { state: "limited"; retryAfterSeconds: number }
  | { state: "unavailable"; error: string };

export interface RateLimitStore {
  readonly kind: string;
  /**
   * Count this request against `key` and report whether it is within `limit`
   * for the current `windowMs` window.
   */
  hit(input: { key: string; limit: number; windowMs: number; now?: Date }): Promise<DurableVerdict>;
}

/** Window boundary: deterministic across instances because it is derived from the clock alone. */
export function windowStartFor(now: Date, windowMs: number): Date {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

/** Expired rows are swept opportunistically — no cron, no scheduler. */
const PRUNE_PROBABILITY = 0.01;
/** Rows outlive their window briefly so a boundary-straddling request still sees them. */
const RETENTION_MULTIPLIER = 3;

export function createPostgresRateLimitStore(): RateLimitStore {
  return {
    kind: "postgres",
    async hit({ key, limit, windowMs, now = new Date() }): Promise<DurableVerdict> {
      try {
        const db = await getDb();
        const windowStart = windowStartFor(now, windowMs);
        const expiresAt = new Date(windowStart.getTime() + windowMs * RETENTION_MULTIPLIER);

        const [row] = await db
          .insert(rateLimitCounters)
          .values({ bucketKey: key, windowStart, count: 1, expiresAt })
          .onConflictDoUpdate({
            target: [rateLimitCounters.bucketKey, rateLimitCounters.windowStart],
            set: { count: sql`${rateLimitCounters.count} + 1` },
          })
          .returning({ count: rateLimitCounters.count });

        if (Math.random() < PRUNE_PROBABILITY) {
          await db.delete(rateLimitCounters).where(lt(rateLimitCounters.expiresAt, now)).catch(() => {});
        }

        const count = row?.count ?? 1;
        if (count > limit) {
          const msLeft = windowStart.getTime() + windowMs - now.getTime();
          return { state: "limited", retryAfterSeconds: Math.max(1, Math.ceil(msLeft / 1000)) };
        }
        return { state: "allowed", count };
      } catch (err) {
        return { state: "unavailable", error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

/**
 * In-process implementation of the same interface — used by tests, and by
 * any deployment that deliberately disables the durable layer. It is NOT a
 * distributed limiter and never claims to be.
 */
export function createMemoryRateLimitStore(): RateLimitStore {
  const counters = new Map<string, { windowStart: number; count: number }>();
  return {
    kind: "memory",
    async hit({ key, limit, windowMs, now = new Date() }): Promise<DurableVerdict> {
      const start = windowStartFor(now, windowMs).getTime();
      const existing = counters.get(key);
      const entry = existing && existing.windowStart === start ? existing : { windowStart: start, count: 0 };
      entry.count += 1;
      counters.set(key, entry);
      if (counters.size > 50_000) {
        for (const [k, v] of counters) if (v.windowStart < start) counters.delete(k);
      }
      if (entry.count > limit) {
        return { state: "limited", retryAfterSeconds: Math.max(1, Math.ceil((start + windowMs - now.getTime()) / 1000)) };
      }
      return { state: "allowed", count: entry.count };
    },
  };
}

/**
 * Whether the durable layer runs.
 *
 * ON in production by default — that is the environment where multiple
 * instances exist and where the per-instance bypass is real. OFF in
 * development and tests by default, so a local run needs no shared state and
 * test outcomes do not depend on counters left behind by an earlier file.
 * `RATE_LIMIT_DURABLE=true|false` overrides in either direction, and setting
 * it to `false` in production is a documented, deliberate downgrade
 * (docs/OBSERVABILITY.md) — not a silent default.
 */
export function durableRateLimitEnabled(): boolean {
  const raw = process.env.RATE_LIMIT_DURABLE;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return process.env.NODE_ENV === "production";
}

let storeOverride: RateLimitStore | null = null;

/** Test seam. Production never calls this. */
export function setRateLimitStoreForTests(store: RateLimitStore | null): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("setRateLimitStoreForTests is a test hook and cannot be used in production");
  }
  storeOverride = store;
}

let defaultStore: RateLimitStore | null = null;

export function resolveRateLimitStore(): RateLimitStore | null {
  if (storeOverride) return storeOverride;
  if (!durableRateLimitEnabled()) return null;
  if (!defaultStore) defaultStore = createPostgresRateLimitStore();
  return defaultStore;
}

/** Housekeeping helper for tests and manual maintenance. */
export async function pruneExpiredRateLimitCounters(now: Date = new Date()): Promise<void> {
  const db = await getDb();
  await db.delete(rateLimitCounters).where(and(lt(rateLimitCounters.expiresAt, now)));
}
