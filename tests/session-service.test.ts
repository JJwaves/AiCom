import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { events } from "@/db/schema";
import type { Touch } from "@/lib/attribution/attribution";
import { upsertCustomerByEmail } from "@/lib/data/customer-service";
import {
  ensureSession,
  getSession,
  linkCustomer,
  markConverted,
  recordAttribution,
} from "@/lib/data/session-service";
import { resetDb } from "./db-helpers";

const touch = (params: Touch["params"], page = "/lp/test"): Touch => ({
  params,
  landing_page: page,
  referrer: "",
  ts: new Date().toISOString(),
});

describe("session service", () => {
  beforeEach(resetDb);

  it("mints a session + session_started event once, then reuses it", async () => {
    const first = await ensureSession({ userAgent: "vitest-ua" });
    expect(first.created).toBe(true);
    expect(first.session.id).toMatch(/^sess_[0-9a-f]{32}$/);
    expect(first.session.anonymousId).toMatch(/^anon_[0-9a-f]{32}$/);

    const again = await ensureSession({ sessionId: first.session.id });
    expect(again.created).toBe(false);
    expect(again.session.id).toBe(first.session.id);
    expect(again.session.lastSeenAt.getTime()).toBeGreaterThanOrEqual(first.session.lastSeenAt.getTime());

    const db = await getDb();
    const started = await db.select().from(events).where(eq(events.name, "session_started"));
    expect(started).toHaveLength(1); // duplicate ensureSession never re-fires it
  });

  it("never trusts unknown or malformed client session ids", async () => {
    const bogus = await ensureSession({ sessionId: "sess_hacked", anonymousId: "also-bad" });
    expect(bogus.created).toBe(true);
    expect(bogus.session.id).not.toBe("sess_hacked");
    expect(bogus.session.anonymousId).not.toBe("also-bad");

    // Well-shaped but nonexistent → a fresh server-minted id, not the client's.
    const ghost = `sess_${"ab".repeat(16)}`;
    const minted = await ensureSession({ sessionId: ghost });
    expect(minted.created).toBe(true);
    expect(minted.session.id).not.toBe(ghost);
  });

  it("keeps a valid anonymous id across new sessions", async () => {
    const first = await ensureSession({});
    const second = await ensureSession({ anonymousId: first.session.anonymousId });
    expect(second.session.id).not.toBe(first.session.id);
    expect(second.session.anonymousId).toBe(first.session.anonymousId);
  });

  it("preserves first touch immutably; last touch updates only on campaign visits", async () => {
    const { session } = await ensureSession({});
    const google = touch({ utm_source: "google", utm_campaign: "launch" });
    await recordAttribution(session.id, { first: google, last: google });

    let row = await getSession(session.id);
    expect(row?.firstTouchJson?.params.utm_source).toBe("google");

    // New campaign: last moves, first must NOT.
    const meta = touch({ fbclid: "abc123" }, "/lp/meta");
    await recordAttribution(session.id, { last: meta });
    row = await getSession(session.id);
    expect(row?.firstTouchJson?.params.utm_source).toBe("google");
    expect(row?.firstTouchJson?.params.fbclid).toBeUndefined();
    expect(row?.lastTouchJson?.params.fbclid).toBe("abc123");

    // Plain internal navigation (no campaign params): last must not be clobbered.
    await recordAttribution(session.id, { last: touch({}, "/products") });
    row = await getSession(session.id);
    expect(row?.lastTouchJson?.params.fbclid).toBe("abc123");
  });

  it("stamps convertedAt once and links a customer without overwriting", async () => {
    const { session } = await ensureSession({});
    await markConverted(session.id);
    const first = (await getSession(session.id))?.convertedAt;
    expect(first).toBeInstanceOf(Date);
    await markConverted(session.id);
    expect((await getSession(session.id))?.convertedAt?.getTime()).toBe(first?.getTime());

    const a = await upsertCustomerByEmail({ email: "a@example.com" });
    const b = await upsertCustomerByEmail({ email: "b@example.com" });
    await linkCustomer(session.id, a.id);
    await linkCustomer(session.id, b.id); // second identity must not silently replace the first
    expect((await getSession(session.id))?.customerId).toBe(a.id);
  });
});
